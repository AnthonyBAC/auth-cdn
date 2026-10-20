# IBM MQ: mapa del módulo

Este es el punto de entrada para encontrar el código, las pruebas y la documentación de IBM MQ. Las piezas se agrupan por responsabilidad: contratos pequeños, casos de uso e infraestructura. La reorganización conserva el comportamiento de la aplicación.

## Empieza aquí

| Necesito… | Abrir |
|---|---|
| Entender el flujo cloud, autenticación y recuperación | [Guía REST](docs/mensajeria-mq.md) |
| Ver los diez requisitos EV2, sus pruebas y resultados | [Documento principal de evidencias](docs/evidencias/2026-10-19-mq-rest/requisitos-ev2-pruebas-y-resultados.md) |
| Abrir las evidencias con imágenes en el navegador | [Informe visual](docs/evidencias/2026-10-19-mq-rest/requisitos-ev2-pruebas-y-resultados.html) |
| Encontrar mensajes de ejemplo | [Aviso preventivo](examples/aviso-preventivo.json) y [aviso vencido](examples/aviso-vencido.json) |
| Saber qué variables configurar | [Ejemplo sin secretos](config/mq-rest-config.example.txt) |
| Encontrar migraciones, Cron y endpoints | [Mapa de integración](database/README.md) |
| Ejecutar las pruebas de IBM | `pnpm test:mq` o `pnpm test:mq:rest` desde la raíz |
| Consultar la implementación MQI anterior | [Legado nativo](legacy/README.md) |

## Carpetas y responsabilidad

```text
modules/ibm-mq/
├── domain/          Contratos de mensajes, tipos y estadísticas de resumen
├── application/     Publicación, captura, procesamiento y Request/Reply
├── infrastructure/  HTTP REST, Supabase, consultas de tablero y secretos de máquina
├── config/          Ejemplos de configuración sin credenciales
├── examples/        JSON de eventos de recordatorio
├── scripts/         Comprobación REST de solo lectura
├── tests/
│   ├── unit/        Pruebas de piezas y endpoints, con dependencias controladas
│   ├── integration/ Pruebas SQL locales con PGlite
│   └── legacy/      Pruebas de la implementación nativa histórica
├── database/        Índice hacia el SQL y las rutas obligatorias del framework
├── docs/            Guías, evidencias, capturas y respuestas de las pruebas cloud
└── legacy/          MQI, diagnósticos y herramientas locales anteriores
```

Los archivos `*.test.ts` están dentro de `tests/`; no se mezclan con la implementación. Los tests generales de autenticación, permisos, tarjetas y clima siguen en [tests](../../tests/README.md).

## Archivos clave

| Pieza | Archivo | Qué hace |
|---|---|---|
| Contrato de recordatorio | [domain/contrato.ts](domain/contrato.ts) | Valida el evento y sus identificadores, versión y fechas. |
| Contrato de resumen | [domain/resumen.ts](domain/resumen.ts) | Define solicitud, respuesta y cálculo de estadísticas. |
| Productor | [application/productor.ts](application/productor.ts) | Reserva el outbox, publica y registra su resultado. |
| Consumidor durable | [application/inbox.ts](application/inbox.ts) | Captura antes de retirar, reserva trabajo y conserva salidas o reintentos. |
| Orquestador cloud | [application/cloud.ts](application/cloud.ts) | Ejecuta el ciclo REST y el Request/Reply con presupuesto de tiempo. |
| Cliente del resumen | [application/resumen-cliente.ts](application/resumen-cliente.ts) | Expone el resumen a la ruta API y traduce errores. |
| Transporte IBM | [infrastructure/rest.ts](infrastructure/rest.ts) | Publica, examina y retira mensajes por HTTPS con filtros de MsgId. |
| Persistencia técnica | [infrastructure/store.ts](infrastructure/store.ts) | Acceso de servidor a las RPC y al inbox de Supabase. |
| Datos para el resumen | [infrastructure/tablero.ts](infrastructure/tablero.ts) | Consulta tarjetas y vuelve a comprobar la membresía. |
| Acceso de máquina | [infrastructure/security.ts](infrastructure/security.ts) | Valida los secretos privados de los endpoints operativos. |

## Cómo viaja un recordatorio

1. El usuario programa una tarjeta en la API existente. Vercel valida su JWT, MFA y permisos.
2. Supabase conserva la programación. `enqueue_due_reminders` prepara el outbox al llegar la fecha.
3. Supabase Cron llama a `/api/mq/tick` con el secreto de máquina guardado en Vault.
4. `application/cloud.ts` usa el productor y `infrastructure/rest.ts` para publicar un mensaje persistente en IBM.
5. El consumidor examina el mensaje, guarda su cuerpo en el inbox de Supabase y después lo retira por su MsgId.
6. `process_reminder_event` aplica el evento de forma idempotente. Si falla, el inbox conserva el trabajo para reintentar o enviar a BOQ.
7. El usuario consulta sus avisos mediante la API protegida con JWT y RLS.

El resumen entra por la API de tableros, usa `SUMMARY.REQUEST.Q` y `SUMMARY.REPLY.Q` y relaciona las respuestas mediante MsgId/CorrelId y requestId. Se conserva la espera y recuperación ya implementadas.

## Qué conserva su ubicación

Next.js descubre los endpoints dentro de `app/api/`. Supabase CLI descubre las migraciones en `supabase/migrations/`. Esos archivos conservan sus rutas y están enlazados desde [database/README.md](database/README.md); no hay copias de las migraciones.

Las variables reales permanecen en los archivos de entorno locales y en la configuración cloud. Las evidencias históricas mantienen sus respuestas y hashes originales; las rutas y la revisión de código que aparecen dentro de ellas describen el momento de esas pruebas.

## Comandos desde la raíz del proyecto

```sh
pnpm test:mq        # Todas las pruebas IBM, incluidas las del legado
pnpm test:mq:rest   # Selección existente de REST, inbox, cloud, rutas y SQL
pnpm test          # Suite completa: aplicación e IBM
pnpm typecheck
pnpm lint
pnpm build
```

`pnpm mq:probe` usa la configuración local para examinar las colas mediante REST sin publicar ni retirar mensajes. Requiere credenciales configuradas. Las herramientas de `legacy/` se ejecutan solamente para mantenimiento histórico; el flujo cloud REST usa Vercel y Supabase Cron.
