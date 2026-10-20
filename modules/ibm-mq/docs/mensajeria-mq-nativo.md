# Mensajería con IBM MQ — base compartida

## 1. Alcance de este paso

Se preparan tablas, contrato y endpoints para programar, asignar responsables y completar
tarjetas. El tablero incluye el formulario de fechas/responsables y la acción de completar.
El scheduler ya prepara los eventos en outbox. El productor nativo está implementado, pero su conexión real con IBM MQ y el consumidor siguen pendientes de validar. Publish/Subscribe
queda fuera del alcance acordado. TLS se configurará en la conexión con IBM MQ.

## 2. Datos

| Recurso | Responsabilidad |
|---|---|
| `cards` | Tarjeta existente: agrega creador, `due_at`, `notify_at`, `completed_at` y `schedule_version`. |
| `task_reminders` | Destinatario, fecha de aviso, vencimiento y estado de cada programación. |
| `notification_outbox` | Evento pendiente de publicar, intentos y reserva temporal del productor. |
| `notifications` | Aviso visible y fecha de lectura. Un evento no se duplica para el mismo usuario. |

`task_reminders.due_at` conserva el vencimiento de esa versión de la programación.
No es otro vencimiento editable: debe copiarse desde la tarjeta en la operación atómica.
Las fechas usan `timestamptz`; los mensajes usan UTC con sufijo `Z`.

No se crea otra tabla de tareas ni otro sistema de roles. Se reutiliza `card_assignees`:
cada responsable recibe su aviso. Sin responsables, lo recibe el creador de la tarjeta,
si sigue siendo miembro activo. Las tarjetas antiguas sin creador necesitan un responsable.
El creador de tarjetas nuevas se obtiene de la sesión en la base de datos; no se acepta
un creador enviado por el navegador.

## 3. Contrato del mensaje

Fuente compartida: [`modules/ibm-mq/domain/contrato.ts`](../domain/contrato.ts).

```json
{
  "schemaVersion": 1,
  "eventId": "f345a124-783e-4caa-830c-8930337b535f",
  "eventType": "TASK_REMINDER_DUE",
  "reminderId": "d13497cd-5063-459f-9f90-9dc78293eb49",
  "cardId": "33086fde-719d-4724-9b05-b6f6947e0c59",
  "workspaceId": "fe962a07-38d5-4124-a67f-09e631abf5e6",
  "scheduleVersion": 1,
  "occurredAt": "2026-10-18T18:00:00.000Z",
  "expiresAt": "2026-10-20T18:00:00.000Z"
}
```

Tipos: `TASK_REMINDER_DUE` (aviso preventivo) y `TASK_OVERDUE` (tarea vencida).
El consumidor resolverá el destinatario desde el recordatorio guardado y comprobará
que tarjeta, workspace y versión coincidan. El mensaje no contiene JWT, contraseñas
ni claves de Supabase. La validación del formato no sustituye esas comprobaciones.

## 4. Estados y operaciones

| Recurso | Estados |
|---|---|
| Recordatorio | `SCHEDULED`, `QUEUED`, `PROCESSED`, `CANCELLED`, `EXPIRED`, `FAILED`. |
| Outbox | `PENDING`, `PROCESSING`, `PUBLISHED`, `FAILED`, `CANCELLED`, `EXPIRED`. |

`QUEUED` significa que existe un evento en outbox; no confirma recepción por IBM MQ.
`PUBLISHED` se registrará después de la confirmación de publicación del broker.
La programación, cancelación, finalización y detección están implementadas; el productor está implementado con pruebas simuladas; falta validarlo con IBM MQ y desarrollar el consumidor.

Operaciones compartidas (1 a 4 implementadas; publicación real por validar y 5 pendiente):

1. Programar o cambiar fechas: bloquear la tarjeta, verificar usuario/rol, incrementar
   su versión y cancelar programaciones previas, todo en una transacción.
2. Completar: registrar `completed_at` e invalidar avisos pendientes en esa misma transacción.
3. Detectar avisos: comprobar vigencia y archivado, crear un evento único en outbox y
   marcar `QUEUED` de forma atómica.
