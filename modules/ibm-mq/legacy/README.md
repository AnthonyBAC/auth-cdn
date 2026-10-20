# Implementación nativa histórica

Esta carpeta conserva el cliente MQI, sus diagnósticos y las herramientas anteriores. El flujo cloud vigente usa [application/cloud.ts](../application/cloud.ts), REST y Supabase Cron.

| Carpeta | Contenido |
|---|---|
| `mq-productor/` | Conexión MQI y arranque del productor anterior. |
| `mq-consumidor/` | Consumidor MQI, validación y procesamiento anteriores. |
| `mq-resumen/` | Respondedor y puente HTTP locales anteriores. |
| `mq-diagnostico/` | Diagnósticos de redistribuibles, TLS y procesos nativos. |
| `scripts/` | Scheduler local anterior. |

Las pruebas están separadas en [tests/legacy](../tests/legacy). El productor independiente del transporte y las consultas de tablero que reutiliza REST están en [application/productor.ts](../application/productor.ts) e [infrastructure/tablero.ts](../infrastructure/tablero.ts).

Los paquetes históricos conservan sus dependencias y scripts de arranque, con rutas actualizadas. No se ejecutan consumidores MQI y REST sobre las mismas colas simultáneamente. `pnpm mq:scheduler` conserva el comando histórico; el funcionamiento autónomo actual depende del Cron cloud.

[Guía MQI histórica](../docs/mensajeria-mq-nativo.md) · [Volver al módulo](../README.md).
