# Integración con Supabase y Next.js

Los siguientes archivos son únicos y conservan las ubicaciones que esperan sus herramientas. Este índice reúne las piezas relacionadas con IBM MQ.

## SQL de Supabase

| Archivo | Responsabilidad |
|---|---|
| [0004_mq_base.sql](../../../supabase/migrations/0004_mq_base.sql) | Base de recordatorios y mensajería. |
| [0005_mq_programacion.sql](../../../supabase/migrations/0005_mq_programacion.sql) | Programación de tarjetas y recordatorios. |
| [0006_mq_scheduler.sql](../../../supabase/migrations/0006_mq_scheduler.sql) | Preparación de eventos al llegar la fecha. |
| [0007_mq_productor.sql](../../../supabase/migrations/0007_mq_productor.sql) | Reservas, confirmación y reintentos del outbox. |
| [0008_mq_consumidor.sql](../../../supabase/migrations/0008_mq_consumidor.sql) | Procesamiento idempotente de eventos. |
| [0009_mq_rest_inbox.sql](../../../supabase/migrations/0009_mq_rest_inbox.sql) | Inbox durable, reservas y salidas REST. |
| [0010_mq_rest_maintenance.sql](../../../supabase/migrations/0010_mq_rest_maintenance.sql) | Reconciliación, retención, alertas y salud. |
| [Cron REST](../../../supabase/cron/mq-rest.sql) | Programación del ciclo Vercel y mantenimiento. |
| [Rollback histórico](../../../supabase/rollback) | Scripts anteriores; su ejecución requiere evaluar el impacto sobre datos. |

La reorganización no modifica ni aplica SQL. Las pruebas de integración del módulo leen estas mismas migraciones mediante PGlite local.

## Entradas HTTP de Next.js

| Ruta | Código | Protección |
|---|---|---|
| `POST /api/mq/tick` | [route.ts](../../../app/api/mq/tick/route.ts) | Secreto de máquina de Cron. |
| `GET /api/mq/poc` | [route.ts](../../../app/api/mq/poc/route.ts) | Secreto operativo; lectura no destructiva. |
| `POST /api/boards/{boardId}/summary` | [route.ts](../../../app/api/boards/[boardId]/summary/route.ts) | JWT, MFA y membresía. |
| `PATCH /api/cards/{cardId}/schedule` | [route.ts](../../../app/api/cards/[cardId]/schedule/route.ts) | JWT, MFA y permiso para programar. |
| `POST /api/cards/{cardId}/complete` | [route.ts](../../../app/api/cards/[cardId]/complete/route.ts) | JWT, MFA y acceso a tarjeta. |
| `GET /api/notifications` | [route.ts](../../../app/api/notifications/route.ts) | JWT y RLS del destinatario. |
| `PATCH /api/notifications/{notificationId}` | [route.ts](../../../app/api/notifications/[notificationId]/route.ts) | JWT y aviso propio. |

La lógica IBM de las rutas importa desde `modules/ibm-mq/`. La lógica compartida de tarjetas, autenticación y permisos permanece en `lib/`.

## Interfaz relacionada

- [Programación de tarjeta](../../../components/board/programacion-tarjeta.tsx).
- [Resumen del tablero](../../../components/board/board-summary.tsx).
- [Lista de avisos](../../../components/notifications/notification-list.tsx).

[Volver al módulo](../README.md).
