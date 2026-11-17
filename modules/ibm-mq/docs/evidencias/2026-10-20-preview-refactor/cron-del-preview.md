# Cron y estado final del nuevo preview

El destino probado es https://auth-pawu47st3-anthonys-projects-0d8acba7.vercel.app.

Los dos trabajos permanentes siguen activos cada minuto, con destino al alias anterior `https://auth-cdn-git-feature-mq-consumidor-anthonys-projects-0d8acba7.vercel.app`: `authcdn-mq-rest-minute` y `authcdn-mq-maintenance`. No se cambió ese destino.

Para acreditar el funcionamiento autónomo del nuevo preview se creó un Cron temporal de tres minutos, dos entradas Vault exclusivas y una tabla protegida de trazabilidad. Las llamadas a `/api/mq/cron/tick` emplearon el secreto de máquina. Las operaciones del usuario siguen pasando por JWT, MFA y permisos.

Las respuestas de pg_net identificadas con requestId 1026, 1028 y 1030 fueron HTTP 200. El 1028, a las 18:30:15 UTC, registró published=1, captured=1, worked=1, errors=0. El recordatorio estaba previsto para las 18:30:10 UTC, después del turno de las 18:30:00 del Cron anterior. La fase K confirma un único aviso, outbox PUBLISHED e inbox DONE para el mismo eventId, sin una llamada manual a tick después de programarlo.

Al terminar se retiraron el trabajo temporal, sus dos entradas Vault y su tabla. El control final confirmó cero recursos temporales, cero recordatorios futuros del ensayo, pendingInbox=0 y failedPublications=0. Los dos trabajos permanentes quedaron activos. Este informe no configura un Cron permanente hacia el nuevo preview.

Evidencias: [Cron temporal y retirada](respuestas/phase-CRON.json), [programación](respuestas/phase-J.json), [entrega autónoma](respuestas/phase-K.json), [control final](respuestas/phase-FINAL-20261020.json).

## Qué se conservó en IBM

La BOQ contiene 15 mensajes, seis nuevos de esta ronda. La DLQ pasó de uno a dos mensajes: IBM generó el nuevo control MQTM con cabecera MQDLH y motivo MQRC_Q_FULL porque la cola temporal INIT, de MAXDEPTH=1, estaba llena con un mensaje propio. El MsgId y el destino exclusivo del ensayo se registraron y fotografiaron. El control es no persistente; las cargas de la aplicación sí se publicaron persistentes. No se retiraron mensajes de BOQ/DLQ.

Las dos colas `AUTHCDN.E2E.DLQ.INIT.0287C28D` y `AUTHCDN.E2E.DLQ.TRIG.0287C28D` fueron retiradas. Se recargó la consola para verificar que no quedaban colas con el prefijo exclusivo del ensayo. Los triggers y funciones SQL de inyección se retiraron y las programaciones futuras propias fueron canceladas.

## Alcance e incidencias del arnés

- `RETRY-CLOUD-5`: una llamada manual devolvió 200 sin trabajo porque el Cron del alias anterior ya había ejecutado el quinto intento. Se conserva el FAIL original. `phase-D-concurrency.json` acredita el HTTP 502 concurrente y el contador=5; la salida se recuperó al corregir el destino. Otra prueba independiente midió cinco fallos RPC reales y confirmó en consola el mensaje RETRIES_EXHAUSTED con attempts=5.
- `NATIVE-HEADER-PREMATURE-READ`: el arnés leyó una pestaña de consola antes de cargar; se conserva ese FAIL. Se reabrieron los detalles y se verificaron la cabecera completa, el MsgId y la captura de la prueba actual.
- El 501 MQWB0309E al examinar el control binario de DLQ es una limitación de la API REST, con mensaje conservado. La consola permitió leer la cabecera.
- La identidad de aplicación no tiene browse de BOQ (403). Las capturas se obtuvieron con la sesión administrativa iniciada manualmente por el usuario.
- El diagnóstico opcional `/api/mq/poc` no se probó con credencial válida porque falta MQ_POC_SECRET en el archivo local. Los flujos funcionales de recordatorios, resumen y Cron sí se probaron.
- La prueba de alertas agotó cinco intentos del productor con un TTL vencido: el transporte rechaza ese caso antes de llamar a IBM. No representa cinco rechazos HTTP del broker ni una caída de IBM.
- ACK se valida por HTTP e inbox durable. El rollback probado corresponde a SQL, sin MQCMIT/MQBACK. Se interrumpió una RPC propia, sin reiniciar IBM ni Vercel. Retención utiliza fixtures con fechas preparadas.

## Todas las respuestas originales de esta ronda

Las imágenes `evidencia-rXX.png` visualizan los campos originales agrupados para facilitar la lectura. Las fotos de la aplicación y de IBM Console son capturas nuevas de Firefox. Los JSON conservan peticiones, respuestas y consultas registradas, sin credenciales.

| Archivo | Registros | Resultados |
|---|---:|---|
| [dlq-native-state.json](respuestas/dlq-native-state.json) | 8 | {'PASS': 7, 'FAIL': 1} |
| [phase-A.json](respuestas/phase-A.json) | 18 | {'PASS': 18} |
| [phase-ACCESS.json](respuestas/phase-ACCESS.json) | 3 | {'PASS': 2, 'LIMITED': 1} |
| [phase-B.json](respuestas/phase-B.json) | 13 | {'PASS': 13} |
| [phase-C.json](respuestas/phase-C.json) | 25 | {'PASS': 25} |
| [phase-CRON.json](respuestas/phase-CRON.json) | 3 | {'PASS': 3} |
| [phase-D-concurrency.json](respuestas/phase-D-concurrency.json) | 1 | {'PASS': 1} |
| [phase-D.json](respuestas/phase-D.json) | 20 | {'PASS': 19, 'FAIL': 1} |
| [phase-DEEP-ecda227e.json](respuestas/phase-DEEP-ecda227e.json) | 36 | {'PASS': 36} |
| [phase-E.json](respuestas/phase-E.json) | 14 | {'PASS': 14} |
| [phase-F.json](respuestas/phase-F.json) | 9 | {'PASS': 9} |
| [phase-FINAL-20261020.json](respuestas/phase-FINAL-20261020.json) | 1 | {'PASS': 1} |
| [phase-FIREFOX-APP.json](respuestas/phase-FIREFOX-APP.json) | 2 | {'PASS': 2} |
| [phase-I.json](respuestas/phase-I.json) | 17 | {'PASS': 16, 'LIMITED': 1} |
| [phase-IBM-CONSOLE.json](respuestas/phase-IBM-CONSOLE.json) | 1 | {'PASS': 1} |
| [phase-IBM-RETRIES.json](respuestas/phase-IBM-RETRIES.json) | 1 | {'PASS': 1} |
| [phase-J.json](respuestas/phase-J.json) | 5 | {'PASS': 5} |
| [phase-K.json](respuestas/phase-K.json) | 5 | {'PASS': 5} |
| [phase-S.json](respuestas/phase-S.json) | 18 | {'PASS': 18} |
| [phase-V.json](respuestas/phase-V.json) | 8 | {'PASS': 7, 'LIMITED': 1} |

Conteo de registros técnicos: {"PASS": 203, "FAIL": 2, "LIMITED": 3}. El veredicto de los diez requisitos se basa en sus comprobaciones específicas; los resultados del arnés y las limitaciones permanecen visibles.
