# Mapa del proyecto

La estructura agrupa cada pieza por su responsabilidad y reúne IBM MQ en un módulo. Las rutas públicas, la interfaz y el comportamiento de la aplicación se conservan.

| Carpeta | Qué contiene | Punto de entrada |
|---|---|---|
| `app/` | Páginas y endpoints que descubre Next.js. | [Página principal](../app/page.tsx) |
| `components/` | Interfaz por funcionalidad: autenticación, tableros, avisos y workspaces. | [Componentes base](../components/ui/primitives.tsx) |
| `lib/` | Autenticación, permisos, tarjetas, validaciones, clima y cliente Supabase compartidos. | [Validación de sesión](../lib/auth/require-user.ts) |
| `modules/ibm-mq/` | Contratos, lógica, REST, pruebas, configuración y documentación de IBM. | [Mapa IBM MQ](../modules/ibm-mq/README.md) |
| `tests/` | Pruebas generales y herramientas, separadas de la implementación. | [Guía de pruebas](../tests/README.md) |
| `supabase/` | Migraciones, Cron y rollback en las rutas esperadas por Supabase CLI. | [Índice de integración IBM](../modules/ibm-mq/database/README.md) |
| `scripts/` | Herramientas generales, como la carga de datos demo. | [Seed](../scripts/seed-supabase-demo.mjs) |
| `docs/` | Guías generales, autenticación y colección Postman. | [Seguridad](seguridad-autenticacion.md) |
| `specs/` | Especificaciones y planes del proyecto. | [Especificación inicial](../specs/001-trello-mvp-auth/spec.md) |

## Encontrar una funcionalidad

Para un cambio visual, empezar en `components/` y en su página de `app/`. Para una regla compartida, buscar en `lib/`. Para publicación, consumo, Request/Reply, errores o reintentos IBM, empezar en [modules/ibm-mq/README.md](../modules/ibm-mq/README.md).

Dentro de IBM, `domain/` define contratos, `application/` coordina el trabajo e `infrastructure/` conecta con IBM y Supabase. Cada archivo mantiene una responsabilidad concreta. `tests/` verifica las piezas y `docs/` explica su funcionamiento y conserva evidencias.

Los endpoints de `app/api/` y el SQL de `supabase/` conservan sus ubicaciones para que los frameworks los descubran. El [índice de integración](../modules/ibm-mq/database/README.md) los reúne con enlaces, sin duplicarlos.

## Cambio de ubicaciones

| Antes | Ahora |
|---|---|
| `lib/mq/` | `modules/ibm-mq/domain`, `application` e `infrastructure` |
| `workers/mq-productor/productor.ts` | `modules/ibm-mq/application/productor.ts` |
| `workers/mq-resumen/tablero.ts` | `modules/ibm-mq/infrastructure/tablero.ts` |
| Resto de `workers/` | `modules/ibm-mq/legacy/` |
| Pruebas mezcladas con workers | `modules/ibm-mq/tests/legacy/` y `tests/unit/` del módulo |
| `tests/unit/mq/` y `tests/integration/mq/` | `modules/ibm-mq/tests/unit/` e `integration/` |
| `scripts/mq-rest-probe.mjs` | `modules/ibm-mq/scripts/mq-rest-probe.mjs` |
| `scripts/mq-scheduler.mjs` | `modules/ibm-mq/legacy/scripts/mq-scheduler.mjs` |
| Guías, configuración, ejemplos y evidencias MQ de `docs/` | `modules/ibm-mq/docs/`, `config/` y `examples/` |
| `test/swarmforge/` | `tests/tooling/swarmforge/` |

Las configuraciones de Next.js, TypeScript, Vitest y Playwright permanecen en la raíz. Los archivos de entorno y los secretos conservan su ubicación y contenido.


## Verificación de esta reorganización

- Comparación de 58 archivos de código: mismos tokens salvo literales de rutas.
- Imports locales y enlaces de navegación comprobados.
- Archivos de entorno, lockfile principal y SQL de Supabase: contenido conservado.
- Evidencias históricas: mismos bytes y hashes después del movimiento.
- TypeScript, lint y build de Next.js: correctos con Node 22.23.3.
- Suite completa: 251 pruebas aprobadas, 3 omitidas y cero fallos. Las tres omitidas son diagnósticos nativos de Linux en Windows.

En este equipo una prueba de interfaz existente excedió el límite predeterminado de cinco segundos, tanto en la suite como aislada. Se comprobó que su archivo y el componente eran idénticos a la rama de origen. La validación completa satisfactoria usó un límite de 15 segundos por ejecución y dos workers; no se modificó la prueba ni el timeout de `vitest.config.ts`.

Comando equivalente con pnpm 9.15 y Node 22:

```sh
pnpm exec vitest run --maxWorkers=2 --minWorkers=1 --testTimeout=15000
```

Las pruebas Clojure del helper conservaron su contenido y se actualizó su ruta en `bb.edn`; no se ejecutó `bb test` porque Babashka no está instalado en este entorno. Esta reorganización no ejecuta SQL remoto, no altera el Cron cloud y no despliega producción.
