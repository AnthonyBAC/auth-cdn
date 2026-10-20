# Requisitos de mensajería de la EV2 — pruebas y resultados

Este es el documento principal para los diez requisitos de la tabla acordada. Cada requisito conserva su nombre, explica cómo funciona y compara el resultado esperado con el obtenido. Las evidencias corresponden a las pruebas ya ejecutadas el 19 y 20 de octubre de 2026; esta edición reorganiza esas evidencias y no representa una nueva ejecución de los servicios.

Rama: feature/mq-consumidor. Arquitectura: API Vercel con JWT, MFA y permisos → integración REST oficial de IBM MQ Cloud → Supabase Cloud. Los procesadores automáticos usan secreto de máquina y se ejecutan mediante Supabase Cron. No se incluyen credenciales ni certificados.

**Cómo leer el resultado:** «Correcto» significa que la evidencia coincide con lo esperado para la prueba descrita. Un 504, 502 o 501 puede ser el rechazo previsto en una prueba de fallo; no se presenta como éxito de una operación normal.

Los diez requisitos tienen evidencia satisfactoria en el alcance descrito. ACK se valida mediante HTTP y transacciones SQL; no con MQCMIT/MQBACK. La recuperación interrumpe una RPC SQL concreta, no reinicia IBM. Retención usa antigüedad simulada. Cada apartado deja estas condiciones explícitas para no atribuir a la prueba más de lo observado.

## Matriz de los diez requisitos

| Requisito | Prueba realizada | Resultado obtenido | Veredicto |
|---|---|---|---|

| IBM MQ como broker de mensajería | Publicar un evento de ensayo en AUTHCDN.REMINDERS.Q mediante POST REST. | POST 201 y GET 200. El MsgId de publicación coincide con el leído, y el encabezado persistence indica persistent. | Correcto en el alcance descrito |

| Mensajería asíncrona | Programar un recordatorio con PATCH autenticado mediante JWT. | Programación 200 y aviso normal visible. En el ensayo autónomo, el mismo eventId aparece en outbox PUBLISHED, inbox DONE y la notificación; el recordatorio preventivo queda PROCESSED. | Correcto en el alcance descrito |

| Mensajería síncrona | Enviar POST autenticado al resumen de un tablero. | Resumen 200 con totalActive=3 y pending=3 para el estado de ese tablero en ese momento. CorrelId de respuesta igual al MsgId de solicitud. La demora produjo 504 GATEWAY_TIMEOUT y la petición posterior devolvió 200. | Correcto en el alcance descrito |

| ACK / confirmaciones | Confirmar el POST de publicación. | Publicación 201, captura 200 y DELETE 200. El cuerpo quedó PENDING después de retirarlo de MQ. En la interrupción SQL se observaron cero avisos parciales y, al recuperar, un único aviso. | Correcto en el alcance descrito |

| Durabilidad de mensajes | Verificar persistence=persistent en una lectura real de IBM. | Persistencia IBM confirmada. El backend SQL fue terminado; quedó PENDING y cero avisos. Otro tick respondió 200, terminó DONE con attempts=2 y creó exactamente una notificación. | Correcto en el alcance descrito |

| DLQ / gestión de mensajes fallidos | Enviar JSON mal formado, contrato inválido, referencias inconsistentes y ReplyTo no permitido. | BOQ mostró MALFORMED_JSON, INVALID_REMINDER, PERMANENT_ERROR, INVALID_REPLY_DESTINATION y RETRIES_EXHAUSTED. DLQ pasó de cero a uno: mensaje generado por AUTHCDNQM con MQDLH/MQTM, motivo MQRC_Q_FULL y destino INIT de ensayo. | Correcto en el alcance descrito |

| Reintentos de procesamiento | Provocar un error SQL P0001 solo al insertar el aviso de una tarjeta propia. | Se contaron cinco fallos RPC, inbox attempts=5, salida QUARANTINE terminada y cero avisos. La consola IBM mostró el mensaje BOQ con attempts=5. La salida con destino corregido terminó después de cinco errores sin perder el cuerpo. | Correcto en el alcance descrito |

| Políticas de retención | Preparar tres registros técnicos propios con 40 días de antigüedad: DONE ordinario, PENDING y cuarentena. | Mantenimiento respondió 200 con purgedInbox=1. El DONE ordinario desapareció; la consulta devolvió PENDING y cuarentena. El trabajo de mantenimiento fue verificado activo cada minuto. | Correcto en el alcance descrito |

| Expiración de mensajes | Publicar un mensaje persistente con TTL de 1200 ms. | El mensaje fue visible con expiración restante y luego devolvió 204. La reconciliación dejó el recordatorio EXPIRED y el outbox PUBLISHED. | Correcto en el alcance descrito |

| Alertas de fallos | Preparar un evento de ensayo válido cuyo TTL ya venció para provocar errores reales del transporte del productor. | Outbox FAILED con attempts=5. Mantenimiento creó una alerta; los ciclos siguientes conservaron una sola. GET /api/notifications con sesión válida respondió 200 y contenía ese mismo id de aviso. | Correcto en el alcance descrito |


<a id="r1"></a>

## 1. IBM MQ como broker de mensajería

**Cómo funciona.** IBM MQ Cloud recibe y conserva los mensajes publicados por la API REST oficial. Vercel usa credenciales privadas; las operaciones del usuario pasan primero por JWT y permisos.

**Prueba realizada.**

1. Publicar un evento de ensayo en AUTHCDN.REMINDERS.Q mediante POST REST.
2. Guardar el MsgId devuelto por IBM.
3. Examinar ese mismo MsgId mediante GET, sin retirarlo.

**Resultado esperado.** IBM acepta el envío con HTTP 201, asigna un MsgId y devuelve el mismo evento con HTTP 200 en la lectura.

**Resultado obtenido.** POST 201 y GET 200. El MsgId de publicación coincide con el leído, y el encabezado persistence indica persistent.

**Veredicto: correcto en el alcance descrito.**

**Alcance de esta evidencia.** La prueba demuestra uso real de IBM MQ como broker. No se usa una cola en memoria para sustituirlo.

### Respuestas y comprobación

El siguiente extracto selecciona campos y estados de los registros originales. Los nombres de agrupación son explicativos; las respuestas completas, sin esa selección, se conservan debajo.

```json
{
  "POST": {
    "status": 201,
    "metadata": {
      "ibm-mq-md-messageId": "ID:414d51204155544843444e514d2020203736d56a06ad1c40"
    }
  },
  "GET": {
    "status": 200,
    "metadata": {
      "ibm-mq-md-messageId": "ID:414d51204155544843444e514d2020203736d56a06ad1c40",
      "ibm-mq-md-persistence": "persistent",
      "ibm-mq-md-expiry": "unlimited"
    }
  }
}
```

![IBM MQ como broker de mensajería](capturas/respuesta-c07.png)

*Vista de las respuestas REST registradas; no es una captura de consola.*

![IBM MQ como broker de mensajería](capturas/42-ibm-colas-tras-limpieza.png)

*Captura real de IBM Console: queue manager y colas del proyecto después de limpiar el ensayo.*

### Evidencias originales de este requisito

**`DUPLICATE-SEND` · 19-10-2026 21:53:59 UTC−03 · PASS.** [Registro original](respuestas/phase-C.json).

<details>
<summary>Ver petición, respuesta o consulta y estado completo registrado</summary>

```json
{
  "request": {
    "role": "producer",
    "method": "POST",
    "queue": "AUTHCDN.REMINDERS.Q",
    "selector": {},
    "body": {
      "cardId": "c65fade2-7ae4-4ccb-be7d-9c43229caa2c",
      "eventId": "2a4627f8-d401-440b-a4f5-611edd10fe08",
      "eventType": "TASK_REMINDER_DUE",
      "expiresAt": "2026-10-20T01:11:08.738Z",
      "occurredAt": "2026-10-20T00:51:21.306Z",
      "reminderId": "456bc06e-f5b3-4071-b7db-845da94f4835",
      "workspaceId": "443b712e-a038-45b5-bdc9-be54b9abad82",
      "schemaVersion": 1,
      "scheduleVersion": 2
    }
  },
  "status": 201,
  "body": "",
  "metadata": {
    "ibm-mq-md-messageId": "ID:414d51204155544843444e514d2020203736d56a06ad1c40"
  }
}
```

</details>

**`BROKER-PERSISTENCE` · 19-10-2026 21:54:00 UTC−03 · PASS.** [Registro original](respuestas/phase-C.json).

<details>
<summary>Ver petición, respuesta o consulta y estado completo registrado</summary>

```json
{
  "request": {
    "role": "consumer",
    "method": "GET",
    "queue": "AUTHCDN.REMINDERS.Q",
    "selector": {
      "id": "ID:414d51204155544843444e514d2020203736d56a06ad1c40"
    },
    "body": null
  },
  "status": 200,
  "body": {
    "cardId": "c65fade2-7ae4-4ccb-be7d-9c43229caa2c",
    "eventId": "2a4627f8-d401-440b-a4f5-611edd10fe08",
    "eventType": "TASK_REMINDER_DUE",
    "expiresAt": "2026-10-20T01:11:08.738Z",
    "occurredAt": "2026-10-20T00:51:21.306Z",
    "reminderId": "456bc06e-f5b3-4071-b7db-845da94f4835",
    "workspaceId": "443b712e-a038-45b5-bdc9-be54b9abad82",
    "schemaVersion": 1,
    "scheduleVersion": 2
  },
  "metadata": {
    "ibm-mq-md-messageId": "ID:414d51204155544843444e514d2020203736d56a06ad1c40",
    "ibm-mq-md-persistence": "persistent",
    "ibm-mq-md-expiry": "unlimited"
  }
}
```

</details>


<a id="r2"></a>

## 2. Mensajería asíncrona

**Cómo funciona.** Programar la tarjeta guarda el trabajo en Supabase. Al llegar la fecha, el productor publica el evento en IBM; el consumidor cloud lo captura y process_reminder_event crea el aviso. La respuesta al usuario no espera a esa entrega futura.

**Prueba realizada.**

1. Programar un recordatorio con PATCH autenticado mediante JWT.
2. Esperar notifyAt y ejecutar el procesamiento cloud.
3. Consultar los avisos del usuario y relacionar eventId entre outbox, inbox y notificación.
4. Repetir con Supabase Cron sin invocar tick manualmente después de programar.

**Resultado esperado.** La programación responde 200. Después aparece un aviso del usuario, con outbox PUBLISHED, inbox DONE y recordatorio PROCESSED. La entrega autónoma no depende de un trabajador local.

**Resultado obtenido.** Programación 200 y aviso normal visible. En el ensayo autónomo, el mismo eventId aparece en outbox PUBLISHED, inbox DONE y la notificación; el recordatorio preventivo queda PROCESSED.

**Veredicto: correcto en el alcance descrito.**

**Alcance de esta evidencia.** La profundidad de la cola principal puede volver a cero porque el consumidor ya retiró el mensaje. La programación permanente usa el alias Preview de la rama y fue verificada en la ronda documentada.

### Respuestas y comprobación

El siguiente extracto selecciona campos y estados de los registros originales. Los nombres de agrupación son explicativos; las respuestas completas, sin esa selección, se conservan debajo.

```json
{
  "scheduleHttp": 200,
  "notificationsHttp": 200,
  "autonomousEventId": "b72c8bb8-6085-4360-9e9b-e0540a6cef03",
  "outboxStatus": "PUBLISHED",
  "inboxStatus": "DONE",
  "notification": {
    "id": "4911bd42-4520-4bdb-b927-097be3edc993",
    "event_id": "b72c8bb8-6085-4360-9e9b-e0540a6cef03",
    "message": "La tarjeta \"MQ-E2E-20261020004000 cron-autonomo\" vence el 2026-10-20T01:42:46Z.",
    "created_at": "2026-10-20T01:14:02.933951+00:00"
  }
}
```

![Mensajería asíncrona](capturas/respuesta-c08.png)

*Vista del envío y recepción asíncronos registrados.*

![Mensajería asíncrona](capturas/43-avisos-finales-firefox.png)

*Captura real de la aplicación en Firefox; incluye el aviso cron-autonomo.*

### Evidencias originales de este requisito

**`SCHEDULE-normal` · 19-10-2026 21:51:09 UTC−03 · PASS.** [Registro original](respuestas/phase-B.json).

<details>
<summary>Ver petición, respuesta o consulta y estado completo registrado</summary>

```json
{
  "request": {
    "method": "PATCH",
    "path": "/api/cards/c65fade2-7ae4-4ccb-be7d-9c43229caa2c/schedule",
    "body": {
      "expectedVersion": 1,
      "dueAt": "2026-10-20T01:11:08.738Z",
      "notifyAt": "2026-10-20T00:51:14.738Z",
      "assigneeIds": []
    }
  },
  "status": 200,
  "body": {
    "card": {
      "id": "c65fade2-7ae4-4ccb-be7d-9c43229caa2c",
      "due_at": "2026-10-20T01:11:08.738+00:00",
      "notify_at": "2026-10-20T00:51:14.738+00:00",
      "assignee_ids": [],
      "completed_at": null,
      "schedule_version": 2
    }
  }
}
```

</details>

**`NOTIFICATIONS-DELIVERY` · 19-10-2026 21:51:36 UTC−03 · PASS.** [Registro original](respuestas/phase-B.json).

<details>
<summary>Ver petición, respuesta o consulta y estado completo registrado</summary>

```json
{
  "request": {
    "method": "GET",
    "path": "/api/notifications",
    "body": null
  },
  "status": 200,
  "body": {
    "notifications": [
      {
        "id": "c54d9158-b6b2-4576-b479-dcaa8c7897b9",
        "card_id": "c65fade2-7ae4-4ccb-be7d-9c43229caa2c",
        "message": "La tarjeta \"MQ-E2E-20261020004000 normal\" vence el 2026-10-20T01:11:08Z.",
        "created_at": "2026-10-20T00:51:22.247911+00:00",
        "read_at": null
      }
    ]
  }
}
```

