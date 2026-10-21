# IBM MQ: mapa del módulo

Este es el punto de entrada para encontrar el código, las pruebas y la documentación de IBM MQ. Las piezas se agrupan por responsabilidad: contratos pequeños, casos de uso e infraestructura. La rama `refactor/estructura-ibm-mq` incluye firma JWT/JWS ES256 de mensajes. Su validación local no demuestra despliegue cloud: las evidencias del 20 de octubre son anteriores a esa firma.

## Empieza aquí

| Necesito… | Abrir |
|---|---|
| Entender desde cero el flujo completo, cada caso y su seguridad | [Guía actual de flujo, escenarios y seguridad](docs/flujo-completo-casos-seguridad.md) |
| Ver headers HTTP, metadatos MQ, body JWT y opciones por cola | [Cabeceras reales del adaptador y ejemplos sin secretos](docs/flujo-completo-casos-seguridad.md#92-tres-cosas-distintas-llamadas-header) |
| Ver los diez requisitos EV2 y sus resultados cloud anteriores a la firma | [Documento histórico de evidencias](docs/evidencias/2026-10-20-preview-refactor/requisitos-ev2-pruebas-y-resultados.md) |
| Abrir las evidencias con imágenes en el navegador | [Informe visual](docs/evidencias/2026-10-20-preview-refactor/requisitos-ev2-pruebas-y-resultados.html) |
| Encontrar mensajes de ejemplo | [Aviso preventivo](examples/aviso-preventivo.json) y [aviso vencido](examples/aviso-vencido.json) |
| Saber qué variables configurar | [Ejemplo sin secretos](config/mq-rest-config.example.txt) |
| Encontrar migraciones, Cron y endpoints | [Mapa de integración](database/README.md) |
| Ejecutar las pruebas de IBM | `pnpm test:mq` o `pnpm test:mq:rest` desde la raíz |
| Consultar la implementación MQI anterior | [Legado nativo](legacy/README.md) |
| Entender la firma JWT de mensajes y su activación coordinada | [Firma de mensajes](docs/message-signing.md) |

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
├── docs/            Último informe, capturas y respuestas de las pruebas cloud
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
| Autenticidad del mensaje | [infrastructure/message-jwt.ts](infrastructure/message-jwt.ts) | Firma ES256 al enviar y verifica emisor, destino, contexto y vigencia al recibir; no cifra el cuerpo. |
| Persistencia técnica | [infrastructure/store.ts](infrastructure/store.ts) | Acceso de servidor a las RPC y al inbox de Supabase. |
| Datos para el resumen | [infrastructure/tablero.ts](infrastructure/tablero.ts) | Consulta tarjetas y vuelve a comprobar la membresía. |
| Acceso de máquina | [infrastructure/security.ts](infrastructure/security.ts) | Valida los secretos privados de los endpoints operativos. |

## Cómo viaja un recordatorio

1. El usuario programa una tarjeta en la API existente. Vercel verifica su sesión, MFA cuando corresponde, contrato y permisos.
2. Supabase conserva la programación y sus dos tipos de recordatorio. Cron llama cada minuto a `/api/mq/tick` con el secreto de máquina guardado en Vault.
3. `tick()` invoca `enqueue_due_reminders`; el productor reserva un evento del outbox y valida su contrato con Zod.
4. `withMessageSigning()` firma el cuerpo como JWT/JWS ES256 antes del POST REST HTTPS a IBM, con persistencia y TTL.
5. El consumidor examina el mensaje, guarda el token original en el inbox de Supabase y después lo retira por su MsgId.
6. Antes del negocio verifica el JWT, interpreta el JSON y valida Zod. Una entrada sin firma válida prepara cuarentena BOQ, también firmada.
7. `process_reminder_event` revalida acceso, vigencia y estado, y aplica el aviso idempotentemente. El inbox conserva reintentos o salidas pendientes.
8. El usuario consulta sus avisos mediante la API protegida con sesión y RLS.

El resumen entra por la API de tableros, usa las colas configuradas de solicitud/respuesta y relaciona las respuestas mediante MsgId/CorrelId y requestId. Firma ambas direcciones, verifica antes de procesar/devolver y revalida acceso. La [guía completa](docs/flujo-completo-casos-seguridad.md) explica su espera de 20 segundos y la recuperación sin workers locales.

## Qué conserva su ubicación

Next.js descubre los endpoints dentro de `app/api/`. Supabase CLI descubre las migraciones en `supabase/migrations/`. Esos archivos conservan sus rutas y están enlazados desde [database/README.md](database/README.md); no hay copias de las migraciones.

Las variables reales deben permanecer fuera del repositorio. La documentación del código actual está en `docs/flujo-completo-casos-seguridad.md`; `docs/evidencias/2026-10-20-preview-refactor/` conserva las respuestas, capturas y archivos de integridad históricos anteriores a la firma. No se modificaron claves, Vault ni Cron remotos durante esta actualización.

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