4. Publicar: reservar con `lock_token` y `locked_until`; recuperar reservas vencidas.
   Confirmar o reintentar solo si el productor conserva su token de reserva.
5. Consumir: validar estado actual, permisos del destinatario, versión, vencimiento y
   archivado; guardar aviso u omisión antes de confirmar el mensaje en MQ.

El scheduler prepara el evento cuando llega `notify_at`; el productor deberá publicarlo. La expiración no programa la entrega.
El aviso preventivo caduca al vencer la tarjeta; el vencido caduca 24 horas después
del vencimiento. Esta es la política inicial de vigencia, no una configuración del broker.
Falta configurar la limpieza de registros, reintentos, alertas y colas de errores.

## 5. Acceso a los datos

- RLS está habilitado en las tres tablas nuevas.
- El usuario puede leer sus recordatorios y notificaciones si conserva acceso al workspace activo.
- Solo puede modificar `read_at` de sus notificaciones; no el destinatario ni el contenido.
- El navegador no puede leer ni escribir outbox, ni crear recordatorios/notificaciones directamente.
- Los procesos internos escribirán mediante credenciales de servidor y operaciones validadas.
  La clave de servicio no debe llegar al navegador. Su acceso privilegiado exige validación explícita.

La migración 0005 limita las escrituras directas de fechas, creador y responsables.
Las nuevas RPC verifican sesión, MFA, rol y estado activo de tarjeta/lista/tablero/workspace.
No corrige los otros hallazgos de seguridad de la revisión anterior.

## 6. Coordinación entre ramas

`feature/mq-programacion` mantiene migración, contrato, programación y productor.
`feature/mq-consumidor` reutiliza ese contrato y prepara consumo, confirmaciones,
reintentos y notificaciones. No crear otra migración que repita estas tablas.
El contrato debe revisarse entre ambos e integrarse mediante Git antes de conectar los procesos.

## 7. Migración y comprobaciones

Migraciones nuevas: `0004_mq_base.sql`, `0005_mq_programacion.sql`, `0006_mq_scheduler.sql` y `0007_mq_productor.sql`. No modifican las tres anteriores.
No se ha aplicado a Supabase remoto. Primero debe probarse en una base local o de ensayo:

- Aplicar migraciones en orden y comprobar que siguen funcionando tarjetas antiguas.
- Verificar usuario propio, otro usuario, no miembro y usuario anónimo con RLS.
- Intentar alterar contenido/destinatario de una notificación: debe rechazarse.
- Insertar dos avisos del mismo evento/destinatario: el segundo debe rechazarse.
- Comprobar fechas inválidas, versiones inválidas y reservas inconsistentes.

Las pruebas incluyen validación, endpoints con sesión simulada y ejecución de las siete
migraciones en PostgreSQL en memoria (PGlite). Se simulan las interfaces mínimas de Auth;
esto no sustituye una prueba del Supabase desplegado, concurrencia real ni IBM MQ.
Ejecutar `pnpm test`. No requiere claves ni conexión remota.
Las reversiones de ensayo están en `supabase/rollback/`: primero 0007, después 0006, 0005 y finalmente 0004.
Eliminan datos de la funcionalidad y no se ejecutan como migraciones normales.


## 8. Programar y completar desde la API

Ambas rutas usan la sesión y MFA existentes. No reciben JWT dentro del mensaje.

`PATCH /api/cards/{cardId}/schedule`

```json
{
  "expectedVersion": 1,
  "dueAt": "2099-01-03T00:00:00Z",
  "notifyAt": "2099-01-02T00:00:00Z",
  "assigneeIds": []
}
```

- `assigneeIds` es la lista completa de responsables, sin duplicados y miembros activos.
- Una lista vacía usa al creador como destinatario; no cambia quién creó la tarjeta.
- Ambas fechas en `null` eliminan la programación y permiten guardar responsables sin avisos.
- `expectedVersion` se obtiene al consultar el tablero o crear la tarjeta.
- Cambiar fechas o responsables cancela la versión anterior de los recordatorios y outbox pendientes.
- Si solo cambian responsables, los avisos ya procesados no se repiten para quienes permanecen.
- Una publicación confirmada se conserva; el consumidor deberá descartar la versión cancelada.