</details>

**`CRON-DELIVERY` · 19-10-2026 22:14:40 UTC−03 · PASS.** [Registro original](respuestas/phase-K.json).

<details>
<summary>Ver petición, respuesta o consulta y estado completo registrado</summary>

```json
{
  "scheduledAt": "2026-10-20T01:12:47.850Z",
  "notifications": {
    "status": 200,
    "body": [
      {
        "id": "4911bd42-4520-4bdb-b927-097be3edc993",
        "event_id": "b72c8bb8-6085-4360-9e9b-e0540a6cef03",
        "message": "La tarjeta \"MQ-E2E-20261020004000 cron-autonomo\" vence el 2026-10-20T01:42:46Z.",
        "created_at": "2026-10-20T01:14:02.933951+00:00"
      }
    ]
  },
  "reminders": {
    "status": 200,
    "body": [
      {
        "id": "66606d73-0dcd-4f5e-91d0-1dd481c232ea",
        "kind": "TASK_OVERDUE",
        "status": "SCHEDULED",
        "processed_at": null
      },
      {
        "id": "267b7df0-f8c1-477d-9ff5-43ef0a5b3504",
        "kind": "TASK_REMINDER_DUE",
        "status": "PROCESSED",
        "processed_at": "2026-10-20T01:14:02.935677+00:00"
      }
    ]
  },
  "outbox": {
    "status": 200,
    "body": [
      {
        "event_id": "b72c8bb8-6085-4360-9e9b-e0540a6cef03",
        "status": "PUBLISHED",
        "published_at": "2026-10-20T01:14:02.18504+00:00",
        "payload": {
          "cardId": "bfc16927-5eba-45ca-b3af-53392778447a",
          "eventId": "b72c8bb8-6085-4360-9e9b-e0540a6cef03",
          "eventType": "TASK_REMINDER_DUE",
          "expiresAt": "2026-10-20T01:42:46.718Z",
          "occurredAt": "2026-10-20T01:14:01.182Z",
          "reminderId": "267b7df0-f8c1-477d-9ff5-43ef0a5b3504",
          "workspaceId": "443b712e-a038-45b5-bdc9-be54b9abad82",
          "schemaVersion": 1,
          "scheduleVersion": 2
        }
      }
    ]
  },
  "inbox": {
    "status": 200,
    "body": [
      {
        "id": "d60a867a-bb56-42d8-b37b-c33b5be88291",
        "message_id": "ID:414D51204155544843444E514D2020203736D56A06861D40",
        "state": "DONE",
        "attempts": 1,
        "body": "{\"schemaVersion\":1,\"eventId\":\"b72c8bb8-6085-4360-9e9b-e0540a6cef03\",\"eventType\":\"TASK_REMINDER_DUE\",\"reminderId\":\"267b7df0-f8c1-477d-9ff5-43ef0a5b3504\",\"cardId\":\"bfc16927-5eba-45ca-b3af-53392778447a\",\"workspaceId\":\"443b712e-a038-45b5-bdc9-be54b9abad82\",\"scheduleVersion\":2,\"occurredAt\":\"2026-10-20T01:14:01.182Z\",\"expiresAt\":\"2026-10-20T01:42:46.718Z\"}",
        "created_at": "2026-10-20T01:14:02.330116+00:00",
        "completed_at": "2026-10-20T01:14:03.086691+00:00"
      }
    ]
  }
}
```

</details>

**`FINAL-CLOUD-CHECK` · 20-10-2026 01:25:34 UTC−03 · PASS.** [Registro original](respuestas/phase-FINAL-20261020.json).

<details>
<summary>Ver petición, respuesta o consulta y estado completo registrado</summary>

```json
{
  "activeTestReminders": 0,
  "health": {
    "deliveryRetries": 0,
    "failedPublications": 0,
    "pendingInbox": 0,
    "quarantined": 7,
    "staleInbox": 0
  },
  "jobs": [
    {
      "active": true,
      "name": "authcdn-mq-rest-minute",
      "schedule": "* * * * *"
    },
    {
      "active": true,
      "name": "authcdn-mq-maintenance",
      "schedule": "* * * * *"
    }
  ],
  "recentCronRuns": [
    {
      "end_time": "2026-10-20T04:25:00.079953+00:00",
      "jobid": 3,
      "start_time": "2026-10-20T04:25:00.0668+00:00",
      "status": "succeeded"
    },
    {
      "end_time": "2026-10-20T04:25:00.091701+00:00",
      "jobid": 2,
      "start_time": "2026-10-20T04:25:00.06606+00:00",
      "status": "succeeded"
    },
    {
      "end_time": "2026-10-20T04:24:00.033081+00:00",
      "jobid": 3,
      "start_time": "2026-10-20T04:24:00.022764+00:00",
      "status": "succeeded"
    },
    {
      "end_time": "2026-10-20T04:24:00.026206+00:00",
      "jobid": 2,
      "start_time": "2026-10-20T04:24:00.021538+00:00",
      "status": "succeeded"
    },
    {
      "end_time": "2026-10-20T04:23:00.03409+00:00",
      "jobid": 3,
      "start_time": "2026-10-20T04:23:00.023261+00:00",
      "status": "succeeded"
    },
    {
      "end_time": "2026-10-20T04:23:00.026647+00:00",
      "jobid": 2,
      "start_time": "2026-10-20T04:23:00.022055+00:00",
      "status": "succeeded"
    }
  ],
  "recentHttpResponses": [
    {
      "created": "2026-10-20T04:25:00.091708+00:00",
      "error_msg": null,
      "id": 181,
      "status_code": 200,
      "timed_out": false
    },
    {
      "created": "2026-10-20T04:24:00.026413+00:00",
      "error_msg": null,
      "id": 180,
      "status_code": 200,
      "timed_out": false
    },
    {
      "created": "2026-10-20T04:23:00.026641+00:00",
      "error_msg": null,
      "id": 179,
      "status_code": 200,
      "timed_out": false
    }
  ],
  "temporaryFunctions": 0,
  "temporaryTriggers": 0
}
```

</details>


<a id="r3"></a>

## 3. Mensajería síncrona

**Cómo funciona.** El usuario solicita un resumen y espera la respuesta. Vercel publica en AUTHCDN.SUMMARY.REQUEST.Q; el responder cloud contesta por AUTHCDN.SUMMARY.REPLY.Q. requestId identifica la operación y CorrelId enlaza la respuesta con el MsgId de la solicitud.

**Prueba realizada.**

1. Enviar POST autenticado al resumen de un tablero.
2. Comprobar estadísticas, requestId y correlación entre las dos colas.
3. Enviar solicitudes simultáneas y verificar que no se mezclan sus respuestas.
4. Demorar solo el tablero de ensayo hasta agotar la espera y retirar luego esa demora.

**Resultado esperado.** En operación normal, HTTP 200 con el resumen correcto. Cada respuesta corresponde a su solicitud. Si no llega a tiempo, HTTP 504; tras resolver la demora, una nueva solicitud vuelve a responder 200.

**Resultado obtenido.** Resumen 200 con totalActive=3 y pending=3 para el estado de ese tablero en ese momento. CorrelId de respuesta igual al MsgId de solicitud. La demora produjo 504 GATEWAY_TIMEOUT y la petición posterior devolvió 200.

**Veredicto: correcto en el alcance descrito.**

**Alcance de esta evidencia.** El timeout se provocó con una demora SQL restringida al tablero de ensayo. La duración medida de extremo a extremo fue 28.520 ms; incluye trabajo previo y red. La foto de resumen corresponde a una ronda posterior con ocho tarjetas y no se usa para justificar los conteos de la primera respuesta.

### Respuestas y comprobación

El siguiente extracto selecciona campos y estados de los registros originales. Los nombres de agrupación son explicativos; las respuestas completas, sin esa selección, se conservan debajo.

```json
{
  "normal": {
    "request": {
      "method": "POST",
      "path": "/api/boards/5c52e0b4-62f0-4545-9ea3-2aa86dfe0c62/summary",
      "body": null
    },
    "status": 200,
    "body": {
      "summary": {
        "totalActive": 3,
        "pending": 3,
        "completed": 0,
        "overdue": 0
      },
      "requestId": "ff224fd3-8447-43af-846c-a6e99c2d3d3c",
      "generatedAt": "2026-10-20T00:49:46.985Z"
    }
  },
  "correlation": {
    "requestId": "ff224fd3-8447-43af-846c-a6e99c2d3d3c",
    "requestMessageId": "ID:414D51204155544843444E514D2020203736D56A0E6A1C40",
    "replyCorrelationId": "ID:414D51204155544843444E514D2020203736D56A0E6A1C40"
  },
  "timeout": {
    "request": {
      "method": "POST",
      "path": "/api/boards/5a84c92c-f774-4613-90b6-b37d7a79ec04/summary",
      "body": null
    },
    "elapsedMs": 28520,
    "status": 504,
    "body": {
      "error": {
        "code": "GATEWAY_TIMEOUT",
        "message": "El resumen superó el tiempo de espera.",
        "details": {
          "code": "GATEWAY_TIMEOUT"
        }
      }
    }
  },
  "afterRecovery": {
    "request": {
      "method": "POST",
      "path": "/api/boards/5a84c92c-f774-4613-90b6-b37d7a79ec04/summary",
      "body": null
    },
    "elapsedMs": 3650,
    "status": 200,
    "body": {
      "summary": {
        "totalActive": 0,
        "pending": 0,
        "completed": 0,
        "overdue": 0
      },
      "requestId": "5dfafc03-802b-44a0-8ff7-7ca6dc7c5e4e",
      "generatedAt": "2026-10-20T03:45:18.793Z"
    }
  }
}
```

![Mensajería síncrona](capturas/respuesta-c12.png)

*Vista de las solicitudes y respuestas normales registradas.*

![Mensajería síncrona](capturas/respuesta-c13.png)

*Vista del 504 provocado y de la solicitud durable.*

![Mensajería síncrona](capturas/14-resumen-cargado.png)

*Captura real de otro resumen del mismo ensayo: ocho tarjetas en ese momento.*

### Evidencias originales de este requisito

**`SUMMARY-5c52e0b4-62f0-4545-9ea3-2aa86dfe0c62` · 19-10-2026 21:49:49 UTC−03 · PASS.** [Registro original](respuestas/phase-A-configured.json).

<details>
<summary>Ver petición, respuesta o consulta y estado completo registrado</summary>

```json
{
  "request": {
    "method": "POST",
    "path": "/api/boards/5c52e0b4-62f0-4545-9ea3-2aa86dfe0c62/summary",
    "body": null
  },
  "status": 200,
  "body": {
    "summary": {
      "totalActive": 3,
      "pending": 3,
      "completed": 0,
      "overdue": 0
    },
    "requestId": "ff224fd3-8447-43af-846c-a6e99c2d3d3c",
    "generatedAt": "2026-10-20T00:49:46.985Z"
  }
}
```

</details>

**`SUMMARY-SQL-TRACE` · 19-10-2026 21:50:01 UTC−03 · PASS.** [Registro original](respuestas/phase-A-configured.json).

<details>
<summary>Ver petición, respuesta o consulta y estado completo registrado</summary>

