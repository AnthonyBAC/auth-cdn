# Activación del Cron permanente y revisión de DLQ

Fecha de configuración: **19-10-2026 22:27:23 UTC−03**. Autorización del usuario: «dejalo con cron permanente».

**Estado actual: procesamiento y mantenimiento permanentes activos, ambos cada minuto.** Se verificaron sus primeras ejecuciones y la respuesta HTTP 200 de Vercel.

| Trabajo | Frecuencia | Función |
|---|---|---|
| `authcdn-mq-rest-minute` | Cada minuto | Supabase pg_cron/pg_net llama por HTTPS a `/api/mq/tick` con el secreto privado; Vercel publica, consume y recupera mensajes. |
| `authcdn-mq-maintenance` | Cada minuto | Ejecuta `public.mq_rest_maintenance()` directamente en Supabase: reconcilia expiraciones, genera avisos de publicaciones fallidas y limpia registros técnicos terminados de más de 30 días. Conserva pendientes, fallos y cuarentenas. |

El destino es el preview de la rama `feature/mq-consumidor`:
[https://auth-cdn-git-feature-mq-consumidor-anthonys-projects-0d8acba7.vercel.app](https://auth-cdn-git-feature-mq-consumidor-anthonys-projects-0d8acba7.vercel.app). La URL está en Vault como `mq_vercel_base_url`; el secreto está en `mq_cron_secret` y no se incluye en este documento ni en cron.job.command. No requiere un proceso local de producción o consumo. La autenticación JWT/MFA y los permisos siguen protegiendo las operaciones del usuario; el endpoint de Cron usa su secreto de máquina.

Los dos trabajos se crearon con el contenido de `supabase/cron/mq-rest.sql`. No se modificó ese archivo, no se desplegó una nueva versión y no se cambió el destino a otro entorno. Las futuras versiones servidas por el alias de la rama serán las invocadas por este Cron.

## Primeras ejecuciones comprobadas

```json
{
  "health": {
    "deliveryRetries": 0,
    "failedPublications": 0,
    "pendingInbox": 0,
    "quarantined": 5,
    "staleInbox": 0
  },
  "httpResponses": [
    {
      "content": "{\"published\":0,\"captured\":0,\"worked\":0,\"errors\":0}",
      "created": "2026-10-20T01:28:00.070513+00:00",
      "error": null,
      "id": 4,
      "status": 200,
      "timedOut": false
    }
  ],
  "jobs": [
    {
      "active": true,
      "jobid": 2,
      "name": "authcdn-mq-rest-minute",
      "schedule": "* * * * *"
    },
    {
      "active": true,
      "jobid": 3,
      "name": "authcdn-mq-maintenance",
      "schedule": "* * * * *"
    }
  ],
  "maintenanceFunctionAvailable": true,
  "runs": [
    {
      "end_time": "2026-10-20T01:28:00.061587+00:00",
      "jobid": 3,
      "return_message": "1 row",
      "start_time": "2026-10-20T01:28:00.053866+00:00",
      "status": "succeeded"
    },
    {
      "end_time": "2026-10-20T01:28:00.071546+00:00",
      "jobid": 2,
      "return_message": "1 row",
      "start_time": "2026-10-20T01:28:00.055094+00:00",
      "status": "succeeded"
    }
  ]
}
```

`cron.job_run_details` mostró succeeded para los dos trabajos. La petición de pg_net obtuvo HTTP 200 y errors=0. La salud posterior mostró cero inbox pendientes/antiguos, cero publicaciones fallidas y cinco cuarentenas conservadas para revisión. Los contadores de un ciclo sin mensajes disponibles pueden ser cero: el trabajo sigue activo.

El ensayo temporal previo ya había demostrado la entrega de un recordatorio real desde Cron. La llamada de comprobación de esta activación retiró además el mensaje temporal dejado para fotografía en la cola principal; el listado de pendientes puede volver a cero.

## DLQ nativa: asignación y funcionamiento comprobados

**Actualización del 20-10-2026:** se verificó en Firefox la propiedad **Dead-letter queue = DEV.DEAD.LETTER.QUEUE** de AUTHCDNQM. La consulta REST administrativa de las identidades de aplicación había recibido 403; la sesión de consola del usuario permitió resolver la comprobación sin ampliar sus permisos de aplicación.

![Asignación DEADQ confirmada en IBM Console](capturas/19-ibm-config-deadq-firefox.png)

Además se crearon dos colas exclusivas AUTHCDN.E2E.* para una prueba controlada de triggering. Al llenar su cola de iniciación, IBM no pudo entregar un MQTM nuevo y lo envió automáticamente a su DLQ. La cabecera mostró **MQRC_Q_FULL**, destino AUTHCDN.E2E.DLQ.INIT.BE495EF3 y aplicación AUTHCDNQM. El mensaje tiene MQDLH/MQTM; no fue un JSON escrito manualmente en DLQ. El mensaje de control nativo es no persistente y es distinto de la carga persistente que disparó el ensayo.

![Motivo nativo y destino del mensaje DLQ](capturas/39-dlq-cabecera-motivo-destino.png)

La inspección REST no destructiva de ese formato binario devolvió **501 MQWB0309E**; la consola sí mostró sus cabeceras. No se retiró el mensaje DLQ. Las dos colas temporales se eliminaron y solo se vaciaron sus dos MQTM propios. Se preservaron BOQ, DLQ y las colas funcionales.

La BOQ de aplicación sigue siendo diferente: conserva los eventos que el consumidor rechaza o cuyos intentos agota. Actualmente la captura final muestra nueve mensajes BOQ (siete de los ensayos REST y dos node anteriores), y un mensaje nativo DLQ.

[Casos C33–C35, respuestas y fotografías completas](casos-mq-rest-con-imagenes.md#c33) · [Registro nativo íntegro](respuestas/dlq-native-state.json) · [Salud y ejecuciones permanentes finales](respuestas/phase-FINAL-20261020.json).

Las últimas verificaciones mostraron HTTP 200, cero pendientes, cero publicaciones fallidas y cero objetos SQL de inyección. El número de cuarentenas conservadas pasó a siete; las cifras de cinco de las primeras ejecuciones que se muestran más abajo son históricas. El mantenimiento conserva los mensajes fallidos para revisión y no ejecuta un manejador automático de DLQ.

## Respuestas de cada comprobación

### PERM-JWT — PASS

Sin sesión JWT, la API de avisos conserva 401.

```json
{
  "request": {
    "method": "GET",
    "path": "/api/notifications",
    "authenticatedMachine": false,
    "cookies": false
  },
  "status": 401,
  "body": {
    "error": {
      "code": "UNAUTHENTICATED",
      "message": "Sign in to continue.",
      "details": {}
    }
  }
}
```

### PERM-NO-SECRET — PASS

Sin secreto de máquina, el endpoint de procesamiento conserva 401.

```json
{
  "request": {
    "method": "POST",
    "path": "/api/mq/tick",
    "authenticatedMachine": false,
    "cookies": false
  },
  "status": 401,
  "body": {
    "error": "UNAUTHORIZED"
  }
}
```

### PERM-AUTHORIZED-PREFLIGHT — PASS

La invocación autorizada respondió 200 antes de configurar el trabajo permanente. Procesó el mensaje temporal que seguía pendiente para fotografía.

```json
{
  "request": {
    "method": "POST",
    "path": "/api/mq/tick",
    "authenticatedMachine": true,
    "cookies": false
  },
  "status": 200,
  "body": {
    "published": 0,
    "captured": 1,
    "worked": 1,
    "errors": 0
  }
}
```

### PERM-PRECONDITION — PASS

Se verificó que no existían trabajos permanentes ni nombres de Vault que pudieran sobrescribirse.

```json
{
  "health": {
    "deliveryRetries": 0,
    "failedPublications": 0,
    "pendingInbox": 0,
    "quarantined": 5,
    "staleInbox": 0
  },
  "jobs": [],
  "vaultNames": []
}
```

### PERM-ACTIVATED — PASS

Se guardaron el origen HTTPS y el secreto de máquina en Vault y se programaron ambos trabajos mediante el SQL revisado del proyecto. Permanecen activos sin límite de tres minutos.

```json
{
  "configuredAt": "2026-10-20T01:27:22.569452+00:00",
  "jobs": [
    {
      "active": true,
      "jobid": 2,
      "jobname": "authcdn-mq-rest-minute",
      "schedule": "* * * * *"
    },
    {
      "active": true,
      "jobid": 3,
      "jobname": "authcdn-mq-maintenance",
      "schedule": "* * * * *"
    }
  ],
  "vaultConfigured": 2
}
```

### PERM-OBSERVE-6 — OBSERVATION

Se consultan los logs de pg_cron y las respuestas de pg_net. SQL succeeded confirma el comando; el HTTP 200 confirma que Vercel aceptó y ejecutó el ciclo.

```json
{
  "health": {
    "deliveryRetries": 0,
    "failedPublications": 0,
    "pendingInbox": 0,
    "quarantined": 5,
    "staleInbox": 0
  },
  "httpResponses": [],
  "jobs": [
    {
      "active": true,
      "jobid": 2,
      "name": "authcdn-mq-rest-minute",
      "schedule": "* * * * *"
    },
    {
      "active": true,
      "jobid": 3,
      "name": "authcdn-mq-maintenance",
      "schedule": "* * * * *"
    }
  ],
  "maintenanceFunctionAvailable": true,
  "runs": []
}
```

### PERM-OBSERVE-7 — PASS

Se consultan los logs de pg_cron y las respuestas de pg_net. SQL succeeded confirma el comando; el HTTP 200 confirma que Vercel aceptó y ejecutó el ciclo.

```json
{
  "health": {
    "deliveryRetries": 0,
    "failedPublications": 0,
    "pendingInbox": 0,
    "quarantined": 5,
    "staleInbox": 0
  },
  "httpResponses": [
    {
      "content": "{\"published\":0,\"captured\":0,\"worked\":0,\"errors\":0}",
      "created": "2026-10-20T01:28:00.070513+00:00",
      "error": null,
      "id": 4,
      "status": 200,
      "timedOut": false
    }
  ],
  "jobs": [
    {
      "active": true,
      "jobid": 2,
      "name": "authcdn-mq-rest-minute",
      "schedule": "* * * * *"
    },
    {
      "active": true,
      "jobid": 3,
      "name": "authcdn-mq-maintenance",
      "schedule": "* * * * *"
    }
  ],
  "maintenanceFunctionAvailable": true,
  "runs": [
    {
      "end_time": "2026-10-20T01:28:00.061587+00:00",
      "jobid": 3,
      "return_message": "1 row",
      "start_time": "2026-10-20T01:28:00.053866+00:00",
      "status": "succeeded"
    },
    {
      "end_time": "2026-10-20T01:28:00.071546+00:00",
      "jobid": 2,
      "return_message": "1 row",
      "start_time": "2026-10-20T01:28:00.055094+00:00",
      "status": "succeeded"
    }
  ]
}
```

### DLQ-ADMIN-CONSUMER — LIMITED

Se envía únicamente DISPLAY QMGR DEADQ por la API administrativa. IBM rechaza el acceso a SYSTEM.ADMIN.COMMAND.QUEUE con 403/2035. No se cambian permisos ni la asignación de la DLQ.

```json
{
  "request": {
    "method": "POST",
    "path": "/admin/action/qmgr/AUTHCDNQM/mqsc",
    "role": "consumer",
    "body": {
      "type": "runCommand",
      "parameters": {
        "command": "DISPLAY QMGR DEADQ"
      }
    },
    "readOnlyCommand": true
  },
  "status": 403,
  "body": {
    "error": [
      {
        "msgId": "MQWB0118E",
        "action": "Obtain the necessary authorization to perform the operation and resubmit the request. Check queue name resolution, and consult the queue manager error logs for further details.",
        "completionCode": 2,
        "reasonCode": 2035,
        "type": "rest",
        "message": "MQWB0118E: Not authorized to open 'SYSTEM.ADMIN.COMMAND.QUEUE'.",
        "explanation": "The authenticated principal is not authorized to perform the requested REST API operation."
      }
    ]
  },
  "configuredDeadq": null,
  "note": "Solo DISPLAY: no cambia la configuraciÃ³n de IBM ni envÃ­a o retira mensajes de negocio."
}
```

### DLQ-ADMIN-PRODUCER — LIMITED

Se envía únicamente DISPLAY QMGR DEADQ por la API administrativa. IBM rechaza el acceso a SYSTEM.ADMIN.COMMAND.QUEUE con 403/2035. No se cambian permisos ni la asignación de la DLQ.

```json
{
  "request": {
    "method": "POST",
    "path": "/admin/action/qmgr/AUTHCDNQM/mqsc",
    "role": "producer",
    "body": {
      "type": "runCommand",
      "parameters": {
        "command": "DISPLAY QMGR DEADQ"
      }
    },
    "readOnlyCommand": true
  },
  "status": 403,
  "body": {
    "error": [
      {
        "msgId": "MQWB0118E",
        "action": "Obtain the necessary authorization to perform the operation and resubmit the request. Check queue name resolution, and consult the queue manager error logs for further details.",
        "completionCode": 2,
        "reasonCode": 2035,
        "type": "rest",
        "message": "MQWB0118E: Not authorized to open 'SYSTEM.ADMIN.COMMAND.QUEUE'.",
        "explanation": "The authenticated principal is not authorized to perform the requested REST API operation."
      }
    ]
  },
  "configuredDeadq": null,
  "note": "Solo DISPLAY: no cambia la configuraciÃ³n de IBM ni envÃ­a o retira mensajes de negocio."
}
```

## Operación

La configuración puede consultarse en Supabase Cron; los trabajos deben figurar activos. El mantenimiento se ejecuta en la base aunque Vercel esté temporalmente inaccesible. Para una ejecución completa debe comprobarse también el HTTP del procesamiento, no solo el éxito SQL del comando pg_net.

El SQL del proyecto incluye las instrucciones de parada por nombre para cuando el responsable decida suspender el servicio. No se ejecutaron: ambos trabajos permanentes quedan activos. Las credenciales siguen siendo privadas y no se incluyen en los archivos adjuntos.