`POST /api/cards/{cardId}/complete`

```json
{ "expectedVersion": 2 }
```

Registra la fecha del servidor y cancela los recordatorios pendientes de todos los destinatarios.
Repetir con la versión vigente no vuelve a completar. No se incluye reapertura en este paso.
Archivar una tarjeta también invalida sus avisos. El consumidor/scheduler deberá comprobar
además si se archivó su lista, tablero o workspace, o si se retiró un destinatario.

Respuestas: `200` con `{ card: ... }`, `400` por datos inválidos, `401` sin sesión,
`403` sin permiso o MFA pendiente, `409` si cambió la versión y `500` ante un fallo interno.
Las fechas devueltas por SQL pueden incluir un desplazamiento horario; el productor deberá
normalizarlas a UTC al construir un mensaje. No se han modificado las colecciones Postman.


## 9. Uso desde el tablero

1. Crea una tarjeta y abre **Fechas y responsables**.
2. Elige uno o varios miembros activos. Sin responsables, se usa al creador disponible.
3. Indica la fecha límite y la fecha del aviso; guarda con **Guardar fechas y responsables**.
4. **Quitar fechas** limpia ambas fechas en el formulario; guarda para cancelar la programación.
5. **Completar tarjeta** pide confirmación y cancela los avisos de todos los destinatarios.

El formulario interpreta fechas en la zona horaria del navegador y las envía como fechas
absolutas. El resumen del tablero usa la zona del workspace (UTC si no está configurada).
Si alguien cambió la tarjeta, el formulario conserva el borrador y bloquea el guardado;
**Cargar datos actuales** pide confirmación antes de reemplazarlo. Los usuarios viewer
solo ven los datos. Las tarjetas archivadas no se muestran ni se recuperan al recargar.

Antes de usar estos controles en un entorno real, aplicar 0004 y 0005 en orden.
Guardar fechas todavía no envía mensajes a IBM MQ: falta conectar productor y consumidor.


## 10. Detector de avisos (scheduler)

La migración `0006_mq_scheduler.sql` agrega `enqueue_due_reminders(p_limit)`.
Solo el proceso de servidor con `service_role` puede ejecutarla. No se expone una
ruta pública ni se reutiliza la sesión del usuario para este trabajo de fondo.

Cada ejecución:

1. Busca avisos cuya fecha ya llegó, usando la hora de PostgreSQL.
2. Comprueba versión, tarjeta pendiente, elementos sin archivar y destinatario activo.
3. Cancela avisos inválidos o marca como expirados los que perdieron vigencia.
4. Guarda el evento en outbox y marca el recordatorio `QUEUED` en una sola transacción.

El evento conserva el contrato compartido, con fechas UTC y sin credenciales.
El bloqueo de tarjetas y la restricción única por recordatorio evitan duplicados.
El lote procesa hasta 100 recordatorios por defecto (máximo 1000). Los siguientes
quedan para otra ejecución. Si falla la operación, la transacción se revierte.
El productor y el consumidor deben comprobar otra vez la vigencia: un usuario
puede completar la tarjeta, archivar un tablero o perder acceso después de este paso.

### Ejecutar localmente

Requiere Node.js 20.6 o posterior y las migraciones aplicadas en una base de ensayo.
En `.env.local`, configura `NEXT_PUBLIC_SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`.
La clave de servicio es privada; no debe llevar el prefijo `NEXT_PUBLIC_`.

```sh
# Una sola revisión de avisos pendientes
pnpm mq:scheduler --once

# Mantener el proceso activo (revisa cada 30 segundos)
pnpm mq:scheduler
```

Opcionales: `MQ_SCHEDULER_INTERVAL_MS=30000` y `MQ_SCHEDULER_BATCH_SIZE=100`.
El proceso termina con Ctrl+C. En un servidor con variables ya configuradas,
ejecuta `node modules/ibm-mq/legacy/scripts/mq-scheduler.mjs`. Debe correr como proceso independiente;
no se instala como bucle dentro de una petición HTTP de Next.js.