```json
{
  "status": 200,
  "body": [
    {
      "id": "b61c942d-62ae-4631-a6a9-e495f4823b34",
      "queue_name": "AUTHCDN.SUMMARY.REPLY.Q",
      "message_id": "ID:414D51204155544843444E514D2020203736D56A156A1C40",
      "correlation_id": "ID:414D51204155544843444E514D2020203736D56A136A1C40",
      "reply_to": null,
      "state": "DONE",
      "attempts": 1,
      "output_attempts": 0,
      "body": "{\"schemaVersion\":1,\"requestId\":\"c254fd28-693c-4d60-baa0-0900a792dbdf\",\"boardId\":\"5a84c92c-f774-4613-90b6-b37d7a79ec04\",\"generatedAt\":\"2026-10-20T00:49:53.963Z\",\"status\":\"OK\",\"stats\":{\"totalActive\":0,\"pending\":0,\"completed\":0,\"overdue\":0}}",
      "output": null,
      "created_at": "2026-10-20T00:49:54.290631+00:00"
    },
    {
      "id": "a9f18544-a5f7-488e-bd06-2d25fcaea80c",
      "queue_name": "AUTHCDN.SUMMARY.REPLY.Q",
      "message_id": "ID:414D51204155544843444E514D2020203736D56A146A1C40",
      "correlation_id": "ID:414D51204155544843444E514D2020203736D56A126A1C40",
      "reply_to": null,
      "state": "DONE",
      "attempts": 1,
      "output_attempts": 0,
      "body": "{\"schemaVersion\":1,\"requestId\":\"2a126144-da81-4319-a8ad-145ce48ea3c4\",\"boardId\":\"5c52e0b4-62f0-4545-9ea3-2aa86dfe0c62\",\"generatedAt\":\"2026-10-20T00:49:53.524Z\",\"status\":\"OK\",\"stats\":{\"totalActive\":3,\"pending\":3,\"completed\":0,\"overdue\":0}}",
      "output": null,
      "created_at": "2026-10-20T00:49:54.043914+00:00"
    },
    {
      "id": "18200de9-fddc-4b77-bbea-5891a359a7a8",
      "queue_name": "AUTHCDN.SUMMARY.REQUEST.Q",
      "message_id": "ID:414D51204155544843444E514D2020203736D56A136A1C40",
      "correlation_id": null,
      "reply_to": "AUTHCDN.SUMMARY.REPLY.Q@AUTHCDNQM",
      "state": "DONE",
      "attempts": 1,
      "output_attempts": 1,
      "body": "{\"schemaVersion\":1,\"requestId\":\"c254fd28-693c-4d60-baa0-0900a792dbdf\",\"boardId\":\"5a84c92c-f774-4613-90b6-b37d7a79ec04\",\"userId\":\"45e0ff79-940c-4230-bd97-bb9e0572e0f0\",\"createdAt\":\"2026-10-20T00:49:53.103Z\",\"expiresAt\":\"2026-10-20T00:50:23.103Z\"}",
      "output": {
        "body": "{\"schemaVersion\":1,\"requestId\":\"c254fd28-693c-4d60-baa0-0900a792dbdf\",\"boardId\":\"5a84c92c-f774-4613-90b6-b37d7a79ec04\",\"generatedAt\":\"2026-10-20T00:49:53.963Z\",\"status\":\"OK\",\"stats\":{\"totalActive\":0,\"pending\":0,\"completed\":0,\"overdue\":0}}",
        "queue": "AUTHCDN.SUMMARY.REPLY.Q",
        "expiresAt": "2026-10-20T00:50:53.963Z",
        "correlationId": "ID:414D51204155544843444E514D2020203736D56A136A1C40"
      },
      "created_at": "2026-10-20T00:49:53.221116+00:00"
    },
    {
      "id": "76ae4d38-cd9c-47b1-b320-566ce0301b1f",
      "queue_name": "AUTHCDN.SUMMARY.REQUEST.Q",
      "message_id": "ID:414D51204155544843444E514D2020203736D56A126A1C40",
      "correlation_id": null,
      "reply_to": "AUTHCDN.SUMMARY.REPLY.Q@AUTHCDNQM",
      "state": "DONE",
      "attempts": 1,
      "output_attempts": 1,
      "body": "{\"schemaVersion\":1,\"requestId\":\"2a126144-da81-4319-a8ad-145ce48ea3c4\",\"boardId\":\"5c52e0b4-62f0-4545-9ea3-2aa86dfe0c62\",\"userId\":\"45e0ff79-940c-4230-bd97-bb9e0572e0f0\",\"createdAt\":\"2026-10-20T00:49:52.720Z\",\"expiresAt\":\"2026-10-20T00:50:22.720Z\"}",
      "output": {
        "body": "{\"schemaVersion\":1,\"requestId\":\"2a126144-da81-4319-a8ad-145ce48ea3c4\",\"boardId\":\"5c52e0b4-62f0-4545-9ea3-2aa86dfe0c62\",\"generatedAt\":\"2026-10-20T00:49:53.524Z\",\"status\":\"OK\",\"stats\":{\"totalActive\":3,\"pending\":3,\"completed\":0,\"overdue\":0}}",
        "queue": "AUTHCDN.SUMMARY.REPLY.Q",
        "expiresAt": "2026-10-20T00:50:53.524Z",
        "correlationId": "ID:414D51204155544843444E514D2020203736D56A126A1C40"
      },
      "created_at": "2026-10-20T00:49:52.840421+00:00"
    },
    {
      "id": "95d51ae7-397c-4c2a-931f-08c1b2e01159",
      "queue_name": "AUTHCDN.SUMMARY.REPLY.Q",
      "message_id": "ID:414D51204155544843444E514D2020203736D56A116A1C40",
      "correlation_id": "ID:414D51204155544843444E514D2020203736D56A106A1C40",
      "reply_to": null,
      "state": "DONE",
      "attempts": 1,
      "output_attempts": 0,
      "body": "{\"schemaVersion\":1,\"requestId\":\"f1bdb7f5-2e6b-4306-a45f-6f5b3de6d6b2\",\"boardId\":\"5a84c92c-f774-4613-90b6-b37d7a79ec04\",\"generatedAt\":\"2026-10-20T00:49:50.341Z\",\"status\":\"OK\",\"stats\":{\"totalActive\":0,\"pending\":0,\"completed\":0,\"overdue\":0}}",
      "output": null,
      "created_at": "2026-10-20T00:49:50.71831+00:00"
    },
    {
      "id": "25216ec4-5b72-46c1-a245-ba968ea5392d",
      "queue_name": "AUTHCDN.SUMMARY.REQUEST.Q",
      "message_id": "ID:414D51204155544843444E514D2020203736D56A106A1C40",
      "correlation_id": null,
      "reply_to": "AUTHCDN.SUMMARY.REPLY.Q@AUTHCDNQM",
      "state": "DONE",
      "attempts": 1,
      "output_attempts": 1,
      "body": "{\"schemaVersion\":1,\"requestId\":\"f1bdb7f5-2e6b-4306-a45f-6f5b3de6d6b2\",\"boardId\":\"5a84c92c-f774-4613-90b6-b37d7a79ec04\",\"userId\":\"45e0ff79-940c-4230-bd97-bb9e0572e0f0\",\"createdAt\":\"2026-10-20T00:49:49.675Z\",\"expiresAt\":\"2026-10-20T00:50:19.675Z\"}",
      "output": {
        "body": "{\"schemaVersion\":1,\"requestId\":\"f1bdb7f5-2e6b-4306-a45f-6f5b3de6d6b2\",\"boardId\":\"5a84c92c-f774-4613-90b6-b37d7a79ec04\",\"generatedAt\":\"2026-10-20T00:49:50.341Z\",\"status\":\"OK\",\"stats\":{\"totalActive\":0,\"pending\":0,\"completed\":0,\"overdue\":0}}",
        "queue": "AUTHCDN.SUMMARY.REPLY.Q",
        "expiresAt": "2026-10-20T00:50:50.341Z",
        "correlationId": "ID:414D51204155544843444E514D2020203736D56A106A1C40"
      },
      "created_at": "2026-10-20T00:49:49.784075+00:00"
    },
    {
      "id": "aa748a00-5d44-4ac4-919c-9ece4ddcc62d",
      "queue_name": "AUTHCDN.SUMMARY.REPLY.Q",
      "message_id": "ID:414D51204155544843444E514D2020203736D56A0F6A1C40",
      "correlation_id": "ID:414D51204155544843444E514D2020203736D56A0E6A1C40",
      "reply_to": null,
      "state": "DONE",
      "attempts": 1,
      "output_attempts": 0,
      "body": "{\"schemaVersion\":1,\"requestId\":\"ff224fd3-8447-43af-846c-a6e99c2d3d3c\",\"boardId\":\"5c52e0b4-62f0-4545-9ea3-2aa86dfe0c62\",\"generatedAt\":\"2026-10-20T00:49:46.985Z\",\"status\":\"OK\",\"stats\":{\"totalActive\":3,\"pending\":3,\"completed\":0,\"overdue\":0}}",
      "output": null,
      "created_at": "2026-10-20T00:49:47.308335+00:00"
    },
    {
      "id": "499c307b-cd4d-429a-9541-58325a4b99f1",
      "queue_name": "AUTHCDN.SUMMARY.REQUEST.Q",
      "message_id": "ID:414D51204155544843444E514D2020203736D56A0E6A1C40",
      "correlation_id": null,
      "reply_to": "AUTHCDN.SUMMARY.REPLY.Q@AUTHCDNQM",
      "state": "DONE",
      "attempts": 1,
      "output_attempts": 1,
      "body": "{\"schemaVersion\":1,\"requestId\":\"ff224fd3-8447-43af-846c-a6e99c2d3d3c\",\"boardId\":\"5c52e0b4-62f0-4545-9ea3-2aa86dfe0c62\",\"userId\":\"45e0ff79-940c-4230-bd97-bb9e0572e0f0\",\"createdAt\":\"2026-10-20T00:49:45.861Z\",\"expiresAt\":\"2026-10-20T00:50:15.861Z\"}",
      "output": {
        "body": "{\"schemaVersion\":1,\"requestId\":\"ff224fd3-8447-43af-846c-a6e99c2d3d3c\",\"boardId\":\"5c52e0b4-62f0-4545-9ea3-2aa86dfe0c62\",\"generatedAt\":\"2026-10-20T00:49:46.985Z\",\"status\":\"OK\",\"stats\":{\"totalActive\":3,\"pending\":3,\"completed\":0,\"overdue\":0}}",
        "queue": "AUTHCDN.SUMMARY.REPLY.Q",
        "expiresAt": "2026-10-20T00:50:46.985Z",
        "correlationId": "ID:414D51204155544843444E514D2020203736D56A0E6A1C40"
      },
      "created_at": "2026-10-20T00:49:46.272551+00:00"
    }
  ]
}
```

</details>

**`SUMMARY-CONCURRENT` · 19-10-2026 21:49:56 UTC−03 · PASS.** [Registro original](respuestas/phase-A-configured.json).

<details>
<summary>Ver petición, respuesta o consulta y estado completo registrado</summary>

```json
[
  {
    "request": {
      "method": "POST",
      "path": "/api/boards/5c52e0b4-62f0-4545-9ea3-2aa86dfe0c62/summary",
      "body": null
    },
    "status": 200,
    "body": {
      "summary": {
        "totalActive": 3,
        "pending": 3,
        "completed": 0,
        "overdue": 0
      },
      "requestId": "2a126144-da81-4319-a8ad-145ce48ea3c4",
      "generatedAt": "2026-10-20T00:49:53.524Z"
    }
  },
  {
    "request": {
      "method": "POST",
      "path": "/api/boards/5a84c92c-f774-4613-90b6-b37d7a79ec04/summary",
      "body": null
    },
    "status": 200,
    "body": {
      "summary": {
        "totalActive": 0,
        "pending": 0,
        "completed": 0,
        "overdue": 0
      },
      "requestId": "c254fd28-693c-4d60-baa0-0900a792dbdf",
      "generatedAt": "2026-10-20T00:49:53.963Z"
    }
  }
]
```

</details>

**`SUMMARY-REAL-TIMEOUT` · 20-10-2026 00:45:10 UTC−03 · PASS.** [Registro original](respuestas/phase-DEEP-155d2be1.json).

<details>
<summary>Ver petición, respuesta o consulta y estado completo registrado</summary>

```json
{
  "request": {
    "method": "POST",
    "path": "/api/boards/5a84c92c-f774-4613-90b6-b37d7a79ec04/summary",
    "body": null
  },
  "elapsedMs": 28520,
  "status": 504,
  "body": {
    "error": {
      "code": "GATEWAY_TIMEOUT",
      "message": "El resumen superó el tiempo de espera.",
      "details": {
        "code": "GATEWAY_TIMEOUT"
      }
    }
  }
}
```

</details>

**`SUMMARY-AFTER-TIMEOUT` · 20-10-2026 00:45:20 UTC−03 · PASS.** [Registro original](respuestas/phase-DEEP-155d2be1.json).

<details>
<summary>Ver petición, respuesta o consulta y estado completo registrado</summary>

```json
{
  "request": {
    "method": "POST",
    "path": "/api/boards/5a84c92c-f774-4613-90b6-b37d7a79ec04/summary",
    "body": null
  },
  "elapsedMs": 3650,
  "status": 200,
  "body": {
    "summary": {
      "totalActive": 0,
      "pending": 0,
      "completed": 0,
      "overdue": 0
    },
    "requestId": "5dfafc03-802b-44a0-8ff7-7ca6dc7c5e4e",
    "generatedAt": "2026-10-20T03:45:18.793Z"
  }
}
```

</details>


<a id="r4"></a>

## 4. ACK / confirmaciones

**Cómo funciona.** En REST la aceptación de publicación se confirma con HTTP 201. Para consumir, primero se guarda el cuerpo en un inbox durable y después se retira por MsgId con DELETE. El efecto en Supabase se confirma dentro de su transacción; si falla, no se confirma un aviso parcial.

**Prueba realizada.**

1. Confirmar el POST de publicación.
2. Examinar el mensaje y registrar mq_rest_capture antes de retirarlo.
3. Retirar exclusivamente ese MsgId con DELETE.
4. Comprobar el trabajo PENDING y su recuperación; comprobar también que una RPC interrumpida no deja avisos parciales.

**Resultado esperado.** POST 201; captura durable confirmada; DELETE 200 del mismo mensaje; si el procesamiento falla, ningún aviso parcial y trabajo recuperable.

**Resultado obtenido.** Publicación 201, captura 200 y DELETE 200. El cuerpo quedó PENDING después de retirarlo de MQ. En la interrupción SQL se observaron cero avisos parciales y, al recuperar, un único aviso.

**Veredicto: correcto en el alcance descrito.**

**Alcance de esta evidencia.** La frase de la tabla original «commit y rollback probados» se interpreta aquí como confirmaciones REST y transacción SQL. No se ejecutaron MQCMIT/MQBACK nativos ni existe una transacción distribuida IBM/Supabase. La corrección ante reentregas depende de idempotencia; esta diferencia debe mantenerse en la presentación.

### Respuestas y comprobación

El siguiente extracto selecciona campos y estados de los registros originales. Los nombres de agrupación son explicativos; las respuestas completas, sin esa selección, se conservan debajo.

```json
{
  "publishHttp": 201,
  "capture": {
    "status": 200,
    "body": "cb89c973-cac0-4cd0-bf32-17f49eb9ecc5"
  },
  "delete": {
    "request": {
      "role": "consumer",
      "method": "DELETE",
      "queue": "AUTHCDN.REMINDERS.Q",
      "selector": {
        "id": "ID:414d51204155544843444e514d2020203736d56a10ad1c40"
      },
      "body": null
    },
    "status": 200
  },
  "afterDelete": {
    "state": "PENDING"
  },
  "partialNotificationsAfterSqlFailure": []
}
```

![ACK / confirmaciones](capturas/respuesta-c14.png)

*Vista de captura durable y retirada REST por MsgId.*

![ACK / confirmaciones](capturas/respuesta-c17.png)

*Vista de la interrupción SQL y recuperación.*

### Evidencias originales de este requisito

**`DUPLICATE-SEND` · 19-10-2026 21:53:59 UTC−03 · PASS.** [Registro original](respuestas/phase-C.json).

<details>
<summary>Ver petición, respuesta o consulta y estado completo registrado</summary>

