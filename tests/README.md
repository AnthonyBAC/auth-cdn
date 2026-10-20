# Pruebas del proyecto

Las pruebas se mantienen separadas de la implementación y se ejecutan desde la raíz del proyecto.

| Ubicación | Contenido |
|---|---|
| [unit](unit) | Autenticación, MFA, permisos, validaciones, tarjetas y clima. |
| [setup.ts](setup.ts) | Preparación compartida de Vitest. |
| [tooling/swarmforge](tooling/swarmforge) | Pruebas del helper de handoff; `bb test` usa esta ubicación. |
| [Pruebas IBM MQ](../modules/ibm-mq/tests) | Unitarias, integración SQL y legado nativo del módulo. |

```sh
pnpm test
pnpm test:watch
pnpm test:mq
pnpm test:mq:rest
```

`vitest.config.ts` descubre tanto estas pruebas como las del módulo IBM. Las pruebas de integración IBM usan una base PGlite local; no ejecutan las migraciones contra Supabase Cloud.

`playwright.config.ts` reserva `tests/e2e/` para recorridos de navegador cuando se añadan. Las respuestas y fotografías de las pruebas cloud ya ejecutadas están en [evidencias IBM](../modules/ibm-mq/docs/evidencias/2026-10-19-mq-rest/LEEME.md).