Los resultados indican `queued`, `cancelled` y `expired`. `queued` confirma guardado
en la base de datos, **no recepción por IBM MQ**. Ante error, una ejecución única
termina con código 1; el modo continuo vuelve a intentar en el siguiente intervalo.
No se ha activado ningún proceso permanente ni aplicado migraciones remotamente.

Pendiente: validar TLS y publicación contra IBM MQ real, consumidor, cola de errores, limpieza y alertas operativas.


## 11. Productor IBM MQ

Código: `modules/ibm-mq/legacy/mq-productor/`. Corre separado de Next.js y requiere Node.js 20.19 o posterior,
las dependencias del proyecto y el cliente nativo IBM MQ compatible con el sistema operativo.
En macOS, instalar `ibmmq` no instala el cliente nativo completo. Su biblioteca y repositorio
de certificados deben estar disponibles antes de ejecutar una conexión real.

```sh
# Desde la raíz del repositorio
pnpm --dir modules/ibm-mq/legacy/mq-productor install --frozen-lockfile
pnpm --dir modules/ibm-mq/legacy/mq-productor start --once
# Sin --once, continúa revisando eventos
pnpm --dir modules/ibm-mq/legacy/mq-productor start
# Revisar los tipos del proceso independiente
pnpm exec tsc -p modules/ibm-mq/legacy/mq-productor/tsconfig.json --noEmit
```

Aplicar primero las migraciones 0004 a 0007 en una base de ensayo. Completar las variables
`MQ_*` de `.env.example` en `.env.local`, sin versionar claves ni certificados privados.
`MQ_CONNECTION_NAME` usa el formato `servidor(puerto)`; el nombre de canal, gestor y cola
se obtienen de la configuración de IBM MQ. `MQ_TLS_PEER_NAME` identifica el certificado
esperado del servidor. El repositorio de certificados y su formato dependen del cliente
nativo instalado. No se incluye ninguna opción para desactivar TLS.

### Envío, confirmación y reintentos

1. `claim_notification_event()` reserva un evento durante 120 segundos y revalida su vigencia.
2. El productor valida el contrato y envía JSON UTF-8 por el canal TLS.
3. Usa mensajes persistentes y expiración en décimas de segundo, calculada con el tiempo restante.
4. Ejecuta `MQPUT` dentro de una transacción y espera `MQCMIT` antes de registrar `PUBLISHED`.
5. Si falla, programa reintentos con espera creciente: 5, 10, 20 y 40 segundos, hasta cinco intentos.

Una reserva vencida se recupera con otro token; un token antiguo no puede confirmar eventos.
Al agotar intentos, el evento queda `FAILED` para revisión. Esto **no es una DLQ**: todavía
falta configurar la cola de errores y su flujo. El código no garantiza entrega si todos
los intentos fallan; conserva el registro para diagnóstico y recuperación posterior.

Si MQ recibió el mensaje pero se perdió su respuesta, o falló el guardado posterior en
Supabase, puede repetirse el envío con el mismo `eventId`. El consumidor debe deduplicarlo
y revisar que la tarjeta siga pendiente y accesible antes de notificar. Completar la tarjeta
no permite retirar un mensaje ya entregado a MQ: se descarta lógicamente al consumirlo.
El ACK del productor confirma publicación; el ACK del consumidor confirmará procesamiento.

### Reparto entre las dos personas

| Persona/rama | Responsabilidad |
|---|---|
| Tú: `feature/mq-programacion` | Fechas, responsables, migraciones, detector y productor. |
| Compañera: `feature/mq-consumidor` | Crear/configurar IBM MQ, canal TLS, cola y accesos; desarrollar consumidor y confirmaciones. |
| Ambos | Integrar el contrato y probar TLS, reinicio, duplicados, vencimiento y cancelación. |

Para conectar, compartir nombres de gestor/cola/canal, servidor/puerto, CipherSpec y
certificado público de confianza. Entregar contraseñas y claves privadas por un canal seguro,
fuera del repositorio y del chat. El usuario MQ del productor necesita permiso para conectar
y escribir en la cola; el consumidor tiene sus propios permisos de lectura/procesamiento.

### Estado de verificación