```json
{
  "request": {
    "role": "producer",
    "method": "POST",
    "queue": "AUTHCDN.REMINDERS.Q",
    "selector": {},
    "body": {
      "cardId": "c65fade2-7ae4-4ccb-be7d-9c43229caa2c",
      "eventId": "2a4627f8-d401-440b-a4f5-611edd10fe08",
      "eventType": "TASK_REMINDER_DUE",
      "expiresAt": "2026-10-20T01:11:08.738Z",
      "occurredAt": "2026-10-20T00:51:21.306Z",
      "reminderId": "456bc06e-f5b3-4071-b7db-845da94f4835",
      "workspaceId": "443b712e-a038-45b5-bdc9-be54b9abad82",
      "schemaVersion": 1,
      "scheduleVersion": 2
    }
  },
  "status": 201,
  "body": "",
  "metadata": {
    "ibm-mq-md-messageId": "ID:414d51204155544843444e514d2020203736d56a06ad1c40"
  }
}
```

</details>

**`RECOVERY-CAPTURE` · 19-10-2026 21:54:23 UTC−03 · PASS.** [Registro original](respuestas/phase-C.json).

<details>
<summary>Ver petición, respuesta o consulta y estado completo registrado</summary>

```json
{
  "read": {
    "request": {
      "role": "consumer",
      "method": "GET",
      "queue": "AUTHCDN.REMINDERS.Q",
      "selector": {
        "id": "ID:414d51204155544843444e514d2020203736d56a10ad1c40"
      },
      "body": null
    },
    "status": 200,
    "body": {
      "cardId": "c65fade2-7ae4-4ccb-be7d-9c43229caa2c",
      "eventId": "2a4627f8-d401-440b-a4f5-611edd10fe08",
      "eventType": "TASK_REMINDER_DUE",
      "expiresAt": "2026-10-20T01:11:08.738Z",
      "occurredAt": "2026-10-20T00:51:21.306Z",
      "reminderId": "456bc06e-f5b3-4071-b7db-845da94f4835",
      "workspaceId": "443b712e-a038-45b5-bdc9-be54b9abad82",
      "schemaVersion": 1,
      "scheduleVersion": 2
    },
    "metadata": {
      "ibm-mq-md-messageId": "ID:414d51204155544843444e514d2020203736d56a10ad1c40",
      "ibm-mq-md-persistence": "persistent",
      "ibm-mq-md-expiry": "unlimited"
    }
  },
  "captured": {
    "status": 200,
    "body": "cb89c973-cac0-4cd0-bf32-17f49eb9ecc5"
  }
}
```

</details>

**`RECOVERY-INTERRUPTION` · 19-10-2026 21:54:24 UTC−03 · PASS.** [Registro original](respuestas/phase-C.json).

<details>
<summary>Ver petición, respuesta o consulta y estado completo registrado</summary>

```json
{
  "removed": {
    "request": {
      "role": "consumer",
      "method": "DELETE",
      "queue": "AUTHCDN.REMINDERS.Q",
      "selector": {
        "id": "ID:414d51204155544843444e514d2020203736d56a10ad1c40"
      },
      "body": null
    },
    "status": 200,
    "body": {
      "cardId": "c65fade2-7ae4-4ccb-be7d-9c43229caa2c",
      "eventId": "2a4627f8-d401-440b-a4f5-611edd10fe08",
      "eventType": "TASK_REMINDER_DUE",
      "expiresAt": "2026-10-20T01:11:08.738Z",
      "occurredAt": "2026-10-20T00:51:21.306Z",
      "reminderId": "456bc06e-f5b3-4071-b7db-845da94f4835",
      "workspaceId": "443b712e-a038-45b5-bdc9-be54b9abad82",
      "schemaVersion": 1,
      "scheduleVersion": 2
    },
    "metadata": {
      "ibm-mq-md-messageId": "ID:414d51204155544843444e514d2020203736d56a10ad1c40",
      "ibm-mq-md-persistence": "persistent",
      "ibm-mq-md-expiry": "unlimited"
    }
  },
  "pending": {
    "status": 200,
    "body": [
      {
        "id": "cb89c973-cac0-4cd0-bf32-17f49eb9ecc5",
        "queue_name": "AUTHCDN.REMINDERS.Q",
        "message_id": "ID:414d51204155544843444e514d2020203736d56a10ad1c40",
        "correlation_id": null,
        "reply_to": null,
        "body": "{\"cardId\":\"c65fade2-7ae4-4ccb-be7d-9c43229caa2c\",\"eventId\":\"2a4627f8-d401-440b-a4f5-611edd10fe08\",\"eventType\":\"TASK_REMINDER_DUE\",\"expiresAt\":\"2026-10-20T01:11:08.738Z\",\"occurredAt\":\"2026-10-20T00:51:21.306Z\",\"reminderId\":\"456bc06e-f5b3-4071-b7db-845da94f4835\",\"workspaceId\":\"443b712e-a038-45b5-bdc9-be54b9abad82\",\"schemaVersion\":1,\"scheduleVersion\":2}",
        "state": "PENDING",
        "attempts": 0,
        "output_attempts": 0,
        "output": null,
        "next_attempt_at": "2026-10-20T00:54:22.609284+00:00",
        "last_error": null
      }
    ]
  }
}
```

</details>

**`RECOVERY-RESUME` · 19-10-2026 21:54:30 UTC−03 · PASS.** [Registro original](respuestas/phase-C.json).

<details>
<summary>Ver petición, respuesta o consulta y estado completo registrado</summary>

```json
{
  "inbox": {
    "status": 200,
    "body": [
      {
        "id": "cb89c973-cac0-4cd0-bf32-17f49eb9ecc5",
        "queue_name": "AUTHCDN.REMINDERS.Q",
        "message_id": "ID:414d51204155544843444e514d2020203736d56a10ad1c40",
        "correlation_id": null,
        "reply_to": null,
        "body": "{\"cardId\":\"c65fade2-7ae4-4ccb-be7d-9c43229caa2c\",\"eventId\":\"2a4627f8-d401-440b-a4f5-611edd10fe08\",\"eventType\":\"TASK_REMINDER_DUE\",\"expiresAt\":\"2026-10-20T01:11:08.738Z\",\"occurredAt\":\"2026-10-20T00:51:21.306Z\",\"reminderId\":\"456bc06e-f5b3-4071-b7db-845da94f4835\",\"workspaceId\":\"443b712e-a038-45b5-bdc9-be54b9abad82\",\"schemaVersion\":1,\"scheduleVersion\":2}",
        "state": "DONE",
        "attempts": 1,
        "output_attempts": 0,
        "output": null,
        "next_attempt_at": "2026-10-20T00:54:22.609284+00:00",
        "last_error": null
      }
    ]
  },
  "notifications": {
    "status": 200,
    "body": [
      {
        "id": "c54d9158-b6b2-4576-b479-dcaa8c7897b9",
        "event_id": "2a4627f8-d401-440b-a4f5-611edd10fe08",
        "card_id": "c65fade2-7ae4-4ccb-be7d-9c43229caa2c"
      }
    ]
  }
}
```

</details>

**`INTERRUPTION-ROLLBACK` · 20-10-2026 00:47:17 UTC−03 · PASS.** [Registro original](respuestas/phase-DEEP-155d2be1.json).

<details>
<summary>Ver petición, respuesta o consulta y estado completo registrado</summary>

```json
{
  "signal": {
    "status": 200,
    "body": {
      "pid": 382242,
      "queryStart": "2026-10-20T03:47:13.696902+00:00",
      "terminated": true,
      "backendStart": "2026-10-20T03:47:13.358211+00:00",
      "reminderStatus": "QUEUED",
      "applicationName": "authcdn-e2e-interrupt-155d2be1",
      "fixtureNotifications": 0
    }
  },
  "tick": {
    "request": {
      "method": "POST",
      "path": "/api/mq/tick",
      "body": {}
    },
    "elapsedMs": 5192,
    "status": 502,
    "body": {
      "published": 1,
      "captured": 1,
      "worked": 1,
      "errors": 1
    }
  },
  "inbox": {
    "status": 200,
    "body": [
      {
        "id": "715b20c4-f4f6-4c90-b715-0a20798259bb",
        "message_id": "ID:414D51204155544843444E514D2020203736D56A11491E40",
        "body": "{\"schemaVersion\":1,\"eventId\":\"8cfbcf5a-804d-400b-8018-504cd641fcb6\",\"eventType\":\"TASK_REMINDER_DUE\",\"reminderId\":\"c3bf2cf5-e609-41a8-b991-adc3cec6d957\",\"cardId\":\"56453971-70c2-4612-986b-4466862b39f2\",\"workspaceId\":\"443b712e-a038-45b5-bdc9-be54b9abad82\",\"scheduleVersion\":2,\"occurredAt\":\"2026-10-20T03:47:12.723Z\",\"expiresAt\":\"2026-10-20T04:47:07.013Z\"}",
        "state": "PENDING",
        "attempts": 1,
        "output_attempts": 0,
        "output": null,
        "next_attempt_at": "2026-10-20T03:48:43.998838+00:00",
        "last_error": "PROCESSING_OR_DELIVERY_UNCONFIRMED"
      }
    ]
  },
  "notifications": {
    "status": 200,
    "body": []
  }
}
```

</details>


<a id="r5"></a>

## 5. Durabilidad de mensajes

**Cómo funciona.** El mensaje se publica como persistent. Tras la captura, el cuerpo también permanece en Supabase hasta terminar el trabajo. Una interrupción de procesamiento no debe perder ese trabajo ni duplicar su aviso.

**Prueba realizada.**

1. Verificar persistence=persistent en una lectura real de IBM.
2. Persistir y retirar un mensaje, pausar antes de procesarlo y recuperarlo en otro ciclo.
3. Interrumpir el backend PostgreSQL dedicado a la RPC de una tarjeta de ensayo.
4. Comprobar cero avisos parciales y recuperar con otra invocación de Vercel.

**Resultado esperado.** El cuerpo se conserva durante la interrupción. Antes de recuperarse no hay un aviso parcial; después el inbox termina DONE y existe un solo aviso.

**Resultado obtenido.** Persistencia IBM confirmada. El backend SQL fue terminado; quedó PENDING y cero avisos. Otro tick respondió 200, terminó DONE con attempts=2 y creó exactamente una notificación.

**Veredicto: correcto en el alcance descrito.**

**Alcance de esta evidencia.** La interrupción fue real sobre el backend de la RPC identificado para el ensayo. No se reiniciaron IBM MQ ni el proveedor Vercel: no se presenta esta evidencia como una prueba de reinicio del queue manager.

### Respuestas y comprobación

El siguiente extracto selecciona campos y estados de los registros originales. Los nombres de agrupación son explicativos; las respuestas completas, sin esa selección, se conservan debajo.

```json
{
  "persistence": "persistent",
  "interruption": {
    "status": 200,
    "body": {
      "pid": 382242,
      "queryStart": "2026-10-20T03:47:13.696902+00:00",
      "terminated": true,
      "backendStart": "2026-10-20T03:47:13.358211+00:00",
      "reminderStatus": "QUEUED",
      "applicationName": "authcdn-e2e-interrupt-155d2be1",
      "fixtureNotifications": 0
    }
  },
  "beforeRecovery": {
    "state": "PENDING",
    "notifications": []
  },
  "recoveryTick": {
    "request": {
      "method": "POST",
      "path": "/api/mq/tick",
      "body": {}
    },
    "elapsedMs": 4223,
    "status": 200,
    "body": {
      "published": 0,
      "captured": 0,
      "worked": 1,
      "errors": 0
    }
  },
  "afterRecovery": {
    "state": "DONE",
    "attempts": 2,
    "notifications": [
      {
        "id": "0c0cc90a-cc9b-46d1-a2fe-ab13bf56a39a",
        "event_id": "8cfbcf5a-804d-400b-8018-504cd641fcb6",
        "message": "La tarjeta \"MQ-E2E-20261020004000 155d2be1 interrupcion-real-rpc\" vence el 2026-10-20T04:47:07Z.",
        "created_at": "2026-10-20T03:47:26.073471+00:00"
      }
    ]
  }
}
```

![Durabilidad de mensajes](capturas/22-ibm-boq-persistencia.png)

*Captura real: un mensaje persistente en la BOQ; el MsgId de la prueba principal se identifica en la respuesta REST.*

![Durabilidad de mensajes](capturas/respuesta-c17.png)

*Vista del backend interrumpido, estado durable y recuperación.*

![Durabilidad de mensajes](capturas/43-avisos-finales-firefox.png)

*Captura real: aviso interrupcion-real-rpc de la ronda 155d2be1.*

### Evidencias originales de este requisito

**`BROKER-PERSISTENCE` · 19-10-2026 21:54:00 UTC−03 · PASS.** [Registro original](respuestas/phase-C.json).

<details>
<summary>Ver petición, respuesta o consulta y estado completo registrado</summary>

```json
{
  "request": {
    "role": "consumer",
    "method": "GET",
    "queue": "AUTHCDN.REMINDERS.Q",
    "selector": {
      "id": "ID:414d51204155544843444e514d2020203736d56a06ad1c40"
    },
    "body": null
  },
  "status": 200,
  "body": {
    "cardId": "c65fade2-7ae4-4ccb-be7d-9c43229caa2c",
    "eventId": "2a4627f8-d401-440b-a4f5-611edd10fe08",
    "eventType": "TASK_REMINDER_DUE",
    "expiresAt": "2026-10-20T01:11:08.738Z",
    "occurredAt": "2026-10-20T00:51:21.306Z",
    "reminderId": "456bc06e-f5b3-4071-b7db-845da94f4835",
    "workspaceId": "443b712e-a038-45b5-bdc9-be54b9abad82",
    "schemaVersion": 1,
    "scheduleVersion": 2
  },
  "metadata": {
    "ibm-mq-md-messageId": "ID:414d51204155544843444e514d2020203736d56a06ad1c40",
    "ibm-mq-md-persistence": "persistent",
    "ibm-mq-md-expiry": "unlimited"
  }
}
```

</details>

**`RECOVERY-INTERRUPTION` · 19-10-2026 21:54:24 UTC−03 · PASS.** [Registro original](respuestas/phase-C.json).

<details>
<summary>Ver petición, respuesta o consulta y estado completo registrado</summary>

```json
{
  "removed": {
    "request": {
      "role": "consumer",
      "method": "DELETE",
      "queue": "AUTHCDN.REMINDERS.Q",
      "selector": {
        "id": "ID:414d51204155544843444e514d2020203736d56a10ad1c40"
      },
      "body": null
    },
    "status": 200,
    "body": {
      "cardId": "c65fade2-7ae4-4ccb-be7d-9c43229caa2c",
      "eventId": "2a4627f8-d401-440b-a4f5-611edd10fe08",
      "eventType": "TASK_REMINDER_DUE",
      "expiresAt": "2026-10-20T01:11:08.738Z",
      "occurredAt": "2026-10-20T00:51:21.306Z",
      "reminderId": "456bc06e-f5b3-4071-b7db-845da94f4835",
      "workspaceId": "443b712e-a038-45b5-bdc9-be54b9abad82",
      "schemaVersion": 1,
      "scheduleVersion": 2
    },
    "metadata": {
      "ibm-mq-md-messageId": "ID:414d51204155544843444e514d2020203736d56a10ad1c40",
      "ibm-mq-md-persistence": "persistent",
      "ibm-mq-md-expiry": "unlimited"
    }
  },
  "pending": {
    "status": 200,
    "body": [
      {
        "id": "cb89c973-cac0-4cd0-bf32-17f49eb9ecc5",
        "queue_name": "AUTHCDN.REMINDERS.Q",
        "message_id": "ID:414d51204155544843444e514d2020203736d56a10ad1c40",
        "correlation_id": null,
        "reply_to": null,
        "body": "{\"cardId\":\"c65fade2-7ae4-4ccb-be7d-9c43229caa2c\",\"eventId\":\"2a4627f8-d401-440b-a4f5-611edd10fe08\",\"eventType\":\"TASK_REMINDER_DUE\",\"expiresAt\":\"2026-10-20T01:11:08.738Z\",\"occurredAt\":\"2026-10-20T00:51:21.306Z\",\"reminderId\":\"456bc06e-f5b3-4071-b7db-845da94f4835\",\"workspaceId\":\"443b712e-a038-45b5-bdc9-be54b9abad82\",\"schemaVersion\":1,\"scheduleVersion\":2}",
        "state": "PENDING",
        "attempts": 0,
        "output_attempts": 0,
        "output": null,
        "next_attempt_at": "2026-10-20T00:54:22.609284+00:00",
        "last_error": null
      }
    ]
  }
}
```

</details>

**`INTERRUPTION-ACTUAL-PROCESS` · 20-10-2026 00:47:14 UTC−03 · PASS.** [Registro original](respuestas/phase-DEEP-155d2be1.json).

<details>
<summary>Ver petición, respuesta o consulta y estado completo registrado</summary>

```json
{
  "status": 200,
  "body": {
    "pid": 382242,
    "queryStart": "2026-10-20T03:47:13.696902+00:00",
    "terminated": true,
    "backendStart": "2026-10-20T03:47:13.358211+00:00",
    "reminderStatus": "QUEUED",
    "applicationName": "authcdn-e2e-interrupt-155d2be1",
    "fixtureNotifications": 0
  }
}
```

</details>

**`INTERRUPTION-ROLLBACK` · 20-10-2026 00:47:17 UTC−03 · PASS.** [Registro original](respuestas/phase-DEEP-155d2be1.json).

<details>
<summary>Ver petición, respuesta o consulta y estado completo registrado</summary>

```json
{
  "signal": {
    "status": 200,
    "body": {
      "pid": 382242,
      "queryStart": "2026-10-20T03:47:13.696902+00:00",
      "terminated": true,
      "backendStart": "2026-10-20T03:47:13.358211+00:00",
      "reminderStatus": "QUEUED",
      "applicationName": "authcdn-e2e-interrupt-155d2be1",
      "fixtureNotifications": 0
    }
  },
  "tick": {
    "request": {
      "method": "POST",
      "path": "/api/mq/tick",
      "body": {}
    },
    "elapsedMs": 5192,
    "status": 502,
    "body": {
      "published": 1,
      "captured": 1,
      "worked": 1,
      "errors": 1
    }
  },
  "inbox": {
    "status": 200,
    "body": [
      {
        "id": "715b20c4-f4f6-4c90-b715-0a20798259bb",
        "message_id": "ID:414D51204155544843444E514D2020203736D56A11491E40",
        "body": "{\"schemaVersion\":1,\"eventId\":\"8cfbcf5a-804d-400b-8018-504cd641fcb6\",\"eventType\":\"TASK_REMINDER_DUE\",\"reminderId\":\"c3bf2cf5-e609-41a8-b991-adc3cec6d957\",\"cardId\":\"56453971-70c2-4612-986b-4466862b39f2\",\"workspaceId\":\"443b712e-a038-45b5-bdc9-be54b9abad82\",\"scheduleVersion\":2,\"occurredAt\":\"2026-10-20T03:47:12.723Z\",\"expiresAt\":\"2026-10-20T04:47:07.013Z\"}",
        "state": "PENDING",
        "attempts": 1,
        "output_attempts": 0,
        "output": null,
        "next_attempt_at": "2026-10-20T03:48:43.998838+00:00",
        "last_error": "PROCESSING_OR_DELIVERY_UNCONFIRMED"
      }
    ]
  },
  "notifications": {
    "status": 200,
    "body": []
  }
}
```

</details>

**`INTERRUPTION-RECOVERED` · 20-10-2026 00:47:29 UTC−03 · PASS.** [Registro original](respuestas/phase-DEEP-155d2be1.json).

<details>
<summary>Ver petición, respuesta o consulta y estado completo registrado</summary>

```json
{
  "tick": {
    "request": {
      "method": "POST",
      "path": "/api/mq/tick",
      "body": {}
    },
    "elapsedMs": 4223,
    "status": 200,
    "body": {
      "published": 0,
      "captured": 0,
      "worked": 1,
      "errors": 0
    }
  },
  "inbox": {
    "status": 200,
    "body": [
      {
        "id": "715b20c4-f4f6-4c90-b715-0a20798259bb",
        "message_id": "ID:414D51204155544843444E514D2020203736D56A11491E40",
        "body": "{\"schemaVersion\":1,\"eventId\":\"8cfbcf5a-804d-400b-8018-504cd641fcb6\",\"eventType\":\"TASK_REMINDER_DUE\",\"reminderId\":\"c3bf2cf5-e609-41a8-b991-adc3cec6d957\",\"cardId\":\"56453971-70c2-4612-986b-4466862b39f2\",\"workspaceId\":\"443b712e-a038-45b5-bdc9-be54b9abad82\",\"scheduleVersion\":2,\"occurredAt\":\"2026-10-20T03:47:12.723Z\",\"expiresAt\":\"2026-10-20T04:47:07.013Z\"}",
        "state": "DONE",
        "attempts": 2,
        "output_attempts": 0,
        "output": null,
        "next_attempt_at": "2026-10-20T03:47:24.904+00:00",
        "last_error": null
      }
    ]
  },
  "notifications": {
    "status": 200,
    "body": [
      {
        "id": "0c0cc90a-cc9b-46d1-a2fe-ab13bf56a39a",
        "event_id": "8cfbcf5a-804d-400b-8018-504cd641fcb6",
        "message": "La tarjeta \"MQ-E2E-20261020004000 155d2be1 interrupcion-real-rpc\" vence el 2026-10-20T04:47:07Z.",
        "created_at": "2026-10-20T03:47:26.073471+00:00"
      }
    ]
  }
}
```

</details>


<a id="r6"></a>

## 6. DLQ / gestión de mensajes fallidos

**Cómo funciona.** La BOQ de aplicación conserva eventos inválidos o cuyo procesamiento agota sus intentos. La DLQ nativa del queue manager conserva determinados mensajes que IBM no puede entregar. Son mecanismos diferentes y se comprobaron ambos.

**Prueba realizada.**

1. Enviar JSON mal formado, contrato inválido, referencias inconsistentes y ReplyTo no permitido.
2. Comprobar sus motivos y cuerpos originales en AUTHCDN.REMINDERS.BOQ.
3. Comprobar DEADQ=DEV.DEAD.LETTER.QUEUE en la configuración del queue manager.
4. Llenar una cola de iniciación exclusiva de ensayo y disparar un nuevo mensaje de control; examinar el mensaje que IBM envía automáticamente a DLQ.

**Resultado esperado.** Los errores de aplicación terminan en BOQ sin aviso de negocio indebido. IBM enruta automáticamente el control que no puede entregar a la DLQ configurada, con cabecera que identifica motivo y destino.

**Resultado obtenido.** BOQ mostró MALFORMED_JSON, INVALID_REMINDER, PERMANENT_ERROR, INVALID_REPLY_DESTINATION y RETRIES_EXHAUSTED. DLQ pasó de cero a uno: mensaje generado por AUTHCDNQM con MQDLH/MQTM, motivo MQRC_Q_FULL y destino INIT de ensayo.

**Veredicto: correcto en el alcance descrito.**

**Alcance de esta evidencia.** El mensaje nativo DLQ es un control MQTM no persistente generado por IBM, distinto de la carga persistente que disparó el ensayo. Examinarlo por REST devuelve 501 MQWB0309E por formato binario no soportado; su cabecera sí se verificó en consola y se conservó. Ese 501 no es evidencia de fallo del enrutamiento.

### Respuestas y comprobación

El siguiente extracto selecciona campos y estados de los registros originales. Los nombres de agrupación son explicativos; las respuestas completas, sin esa selección, se conservan debajo.

```json
{
  "boq": {
    "queue": "AUTHCDN.REMINDERS.BOQ",
    "reason": "RETRIES_EXHAUSTED",
    "attempts": 5
  },
  "nativeDlq": {
    "queue": "DEV.DEAD.LETTER.QUEUE",
    "applicationId": "AUTHCDNQM",
    "headers": [
      "MQDLH",
      "MQTM"
    ]
  },
  "nativeBinaryBrowse": {
    "request": {
      "method": "GET",
      "queue": "DEV.DEAD.LETTER.QUEUE",
      "messageId": "ID:414d51204155544843444e514d2020203736d56a1db32140"
    },
    "status": 501,
    "body": {
      "error": [
        {
          "msgId": "MQWB0309E",
          "action": "Resubmit the request, correcting any issues.",
          "completionCode": 0,
          "reasonCode": 0,
          "type": "rest",
          "message": "MQWB0309E: The received or browsed message type is unsupported by the mqweb server.",
          "explanation": "The mqweb server successfully received an MQ message, but was of an unsupported message type."
        }
      ]
    },
    "note": "La consola muestra y conserva el MQDLH/MQTM. REST solo maneja MQSTR/JMS TextMessage; no se hace DELETE."
  }
}
```

![DLQ / gestión de mensajes fallidos](capturas/45-ibm-boq-cinco-intentos.png)

*Captura real de BOQ: RETRIES_EXHAUSTED y attempts=5.*

![DLQ / gestión de mensajes fallidos](capturas/19-ibm-config-deadq-firefox.png)

*Captura real de DEADQ asignada.*

![DLQ / gestión de mensajes fallidos](capturas/39-dlq-cabecera-motivo-destino.png)

*Captura real de DLQ nativa: MQRC_Q_FULL y destino de ensayo.*

### Evidencias originales de este requisito

**`IBM-CONSOLE-FIVE-RETRIES` · 20-10-2026 01:31:54 UTC−03 · PASS.** [Registro original](respuestas/phase-IBM-RETRIES.json).

<details>
<summary>Ver petición, respuesta o consulta y estado completo registrado</summary>

```json
{
  "queue": "AUTHCDN.REMINDERS.BOQ",
  "body": {
    "schemaVersion": 1,
    "type": "MQ_REST_QUARANTINE",
    "inboxId": "0ec5288f-f3af-4f31-bbbc-9c5f33edd30a",
    "sourceQueue": "AUTHCDN.REMINDERS.Q",
    "messageId": "ID:414D51204155544843444E514D2020203736D56A0F491E40",
    "reason": "RETRIES_EXHAUSTED",
    "attempts": 5,
    "originalBody": "{\"schemaVersion\":1,\"eventId\":\"f8111b46-4ac9-4b10-a0e3-d2bb8b27f093\",\"eventType\":\"TASK_REMINDER_DUE\",\"reminderId\":\"263d2bd0-fafa-43e5-a1b0-b5bc3f6ad3f1\",\"cardId\":\"b39f29c8-0d2b-4158-a8ca-c5b760806696\",\"workspaceId\":\"443b712e-a038-45b5-bdc9-be54b9abad82\",\"scheduleVersion\":2,\"occurredAt\":\"2026-10-20T03:45:25.472Z\",\"expiresAt\":\"2026-10-20T04:45:20.242Z\"}"
  },
  "screenshot": "45-ibm-boq-cinco-intentos.png"
}
```

</details>

**`IBM-CONSOLE-DEADQ-CONFIRMED` · 20-10-2026 00:35:47 UTC−03 · PASS.** [Registro original](respuestas/phase-IBM-CONSOLE.json).

<details>
<summary>Ver petición, respuesta o consulta y estado completo registrado</summary>

```json
{
  "queueManager": "AUTHCDNQM",
  "property": "DEADQ",
  "configuredValue": "DEV.DEAD.LETTER.QUEUE",
  "screenshot": "19-ibm-config-deadq-firefox.png"
}
```

</details>