Las pruebas usan PostgreSQL en memoria y un cliente MQ simulado. Comprueban reservas,
reintentos, cancelación, persistencia solicitada y orden de confirmación. No demuestran aún
un handshake TLS real, supervivencia al reinicio del gestor ni entrega al consumidor.
No se aplicaron migraciones remotas ni se dejó un proceso permanente ejecutándose.

Referencia técnica: [cliente Node.js de IBM MQ](https://github.com/ibm-messaging/mq-mqi-nodejs).


## 12. Ejemplos y recepción del mensaje

- [Aviso preventivo](../examples/aviso-preventivo.json): `TASK_REMINDER_DUE`.
- [Aviso de tarjeta vencida](../examples/aviso-vencido.json): `TASK_OVERDUE`.

Los identificadores son ficticios. Los ejemplos permiten comprobar el formato;
para probar el flujo completo se necesitan registros reales relacionados en Supabase
y fechas vigentes. Un ejemplo cuya fecha ya pasó debe tratarse como expirado.

El productor envía texto JSON UTF-8 (MQSTR, CCSID 1208), sin un envoltorio adicional.
El consumidor debe reutilizar [el contrato compartido](../domain/contrato.ts):

```ts
import { reminderEventSchema } from "@/modules/ibm-mq/domain/contrato";

// body es el Buffer recibido desde IBM MQ.
const event = reminderEventSchema.parse(JSON.parse(body.toString("utf8")));
```

Este fragmento solo valida el formato. El consumidor debe capturar los errores de
JSON/validación y aplicar la política de errores, sin reintentos infinitos.

### Comprobaciones antes de confirmar

1. Buscar el recordatorio por `reminderId`; su `user_id` identifica al destinatario.
2. Verificar que tarjeta, workspace, tipo y versión coincidan con los datos guardados.
3. Comprobar vigencia, tarjeta pendiente, elementos sin archivar y membresía activa.
4. Guardar notificación y estado procesado de forma atómica, evitando duplicados por
   `eventId` y destinatario. Cada responsable tiene su propio recordatorio y evento.
5. Confirmar en MQ después de guardar el resultado o resolver una omisión válida.
   Ante fallos temporales, aplicar el flujo acordado de reintentos y cola de errores.

`schemaVersion` identifica el formato; `scheduleVersion`, la programación de la tarjeta.
El `eventId` se conserva al reintentar, aunque cambie el identificador interno de MQ.
No exigir que outbox esté en `PUBLISHED` para consumir: el mensaje puede llegar antes
de que el productor registre esa confirmación en Supabase.

Estos ejemplos no incluyen credenciales ni aplican migraciones. Ambas ramas deben
compartir el contrato y las migraciones existentes; no crear tablas o contratos duplicados.


## 13. Resumen de tablero con Request/Reply

Esta funcionalidad es independiente del flujo de recordatorios. No modifica migraciones,
productor, consumidor, outbox ni cola de backout.

### Arquitectura

```text
Navegador
  -> POST /api/boards/{boardId}/summary (Next.js, sesión + MFA + membresía)
  -> puente local HTTP (modules/ibm-mq/legacy/mq-resumen, credenciales authproducer)
  -> AUTHCDN.SUMMARY.REQUEST.Q
  -> worker respondedor (credenciales authconsumer, consulta Supabase)
  -> AUTHCDN.SUMMARY.REPLY.Q
  -> puente (MQMO_MATCH_CORREL_ID)
  -> Next.js -> navegador
```

El cliente nativo `ibmmq` nunca se importa desde Next.js. El puente usa `Get()` asíncrono,
no `GetSync`, para no bloquear su hilo. Cada solicitud abre su propia conexión y su propio
handle de respuesta; `MsgId` de la solicitud se copia a `CorrelId` de la respuesta. El
respondedor usa transacciones MQ: el GET de la solicitud y el PUT de la respuesta se
confirman con un único `MQCMIT`.

### Contrato

Solicitud (`modules/ibm-mq/domain/resumen.ts`):

```json
{
  "schemaVersion": 1,
  "requestId": "11111111-1111-4111-8111-111111111111",
  "boardId": "22222222-2222-4222-8222-222222222222",
  "userId": "33333333-3333-4333-8333-333333333333",
  "createdAt": "2026-10-19T12:00:00.000Z",
  "expiresAt": "2026-10-19T12:00:15.000Z"
}
```

Respuesta:

```json
{
  "schemaVersion": 1,
  "requestId": "11111111-1111-4111-8111-111111111111",
  "boardId": "22222222-2222-4222-8222-222222222222",
  "status": "OK",
  "generatedAt": "2026-10-19T12:00:01.000Z",
  "stats": { "totalActive": 12, "pending": 7, "completed": 3, "overdue": 2 }
}
```

En error, `status` es `ERROR`, `stats` es `null` y `error` contiene un código controlado:
`INVALID_REQUEST`, `EXPIRED`, `FORBIDDEN`, `NOT_FOUND` o `INTERNAL_ERROR`.

Categorías mutuamente excluyentes sobre tarjetas activas (tarjeta, lista, tablero y
workspace sin archivar):

- Completadas: `completed_at` no nulo.
- Vencidas: no completadas con `due_at < now`.
- Pendientes: no completadas sin `due_at` o con `due_at >= now`.
- `totalActive = pending + completed + overdue`.

### Variables nuevas

Reutiliza `MQ_QUEUE_MANAGER`, `MQ_CHANNEL`, `MQ_CONNECTION_NAME`, `MQ_TLS_*` y
`NEXT_PUBLIC_SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`. Las credenciales no cambian:
el puente usa `MQ_PRODUCER_USERNAME`/`MQ_PRODUCER_PASSWORD`; el respondedor usa
`MQ_USERNAME`/`MQ_PASSWORD`.

```sh
MQ_SUMMARY_REQUEST_QUEUE=AUTHCDN.SUMMARY.REQUEST.Q
MQ_SUMMARY_REPLY_QUEUE=AUTHCDN.SUMMARY.REPLY.Q
MQ_SUMMARY_TIMEOUT_MS=8000
MQ_SUMMARY_REQUEST_TTL_MS=15000
MQ_SUMMARY_WAIT_MS=5000
MQ_SUMMARY_INTERVAL_MS=2000
MQ_SUMMARY_MAX_ATTEMPTS=3
MQ_SUMMARY_REPLY_TTL_MS=60000
MQ_SUMMARY_BRIDGE_HOST=127.0.0.1
MQ_SUMMARY_BRIDGE_PORT=4100
MQ_SUMMARY_BRIDGE_URL=http://127.0.0.1:4100
MQ_SUMMARY_BRIDGE_TOKEN=<secreto-largo-compartido-por-ambos-procesos>
MQ_SUMMARY_HTTP_TIMEOUT_MS=12000
```

`MQ_SUMMARY_BRIDGE_TOKEN` debe ser el mismo en Next.js y en el puente. No debe llevar
prefijo `NEXT_PUBLIC_` ni llegar al navegador.

### Arranque local

```sh
pnpm --dir modules/ibm-mq/legacy/mq-resumen install
pnpm mq:resumen:respondedor
pnpm mq:resumen:puente
# En otra terminal:
pnpm dev
```

Para una sola iteración del respondedor: `pnpm --dir modules/ibm-mq/legacy/mq-resumen start:respondedor --once`.

### Prueba de integración real (requiere autorización previa)

1. Confirmar que las colas existen y que los permisos son los indicados en el enunciado.
2. Añadir las variables anteriores a `.env.local` sin commitear secretos.
3. Arrancar respondedor y puente; revisar que ambos procesos conecten por TLS.
4. Abrir un tablero, pulsar **Resumen del tablero** y comprobar las cuatro cifras.
5. Repetir desde dos navegadores a la vez y verificar que cada uno recibe su respuesta.
6. Detener el respondedor y comprobar que el endpoint devuelve timeout/error controlado.
7. Revisar que la solicitud no se confirma si falla la publicación de la respuesta.

No se han ejecutado publicaciones ni consumos reales contra IBM MQ Cloud durante el
desarrollo de este bloque. Las pruebas actuales usan clientes MQ simulados.