**`NATIVE-DLQ-AUTOMATIC-ROUTE` · 20-10-2026 00:54:06 UTC−03 · PASS.** [Registro original](respuestas/dlq-native-state.json).

<details>
<summary>Ver petición, respuesta o consulta y estado completo registrado</summary>

```json
{
  "queue": "DEV.DEAD.LETTER.QUEUE",
  "applicationId": "AUTHCDNQM",
  "headers": [
    "MQDLH",
    "MQTM"
  ],
  "nativeHeader": "Skip to main content\nIBM\n MQ\nLogout\nHome\nManage\nLearning resources\nSettings\nToggle opening or closing the side navigation\nManage\nAUTHCDNQM\nQueues\nLocal Queue: DEV.DEAD.LETTER.QUEUE messages\nActions\nMessage details\nClose\nGeneral\nContext\nIdentifiers\nDead-letter header\nData\nReason\tMQRC_Q_FULL\nDestination queue\tAUTHCDN.E2E.DLQ.INIT.BE495EF3\nDestination queue manager\tAUTHCDNQM\nOriginal encoding\t546\nOriginal CCSID\t1208\nOriginal format\tMQTRIG\nPut application type\tQueue manager\nPut application name\tAUTHCDNQM\nPut date\t20261020\nPut time\t03530331\nClose\nDownload\n",
  "identifiers": "Skip to main content\nIBM\n MQ\nLogout\nHome\nManage\nLearning resources\nSettings\nToggle opening or closing the side navigation\nManage\nAUTHCDNQM\nQueues\nLocal Queue: DEV.DEAD.LETTER.QUEUE messages\nActions\nMessage details\nClose\nGeneral\nContext\nIdentifiers\nDead-letter header\nData\nMessage ID\tID:414d51204155544843444e514d2020203736d56a1db32140\nClose\nDownload\n",
  "screenshots": [
    "37-dlq-resultado-nativo.png",
    "39-dlq-cabecera-motivo-destino.png"
  ],
  "note": "Mensaje de control MQTM generado por IBM, no un JSON escrito manualmente en DLQ. El disparador es la cola temporal y el motivo esperado es cola de iniciación llena."
}
```

</details>

**`NATIVE-DLQ-REST-BINARY-LIMIT` · 20-10-2026 00:54:57 UTC−03 · PASS.** [Registro original](respuestas/dlq-native-state.json).

<details>
<summary>Ver petición, respuesta o consulta y estado completo registrado</summary>

```json
{
  "request": {
    "method": "GET",
    "queue": "DEV.DEAD.LETTER.QUEUE",
    "messageId": "ID:414d51204155544843444e514d2020203736d56a1db32140"
  },
  "status": 501,
  "body": {
    "error": [
      {
        "msgId": "MQWB0309E",
        "action": "Resubmit the request, correcting any issues.",
        "completionCode": 0,
        "reasonCode": 0,
        "type": "rest",
        "message": "MQWB0309E: The received or browsed message type is unsupported by the mqweb server.",
        "explanation": "The mqweb server successfully received an MQ message, but was of an unsupported message type."
      }
    ]
  },
  "note": "La consola muestra y conserva el MQDLH/MQTM. REST solo maneja MQSTR/JMS TextMessage; no se hace DELETE."
}
```

</details>


<a id="r7"></a>

## 7. Reintentos de procesamiento

**Cómo funciona.** Un error recuperable de process_reminder_event conserva el trabajo y aumenta attempts. Al alcanzar cinco fallos, se entrega una cuarentena persistente a BOQ. Los fallos de entrega de una salida durable se conservan para recuperación posterior.

**Prueba realizada.**

1. Provocar un error SQL P0001 solo al insertar el aviso de una tarjeta propia.
2. Permitir que el consumidor cloud procese sus reintentos sobre el evento recibido de IBM.
3. Medir las cinco invocaciones fallidas y revisar attempts, salida BOQ y ausencia de avisos.
4. Como prueba complementaria, fallar cinco entregas de salida y corregir el destino para comprobar su recuperación.

**Resultado esperado.** Cinco fallos reales del consumidor: attempts=5, cero avisos de negocio y cuarentena RETRIES_EXHAUSTED confirmada en BOQ. Los fallos de salida conservan el cuerpo hasta poder entregarlo.

**Resultado obtenido.** Se contaron cinco fallos RPC, inbox attempts=5, salida QUARANTINE terminada y cero avisos. La consola IBM mostró el mensaje BOQ con attempts=5. La salida con destino corregido terminó después de cinco errores sin perder el cuerpo.

**Veredicto: correcto en el alcance descrito.**

**Alcance de esta evidencia.** El error se inyectó en SQL solo para ese fixture. El evento y la BOQ usan IBM real. No significa que se haya caído el broker ni que IBM rechazara cinco POST; lo probado aquí es el reintento de procesamiento del consumidor.

### Respuestas y comprobación

El siguiente extracto selecciona campos y estados de los registros originales. Los nombres de agrupación son explicativos; las respuestas completas, sin esa selección, se conservan debajo.

```json
{
  "actualRpcFailures": {
    "is_called": true,
    "last_value": 5
  },
  "inbox": {
    "state": "DONE",
    "attempts": 5,
    "outputQueue": "AUTHCDN.REMINDERS.BOQ",
    "purpose": "QUARANTINE",
    "outputAttempts": 1
  },
  "quarantineReason": "RETRIES_EXHAUSTED",
  "notifications": []
}
```

![Reintentos de procesamiento](capturas/respuesta-c25.png)

*Vista del contador persistente y de los cinco fallos reales medidos.*

![Reintentos de procesamiento](capturas/45-ibm-boq-cinco-intentos.png)

*Captura real: resultado final en BOQ de la misma ronda.*

### Evidencias originales de este requisito

**`CONSUMER-FIVE-EXHAUSTED` · 20-10-2026 00:47:00 UTC−03 · PASS.** [Registro original](respuestas/phase-DEEP-155d2be1.json).

<details>
<summary>Ver petición, respuesta o consulta y estado completo registrado</summary>

```json
{
  "inbox": {
    "status": 200,
    "body": [
      {
        "id": "0ec5288f-f3af-4f31-bbbc-9c5f33edd30a",
        "message_id": "ID:414D51204155544843444E514D2020203736D56A0F491E40",
        "body": "{\"schemaVersion\":1,\"eventId\":\"f8111b46-4ac9-4b10-a0e3-d2bb8b27f093\",\"eventType\":\"TASK_REMINDER_DUE\",\"reminderId\":\"263d2bd0-fafa-43e5-a1b0-b5bc3f6ad3f1\",\"cardId\":\"b39f29c8-0d2b-4158-a8ca-c5b760806696\",\"workspaceId\":\"443b712e-a038-45b5-bdc9-be54b9abad82\",\"scheduleVersion\":2,\"occurredAt\":\"2026-10-20T03:45:25.472Z\",\"expiresAt\":\"2026-10-20T04:45:20.242Z\"}",
        "state": "DONE",
        "attempts": 5,
        "output_attempts": 1,
        "output": {
          "body": "{\"schemaVersion\":1,\"type\":\"MQ_REST_QUARANTINE\",\"inboxId\":\"0ec5288f-f3af-4f31-bbbc-9c5f33edd30a\",\"sourceQueue\":\"AUTHCDN.REMINDERS.Q\",\"messageId\":\"ID:414D51204155544843444E514D2020203736D56A0F491E40\",\"reason\":\"RETRIES_EXHAUSTED\",\"attempts\":5,\"originalBody\":\"{\\\"schemaVersion\\\":1,\\\"eventId\\\":\\\"f8111b46-4ac9-4b10-a0e3-d2bb8b27f093\\\",\\\"eventType\\\":\\\"TASK_REMINDER_DUE\\\",\\\"reminderId\\\":\\\"263d2bd0-fafa-43e5-a1b0-b5bc3f6ad3f1\\\",\\\"cardId\\\":\\\"b39f29c8-0d2b-4158-a8ca-c5b760806696\\\",\\\"workspaceId\\\":\\\"443b712e-a038-45b5-bdc9-be54b9abad82\\\",\\\"scheduleVersion\\\":2,\\\"occurredAt\\\":\\\"2026-10-20T03:45:25.472Z\\\",\\\"expiresAt\\\":\\\"2026-10-20T04:45:20.242Z\\\"}\"}",
          "queue": "AUTHCDN.REMINDERS.BOQ",
          "purpose": "QUARANTINE"
        },
        "next_attempt_at": "2026-10-20T03:46:47.790386+00:00",
        "last_error": null
      }
    ]
  },
  "actualRpcFailures": {
    "is_called": true,
    "last_value": 5
  },
  "notifications": {
    "status": 200,
    "body": []
  }
}
```

</details>

**`IBM-CONSOLE-FIVE-RETRIES` · 20-10-2026 01:31:54 UTC−03 · PASS.** [Registro original](respuestas/phase-IBM-RETRIES.json).

<details>
<summary>Ver petición, respuesta o consulta y estado completo registrado</summary>

```json
{
  "queue": "AUTHCDN.REMINDERS.BOQ",
  "body": {
    "schemaVersion": 1,
    "type": "MQ_REST_QUARANTINE",
    "inboxId": "0ec5288f-f3af-4f31-bbbc-9c5f33edd30a",
    "sourceQueue": "AUTHCDN.REMINDERS.Q",
    "messageId": "ID:414D51204155544843444E514D2020203736D56A0F491E40",
    "reason": "RETRIES_EXHAUSTED",
    "attempts": 5,
    "originalBody": "{\"schemaVersion\":1,\"eventId\":\"f8111b46-4ac9-4b10-a0e3-d2bb8b27f093\",\"eventType\":\"TASK_REMINDER_DUE\",\"reminderId\":\"263d2bd0-fafa-43e5-a1b0-b5bc3f6ad3f1\",\"cardId\":\"b39f29c8-0d2b-4158-a8ca-c5b760806696\",\"workspaceId\":\"443b712e-a038-45b5-bdc9-be54b9abad82\",\"scheduleVersion\":2,\"occurredAt\":\"2026-10-20T03:45:25.472Z\",\"expiresAt\":\"2026-10-20T04:45:20.242Z\"}"
  },
  "screenshot": "45-ibm-boq-cinco-intentos.png"
}
```

</details>

**`RETRY-NO-LOSS` · 19-10-2026 21:58:04 UTC−03 · PASS.** [Registro original](respuestas/phase-D.json).

<details>
<summary>Ver petición, respuesta o consulta y estado completo registrado</summary>

```json
{
  "counts": [
    1,
    2,
    3,
    4,
    5
  ],
  "note": "Se aceleró next_attempt_at únicamente en este fixture; las esperas calculadas quedaron registradas. Es fallo de salida, no cinco fallos de la RPC de negocio."
}
```

</details>

**`RETRY-RECOVERED` · 19-10-2026 21:58:10 UTC−03 · PASS.** [Registro original](respuestas/phase-D.json).

<details>
<summary>Ver petición, respuesta o consulta y estado completo registrado</summary>

```json
{
  "status": 200,
  "body": [
    {
      "id": "2d63e3da-11bd-43cf-bfe6-cc3d607a5695",
      "queue_name": "AUTHCDN.REMINDERS.Q",
      "message_id": "ID:B1AE7F038C4D2D90E06B630AB4DB509C928F77C71DB881B8",
      "correlation_id": null,
      "reply_to": null,
      "body": "{\"testRun\":\"MQ-E2E-20261020004000\",\"case\":\"lease-and-retry\",\"note\":\"Fixture SQL: no es un MsgId emitido por IBM.\"}",
      "state": "DONE",
      "attempts": 2,
      "output_attempts": 6,
      "output": {
        "body": "{\"schemaVersion\":1,\"type\":\"MQ_REST_QUARANTINE\",\"testRun\":\"MQ-E2E-20261020004000\",\"inboxId\":\"2d63e3da-11bd-43cf-bfe6-cc3d607a5695\",\"reason\":\"E2E_INJECTED_OUTPUT_FAILURE\",\"originalBody\":\"{\\\"testRun\\\":\\\"MQ-E2E-20261020004000\\\",\\\"case\\\":\\\"lease-and-retry\\\",\\\"note\\\":\\\"Fixture SQL: no es un MsgId emitido por IBM.\\\"}\"}",
        "queue": "AUTHCDN.REMINDERS.BOQ",
        "purpose": "QUARANTINE"
      },
      "next_attempt_at": "2026-10-20T00:58:03.796+00:00",
      "last_error": null
    }
  ]
}
```

</details>


<a id="r8"></a>

## 8. Políticas de retención

**Cómo funciona.** El mantenimiento aplica una retención de 30 días a registros técnicos terminados elegibles. Conserva trabajos pendientes y cuarentenas. Esta limpieza está separada de la expiración de los mensajes en IBM.

**Prueba realizada.**

1. Preparar tres registros técnicos propios con 40 días de antigüedad: DONE ordinario, PENDING y cuarentena.
2. Ejecutar mq_rest_maintenance.
3. Comprobar que se purga el DONE ordinario y permanecen PENDING y cuarentena.
4. Verificar que el Cron permanente de mantenimiento quedó configurado.

**Resultado esperado.** La política elimina el registro terminado elegible antiguo y conserva los dos registros que requieren procesamiento o revisión.

**Resultado obtenido.** Mantenimiento respondió 200 con purgedInbox=1. El DONE ordinario desapareció; la consulta devolvió PENDING y cuarentena. El trabajo de mantenimiento fue verificado activo cada minuto.

**Veredicto: correcto en el alcance descrito.**

**Alcance de esta evidencia.** Los 40 días se simularon cambiando fechas solo de fixtures; no transcurrieron 40 días de observación. No se estableció una purga automática de mensajes BOQ/DLQ ni una retención administrativa global de IBM. Sus mensajes se conservan hasta revisión y retirada explícita.

### Respuestas y comprobación

El siguiente extracto selecciona campos y estados de los registros originales. Los nombres de agrupación son explicativos; las respuestas completas, sin esa selección, se conservan debajo.

```json
{
  "maintenance": {
    "status": 200,
    "body": {
      "purgedInbox": 1,
      "expiredCards": 1,
      "purgedOutbox": 0,
      "failureAlerts": 1
    }
  },
  "retainedRecords": {
    "status": 200,
    "body": [
      {
        "id": "eb747938-e7a9-43b4-8619-73fa05205568",
        "state": "DONE",
        "created_at": "2026-09-10T01:01:48.983+00:00",
        "completed_at": "2026-09-10T01:01:48.983+00:00",
        "output": {
          "body": "{\"testRun\":\"MQ-E2E-20261020004000\"}",
          "queue": "AUTHCDN.REMINDERS.BOQ",
          "purpose": "QUARANTINE"
        }
      },
      {
        "id": "a9fee66d-ceb9-4ffc-b67e-33da8ef86eba",
        "state": "PENDING",
        "created_at": "2026-09-10T01:01:48.406+00:00",
        "completed_at": null,
        "output": null
      }
    ]
  },
  "deletedOldDoneId": "9230ad25-f5f1-4a1d-934c-96d4556bc750",
  "technicalRetentionDays": 30,
  "fixtureAgeDays": 40
}
```

![Políticas de retención](capturas/respuesta-c31.png)

*Vista de los fixtures de antigüedad, ejecución y registros conservados.*

### Evidencias originales de este requisito

**`RETENTION-PREPARE` · 19-10-2026 22:01:49 UTC−03 · PASS.** [Registro original](respuestas/phase-E.json).

<details>
<summary>Ver petición, respuesta o consulta y estado completo registrado</summary>

```json
{
  "policy": [
    {
      "id": "9230ad25-f5f1-4a1d-934c-96d4556bc750",
      "messageId": "ID:8CBA4722349AE1FCC2FBB156A361773C5EFACC9EF1ECB5D2",
      "name": "old-done"
    },
    {
      "id": "a9fee66d-ceb9-4ffc-b67e-33da8ef86eba",
      "messageId": "ID:13F8504792B3E4DEC9E341D96A4419B420F1709473C036BB",
      "name": "old-pending"
    },
    {
      "id": "eb747938-e7a9-43b4-8619-73fa05205568",
      "messageId": "ID:96BD200966EE6F827768CD13161F4D1D2CBBE9DDCC78A70D",
      "name": "old-quarantine"
    }
  ],
  "note": "Inyección de fechas de ensayo en la base real; no son 40 días de observación transcurridos."
}
```

</details>

**`MAINTENANCE-EXECUTE` · 19-10-2026 22:01:56 UTC−03 · PASS.** [Registro original](respuestas/phase-E.json).

<details>
<summary>Ver petición, respuesta o consulta y estado completo registrado</summary>

```json
{
  "status": 200,
  "body": {
    "purgedInbox": 1,
    "expiredCards": 1,
    "purgedOutbox": 0,
    "failureAlerts": 1
  }
}
```

</details>

**`RETENTION-RESULT` · 19-10-2026 22:01:56 UTC−03 · PASS.** [Registro original](respuestas/phase-E.json).

<details>
<summary>Ver petición, respuesta o consulta y estado completo registrado</summary>

```json
{
  "status": 200,
  "body": [
    {
      "id": "eb747938-e7a9-43b4-8619-73fa05205568",
      "state": "DONE",
      "created_at": "2026-09-10T01:01:48.983+00:00",
      "completed_at": "2026-09-10T01:01:48.983+00:00",
      "output": {
        "body": "{\"testRun\":\"MQ-E2E-20261020004000\"}",
        "queue": "AUTHCDN.REMINDERS.BOQ",
        "purpose": "QUARANTINE"
      }
    },
    {
      "id": "a9fee66d-ceb9-4ffc-b67e-33da8ef86eba",
      "state": "PENDING",
      "created_at": "2026-09-10T01:01:48.406+00:00",
      "completed_at": null,
      "output": null
    }
  ]
}
```

</details>

**`FINAL-CLOUD-CHECK` · 20-10-2026 01:25:34 UTC−03 · PASS.** [Registro original](respuestas/phase-FINAL-20261020.json).

<details>
<summary>Ver petición, respuesta o consulta y estado completo registrado</summary>

```json
{
  "activeTestReminders": 0,
  "health": {
    "deliveryRetries": 0,
    "failedPublications": 0,
    "pendingInbox": 0,
    "quarantined": 7,
    "staleInbox": 0
  },
  "jobs": [
    {
      "active": true,
      "name": "authcdn-mq-rest-minute",
      "schedule": "* * * * *"
    },
    {
      "active": true,
      "name": "authcdn-mq-maintenance",
      "schedule": "* * * * *"
    }
  ],
  "recentCronRuns": [
    {
      "end_time": "2026-10-20T04:25:00.079953+00:00",
      "jobid": 3,
      "start_time": "2026-10-20T04:25:00.0668+00:00",
      "status": "succeeded"
    },
    {
      "end_time": "2026-10-20T04:25:00.091701+00:00",
      "jobid": 2,
      "start_time": "2026-10-20T04:25:00.06606+00:00",
      "status": "succeeded"
    },
    {
      "end_time": "2026-10-20T04:24:00.033081+00:00",
      "jobid": 3,
      "start_time": "2026-10-20T04:24:00.022764+00:00",
      "status": "succeeded"
    },
    {
      "end_time": "2026-10-20T04:24:00.026206+00:00",
      "jobid": 2,
      "start_time": "2026-10-20T04:24:00.021538+00:00",
      "status": "succeeded"
    },
    {
      "end_time": "2026-10-20T04:23:00.03409+00:00",
      "jobid": 3,
      "start_time": "2026-10-20T04:23:00.023261+00:00",
      "status": "succeeded"
    },
    {
      "end_time": "2026-10-20T04:23:00.026647+00:00",
      "jobid": 2,
      "start_time": "2026-10-20T04:23:00.022055+00:00",
      "status": "succeeded"
    }
  ],
  "recentHttpResponses": [
    {
      "created": "2026-10-20T04:25:00.091708+00:00",
      "error_msg": null,
      "id": 181,
      "status_code": 200,
      "timed_out": false
    },
    {
      "created": "2026-10-20T04:24:00.026413+00:00",
      "error_msg": null,
      "id": 180,
      "status_code": 200,
      "timed_out": false
    },
    {
      "created": "2026-10-20T04:23:00.026641+00:00",
      "error_msg": null,
      "id": 179,
      "status_code": 200,
      "timed_out": false
    }
  ],
  "temporaryFunctions": 0,
  "temporaryTriggers": 0
}
```

</details>


<a id="r9"></a>

## 9. Expiración de mensajes

**Cómo funciona.** IBM aplica el TTL del mensaje y deja de ofrecerlo al vencer. El mantenimiento SQL reconcilia el recordatorio que quedó sin procesar, conservando la publicación histórica.

**Prueba realizada.**

1. Publicar un mensaje persistente con TTL de 1200 ms.
2. Examinarlo antes y después de vencer, sin ejecutar DELETE sobre él.
3. Preparar además un recordatorio propio con vencimiento pasado y ejecutar mantenimiento.
4. Comprobar EXPIRED en el recordatorio y PUBLISHED en su outbox histórico.

**Resultado esperado.** POST 201; GET antes del vencimiento 200 y después 204 sin mensaje. SQL marca EXPIRED y conserva el hecho PUBLISHED.

**Resultado obtenido.** El mensaje fue visible con expiración restante y luego devolvió 204. La reconciliación dejó el recordatorio EXPIRED y el outbox PUBLISHED.

**Veredicto: correcto en el alcance descrito.**

**Alcance de esta evidencia.** 204 solo indica que no hay un mensaje disponible con ese selector. En este ensayo no se ejecutó DELETE y el TTL fue la causa comprobada. La reconciliación se probó con una fecha pasada preparada por SQL en un fixture.

### Respuestas y comprobación

El siguiente extracto selecciona campos y estados de los registros originales. Los nombres de agrupación son explicativos; las respuestas completas, sin esa selección, se conservan debajo.

```json
{
  "publication": {
    "request": {
      "role": "consumer",
      "method": "POST",
      "queue": "AUTHCDN.SUMMARY.REPLY.Q",
      "selector": {
        "expiry": 1200
      },
      "body": {
        "testRun": "MQ-E2E-20261020004000",
        "case": "broker-ttl"
      }
    },
    "status": 201,
    "body": "",
    "metadata": {
      "ibm-mq-md-messageId": "ID:414d51204155544843444e514d2020203736d56a07ad1c40"
    }
  },
  "beforeExpiry": {
    "request": {
      "role": "producer",
      "method": "GET",
      "queue": "AUTHCDN.SUMMARY.REPLY.Q",
      "selector": {
        "id": "ID:414d51204155544843444e514d2020203736d56a07ad1c40"
      },
      "body": null
    },
    "status": 200,
    "body": {
      "testRun": "MQ-E2E-20261020004000",
      "case": "broker-ttl"
    },
    "metadata": {
      "ibm-mq-md-messageId": "ID:414d51204155544843444e514d2020203736d56a07ad1c40",
      "ibm-mq-md-persistence": "persistent",
      "ibm-mq-md-expiry": "500"
    }
  },
  "afterExpiry": {
    "request": {
      "role": "producer",
      "method": "GET",
      "queue": "AUTHCDN.SUMMARY.REPLY.Q",
      "selector": {
        "id": "ID:414d51204155544843444e514d2020203736d56a07ad1c40"
      },
      "body": null
    },
    "status": 204,
    "body": "",
    "metadata": {}
  },
  "sqlReconciliation": {
    "reminder": {
      "status": 200,
      "body": [
        {
          "id": "d216680e-867e-4d05-82d5-341c9cf5fb6e",
          "status": "EXPIRED",
          "expires_at": "2026-10-20T01:00:55.742+00:00"
        }
      ]
    },
    "outbox": {
      "status": 200,
      "body": [
        {
          "event_id": "5106d3d9-27a2-478c-b2fa-f4487d1896c3",
          "status": "PUBLISHED",
          "published_at": "2026-10-20T01:01:55.966+00:00"
        }
      ]
    }
  }
}
```

![Expiración de mensajes](capturas/respuesta-c29.png)

*Vista de TTL real en IBM: lectura 200 seguida de 204.*

![Expiración de mensajes](capturas/respuesta-c30.png)

*Vista de la reconciliación del recordatorio con Supabase.*

### Evidencias originales de este requisito

**`TTL-PUBLISH` · 19-10-2026 21:54:06 UTC−03 · PASS.** [Registro original](respuestas/phase-C.json).

<details>
<summary>Ver petición, respuesta o consulta y estado completo registrado</summary>

```json
{
  "request": {
    "role": "consumer",
    "method": "POST",
    "queue": "AUTHCDN.SUMMARY.REPLY.Q",
    "selector": {
      "expiry": 1200
    },
    "body": {
      "testRun": "MQ-E2E-20261020004000",
      "case": "broker-ttl"
    }
  },
  "status": 201,
  "body": "",
  "metadata": {
    "ibm-mq-md-messageId": "ID:414d51204155544843444e514d2020203736d56a07ad1c40"
  }
}
```

</details>

**`TTL-EXPIRY` · 19-10-2026 21:54:09 UTC−03 · PASS.** [Registro original](respuestas/phase-C.json).

<details>
<summary>Ver petición, respuesta o consulta y estado completo registrado</summary>

```json
{
  "before": {
    "request": {
      "role": "producer",
      "method": "GET",
      "queue": "AUTHCDN.SUMMARY.REPLY.Q",
      "selector": {
        "id": "ID:414d51204155544843444e514d2020203736d56a07ad1c40"
      },
      "body": null
    },
    "status": 200,
    "body": {
      "testRun": "MQ-E2E-20261020004000",
      "case": "broker-ttl"
    },
    "metadata": {
      "ibm-mq-md-messageId": "ID:414d51204155544843444e514d2020203736d56a07ad1c40",
      "ibm-mq-md-persistence": "persistent",
      "ibm-mq-md-expiry": "500"
    }
  },
  "after": {
    "request": {
      "role": "producer",
      "method": "GET",
      "queue": "AUTHCDN.SUMMARY.REPLY.Q",
      "selector": {
        "id": "ID:414d51204155544843444e514d2020203736d56a07ad1c40"
      },
      "body": null
    },
    "status": 204,
    "body": "",
    "metadata": {}
  }
}
```

</details>

**`EXPIRY-RECONCILIATION` · 19-10-2026 22:01:56 UTC−03 · PASS.** [Registro original](respuestas/phase-E.json).

<details>
<summary>Ver petición, respuesta o consulta y estado completo registrado</summary>

```json
{
  "reminder": {
    "status": 200,
    "body": [
      {
        "id": "d216680e-867e-4d05-82d5-341c9cf5fb6e",
        "status": "EXPIRED",
        "expires_at": "2026-10-20T01:00:55.742+00:00"
      }
    ]
  },
  "outbox": {
    "status": 200,
    "body": [
      {
        "event_id": "5106d3d9-27a2-478c-b2fa-f4487d1896c3",
        "status": "PUBLISHED",
        "published_at": "2026-10-20T01:01:55.966+00:00"
      }
    ]
  }
}
```

</details>


<a id="r10"></a>

## 10. Alertas de fallos

**Cómo funciona.** Si el productor agota los intentos, el outbox queda FAILED. El mantenimiento genera una notificación para el responsable; el usuario la recibe por la API autenticada y la ve en Avisos. Un identificador estable evita duplicarla.

**Prueba realizada.**

1. Preparar un evento de ensayo válido cuyo TTL ya venció para provocar errores reales del transporte del productor.
2. Permitir cinco intentos normales hasta FAILED.
3. Esperar al Cron de mantenimiento y comprobar la alerta.
4. Ejecutar más ciclos y verificar que sigue existiendo una sola alerta para ese fallo; consultar Avisos con JWT.

**Resultado esperado.** FAILED con attempts=5 genera una alerta visible al responsable. Las ejecuciones repetidas no la duplican.

**Resultado obtenido.** Outbox FAILED con attempts=5. Mantenimiento creó una alerta; los ciclos siguientes conservaron una sola. GET /api/notifications con sesión válida respondió 200 y contenía ese mismo id de aviso.

**Veredicto: correcto en el alcance descrito.**

**Alcance de esta evidencia.** El error del productor fue un TTL vencido validado antes de enviar HTTP a IBM, no una caída del broker. FAILED no se insertó manualmente. La alerta implementada es interna de la aplicación; no se configuró correo ni SMS.

### Respuestas y comprobación

El siguiente extracto selecciona campos y estados de los registros originales. Los nombres de agrupación son explicativos; las respuestas completas, sin esa selección, se conservan debajo.

```json
{
  "failedPublication": {
    "status": 200,
    "body": [
      {
        "event_id": "7694e118-5454-4282-b14d-0dec995b28f7",
        "status": "FAILED",
        "attempts": 5,
        "last_error": "MQ_PUBLICATION_UNCONFIRMED"
      }
    ]
  },
  "alert": {
    "id": "aee13992-3ea4-4a05-b789-ae3e617a3fd2",
    "event_id": "ef85b9b5-995e-61d6-b109-99355dee6885",
    "message": "No se pudo entregar un recordatorio tras agotar los reintentos. Solicita revisión al responsable del tablero.",
    "created_at": "2026-10-20T03:50:00.02134+00:00"
  },
  "alertsAfterExtraCycles": 1,
  "authenticatedNotificationsHttp": 200,
  "sameAlertPresentInUserResponse": true
}
```

![Alertas de fallos](capturas/respuesta-c28.png)

*Vista de la cadena FAILED real → alerta y comprobación de no duplicación.*

![Alertas de fallos](capturas/43-avisos-finales-firefox.png)

*Captura real: la primera alerta corresponde al fallo de la ronda 155d2be1, creada a las 00:50.*

### Evidencias originales de este requisito

**`PUBLISHER-FIVE-FAILED` · 20-10-2026 00:49:03 UTC−03 · PASS.** [Registro original](respuestas/phase-DEEP-155d2be1.json).

<details>
<summary>Ver petición, respuesta o consulta y estado completo registrado</summary>

```json
{
  "status": 200,
  "body": [
    {
      "event_id": "7694e118-5454-4282-b14d-0dec995b28f7",
      "status": "FAILED",
      "attempts": 5,
      "last_error": "MQ_PUBLICATION_UNCONFIRMED"
    }
  ]
}
```

</details>

**`ALERT-REAL-CHAIN` · 20-10-2026 00:50:02 UTC−03 · PASS.** [Registro original](respuestas/phase-DEEP-155d2be1.json).

<details>
<summary>Ver petición, respuesta o consulta y estado completo registrado</summary>

```json
{
  "outbox": {
    "status": 200,
    "body": [
      {
        "event_id": "7694e118-5454-4282-b14d-0dec995b28f7",
        "status": "FAILED",
        "attempts": 5,
        "last_error": "MQ_PUBLICATION_UNCONFIRMED"
      }
    ]
  },
  "notifications": {
    "status": 200,
    "body": [
      {
        "id": "aee13992-3ea4-4a05-b789-ae3e617a3fd2",
        "event_id": "ef85b9b5-995e-61d6-b109-99355dee6885",
        "message": "No se pudo entregar un recordatorio tras agotar los reintentos. Solicita revisión al responsable del tablero.",
        "created_at": "2026-10-20T03:50:00.02134+00:00"
      }
    ]
  },
  "note": "FAILED fue producido por los reintentos, no insertado manualmente."
}
```

</details>

**`ALERT-NO-DUPLICATE` · 20-10-2026 00:50:06 UTC−03 · PASS.** [Registro original](respuestas/phase-DEEP-155d2be1.json).

<details>
<summary>Ver petición, respuesta o consulta y estado completo registrado</summary>

```json
{
  "tick": {
    "request": {
      "method": "POST",
      "path": "/api/mq/tick",
      "body": {}
    },
    "elapsedMs": 4088,
    "status": 200,
    "body": {
      "published": 0,
      "captured": 0,
      "worked": 0,
      "errors": 0
    }
  },
  "notifications": {
    "status": 200,
    "body": [
      {
        "id": "aee13992-3ea4-4a05-b789-ae3e617a3fd2",
        "event_id": "ef85b9b5-995e-61d6-b109-99355dee6885",
        "message": "No se pudo entregar un recordatorio tras agotar los reintentos. Solicita revisión al responsable del tablero.",
        "created_at": "2026-10-20T03:50:00.02134+00:00"
      }
    ]
  }
}
```

</details>

**`FIREFOX-FINAL-NOTIFICATIONS` · 20-10-2026 01:30:03 UTC−03 · PASS.** [Registro original](respuestas/phase-FIREFOX-APP.json).

<details>
<summary>Ver petición, respuesta o consulta y estado completo registrado</summary>

```json
{
  "request": {
    "method": "GET",
    "path": "/api/notifications",
    "jwt": "validado; valor omitido"
  },
  "status": 200,
  "body": {
    "notifications": [
      {
        "id": "aee13992-3ea4-4a05-b789-ae3e617a3fd2",
        "card_id": "693c0929-b042-4811-ab78-c0273ee70c70",
        "message": "No se pudo entregar un recordatorio tras agotar los reintentos. Solicita revisión al responsable del tablero.",
        "created_at": "2026-10-20T03:50:00.02134+00:00",
        "read_at": null
      },
      {
        "id": "0c0cc90a-cc9b-46d1-a2fe-ab13bf56a39a",
        "card_id": "56453971-70c2-4612-986b-4466862b39f2",
        "message": "La tarjeta \"MQ-E2E-20261020004000 155d2be1 interrupcion-real-rpc\" vence el 2026-10-20T04:47:07Z.",
        "created_at": "2026-10-20T03:47:26.073471+00:00",
        "read_at": null
      },
      {
        "id": "50ad3546-69bd-4f15-83a9-ccd82832b3f9",
        "card_id": "fe7205b6-73f9-4263-914e-6bcad9e3f216",
        "message": "No se pudo entregar un recordatorio tras agotar los reintentos. Solicita revisión al responsable del tablero.",
        "created_at": "2026-10-20T03:43:00.038349+00:00",
        "read_at": null
      },
      {
        "id": "b81b773b-e04e-47d0-98ad-08ea8bd16f45",
        "card_id": "6770bf98-0838-4e7b-ae91-31f29731893e",
        "message": "La tarjeta \"MQ-E2E-20261020004000 ffea3cca interrupcion-real-rpc\" vence el 2026-10-20T04:41:57Z.",
        "created_at": "2026-10-20T03:42:04.260158+00:00",
        "read_at": null
      },
      {
        "id": "0e244320-b336-4b41-8842-a28a5aae5b3e",
        "card_id": "bd53b87f-b0af-4479-bcc2-a38d35f3f47f",
        "message": "La tarjeta \"MQ-E2E-20261020004000 ffea3cca cinco-reintentos-consumidor\" vence el 2026-10-20T04:39:46Z.",
        "created_at": "2026-10-20T03:41:56.697112+00:00",
        "read_at": null
      },
      {
        "id": "4911bd42-4520-4bdb-b927-097be3edc993",
        "card_id": "bfc16927-5eba-45ca-b3af-53392778447a",
        "message": "La tarjeta \"MQ-E2E-20261020004000 cron-autonomo\" vence el 2026-10-20T01:42:46Z.",
        "created_at": "2026-10-20T01:14:02.933951+00:00",
        "read_at": null
      },
      {
        "id": "b844a3ae-2014-44a8-9e0d-436e50d2586a",
        "card_id": "a49a239e-193f-484b-a654-cd05e03c8166",
        "message": "La tarjeta \"MQ-E2E-20261020004000 vencimiento\" está vencida.",
        "created_at": "2026-10-20T01:03:23.398854+00:00",
        "read_at": null
      },
      {
        "id": "9b61c9f9-bf72-4bf7-b04e-c1fb15d37ac2",
        "card_id": "a49a239e-193f-484b-a654-cd05e03c8166",
        "message": "La tarjeta \"MQ-E2E-20261020004000 vencimiento\" vence el 2026-10-20T01:03:20Z.",
        "created_at": "2026-10-20T01:02:58.666063+00:00",
        "read_at": null
      },
      {
        "id": "25f6608b-cb48-4721-916f-c83a76a4b336",
        "card_id": "1aa7a690-2402-4af5-b981-00b408a7d663",
        "message": "No se pudo entregar un recordatorio tras agotar los reintentos. Solicita revisión al responsable del tablero.",
        "created_at": "2026-10-20T01:01:55.075413+00:00",
        "read_at": null
      },
      {
        "id": "c54d9158-b6b2-4576-b479-dcaa8c7897b9",
        "card_id": "c65fade2-7ae4-4ccb-be7d-9c43229caa2c",
        "message": "La tarjeta \"MQ-E2E-20261020004000 normal\" vence el 2026-10-20T01:11:08Z.",
        "created_at": "2026-10-20T00:51:22.247911+00:00",
        "read_at": "2026-10-20T00:51:36.192+00:00"
      },
      {
        "id": "fd24fa87-8588-44e5-a4d4-cbf0ef0fa6ec",
        "card_id": "3a060d08-4602-4864-9c98-aeaff00c9bc8",
        "message": "La tarjeta \"Prueba TASK_OVERDUE\" está vencida.",
        "created_at": "2026-10-20T00:49:57.990091+00:00",
        "read_at": null
      },
      {
        "id": "76819338-3702-40bc-a1f5-fa66608f4808",
        "card_id": "3a060d08-4602-4864-9c98-aeaff00c9bc8",
        "message": "La tarjeta \"Prueba TASK_OVERDUE\" está vencida.",
        "created_at": "2026-10-19T14:44:31.638021+00:00",
        "read_at": null
      },
      {
        "id": "e45b3165-7081-42bc-a768-41dcad8a12aa",
        "card_id": "cfa02c59-2e15-4122-af77-8d034dda2cf6",
        "message": "La tarjeta \"Prueba recordatorio MQ\" vence el 2026-10-19T03:01:46Z.",
        "created_at": "2026-10-19T02:49:00.502704+00:00",
        "read_at": null
      }
    ]
  },
  "visibleText": "Auth DCN\nWorkspaces\nAvisos\nSupabase\nAvisos\nActualizar\nNo se pudo entregar un recordatorio tras agotar los reintentos. Solicita revisión al responsable del tablero.\n20/10/2026, 00:50:00\nMarcar leído\nLa tarjeta \"MQ-E2E-20261020004000 155d2be1 interrupcion-real-rpc\" vence el 2026-10-20T04:47:07Z.\n20/10/2026, 00:47:26\nMarcar leído\nNo se pudo entregar un recordatorio tras agotar los reintentos. Solicita revisión al responsable del tablero.\n20/10/2026, 00:43:00\nMarcar leído\nLa tarjeta \"MQ-E2E-20261020004000 ffea3cca interrupcion-real-rpc\" vence el 2026-10-20T04:41:57Z.\n20/10/2026, 00:42:04\nMarcar leído\nLa tarjeta \"MQ-E2E-20261020004000 ffea3cca cinco-reintentos-consumidor\" vence el 2026-10-20T04:39:46Z.\n20/10/2026, 00:41:56\nMarcar leído\nLa tarjeta \"MQ-E2E-20261020004000 cron-autonomo\" vence el 2026-10-20T01:42:46Z.\n19/10/2026, 22:14:02\nMarcar leído\nLa tarjeta \"MQ-E2E-20261020004000 vencimiento\" está vencida.\n19/10/2026, 22:03:23\nMarcar leído\nLa tarjeta \"MQ-E2E-20261020004000 vencimiento\" vence el 2026-10-20T01:03:20Z.\n19/10/2026, 22:02:58\nMarcar leído\nNo se pudo entregar un recordatorio tras agotar los reintentos. Solicita revisión al responsable del tablero.\n19/10/2026, 22:01:55\nMarcar leído\nLa tarjeta \"MQ-E2E-20261020004000 normal\" vence el 2026-10-20T01:11:08Z.\n19/10/2026, 21:51:22\nLa tarjeta \"Prueba TASK_OVERDUE\" está vencida.\n19/10/2026, 21:49:57\nMarcar leído\nLa tarjeta \"Prueba TASK_OVERDUE\" está vencida.\n19/10/2026, 11:44:31\nMarcar leído\nLa tarjeta \"Prueba recordatorio MQ\" vence el 2026-10-19T03:01:46Z.\n18/10/2026, 23:49:00\nMarcar leído",
  "screenshot": "43-avisos-finales-firefox.png"
}
```

</details>


## Anexos y trazabilidad

Las 35 subpruebas técnicas quedan como anexo de respaldo. También se conservan las rondas históricas, sus correcciones y los archivos JSON originales. Las imágenes de respuestas son vistas generadas de esos JSON; las capturas reales de la aplicación y de IBM MQ Console están identificadas. Las dos colas de ensayo y las inyecciones SQL se retiraron; el Cron permanente quedó activo en la verificación final registrada. No se modifica producción al preparar esta edición.

- [Anexo: 35 subpruebas, seguridad y detalles técnicos](casos-mq-rest-con-imagenes.md).
- [Configuración permanente y comprobación de DLQ](cron-permanente-y-dlq.md).
- [Historial completo de pruebas](informe-pruebas-mq-rest.md).
- [Estado final y limpieza](respuestas/phase-FINAL-20261020.json).
- [Integridad SHA-256](sha256.txt).
