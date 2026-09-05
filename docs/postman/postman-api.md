# Documentación API - Auth-DCN

## 1. Descripción

Auth-DCN es un MVP estilo Trello que expone una API REST para gestionar espacios de
trabajo (workspaces), tableros (boards), listas y tarjetas (cards), con miembros e
invitaciones por rol (`owner` / `editor` / `viewer`), ubicación por workspace y contexto
de hora/clima.

- **Framework**: Next.js (App Router), route handlers en `app/api/**/route.ts`.
- **Backend**: Supabase (Postgres + Auth).
- No expone endpoints REST de login/register: la autenticación se realiza desde el
  cliente con Supabase Auth.

## 2. Base URL

```text
Producción: https://auth-cdn.vercel.app
Local:      http://localhost:3000
```

## 3. Autenticación

Los endpoints privados utilizan la sesión de Supabase transmitida por cookies
(`sb-...-auth-token`). No se usa Authorization Bearer Token.

La colección de Postman inicia sesión con la cuenta owner configurada en el
environment (`loginEmail` / `loginPassword`) y guarda automáticamente la cookie
en el Cookie Jar de Postman para autenticar los siguientes requests. Los valores
sensibles no se versionan: complétalos en Postman como valores locales/current
del environment.

- Un endpoint privado sin sesión válida responde `401`.
- Un endpoint privado con MFA pendiente responde `403`.
- `GET /api/health/supabase` es público (no requiere autenticación).

## 4. APIs

El proyecto usa las siguientes APIs:

| API | Tipo | Base URL | Autenticación | Archivo |
|---|---|---|---|---|
| Auth-DCN | Propia (expuesta) | `https://auth-cdn.vercel.app` | Sesión Supabase (cookies) | [`app/api`](../../app/api) |
| Supabase | Externa (consumida) | `NEXT_PUBLIC_SUPABASE_URL` | Publishable/anon key | [`lib/supabase/server.ts`](../../lib/supabase/server.ts) |
| Open-Meteo | Externa (consumida) | `https://api.open-meteo.com` | Ninguna | [`lib/weather/provider.ts:17`](../../lib/weather/provider.ts#L17) |

**Total de endpoints: 26**

### 4.1 Auth-DCN (propia)

**Health**

| Endpoint | Uso | Resultado esperado | Archivo |
|---|---|---|---|
| `GET /api/health/supabase` | Comprobar la conectividad con Supabase. | Confirmar que existe conexión con Supabase. | [`app/api/health/supabase/route.ts:6`](../../app/api/health/supabase/route.ts#L6) |

**Authentication**

| Endpoint | Uso | Resultado esperado | Archivo |
|---|---|---|---|
| `GET /api/auth/session` | Obtener el usuario de la sesión actual. | Retornar la información de la sesión autenticada. | [`app/api/auth/session/route.ts:5`](../../app/api/auth/session/route.ts#L5) |
| `POST /api/auth/logout` | Cerrar la sesión actual. | Finalizar la sesión del usuario. | [`app/api/auth/logout/route.ts:5`](../../app/api/auth/logout/route.ts#L5) |

**Workspaces**

| Endpoint | Uso | Resultado esperado | Archivo |
|---|---|---|---|
| `GET /api/workspaces` | Listar los espacios de trabajo activos del usuario. | Retornar los workspaces disponibles para el usuario. | [`app/api/workspaces/route.ts:12`](../../app/api/workspaces/route.ts#L12) |
| `POST /api/workspaces` | Crear un nuevo espacio de trabajo. | Crear un nuevo workspace. | [`app/api/workspaces/route.ts:36`](../../app/api/workspaces/route.ts#L36) |
| `GET /api/workspaces/{workspaceId}` | Obtener un espacio de trabajo específico. | Retornar el workspace solicitado. | [`app/api/workspaces/[workspaceId]/route.ts:6`](../../app/api/workspaces/%5BworkspaceId%5D/route.ts#L6) |
| `DELETE /api/workspaces/{workspaceId}` | Archivar un espacio de trabajo. | Archivar el workspace indicado. | [`app/api/workspaces/[workspaceId]/route.ts:22`](../../app/api/workspaces/%5BworkspaceId%5D/route.ts#L22) |

**Boards**

| Endpoint | Uso | Resultado esperado | Archivo |
|---|---|---|---|
| `GET /api/workspaces/{workspaceId}/boards` | Listar los tableros de un espacio de trabajo. | Retornar los boards del workspace. | [`app/api/workspaces/[workspaceId]/boards/route.ts:7`](../../app/api/workspaces/%5BworkspaceId%5D/boards/route.ts#L7) |
| `POST /api/workspaces/{workspaceId}/boards` | Crear un tablero en un espacio de trabajo. | Crear un nuevo board. | [`app/api/workspaces/[workspaceId]/boards/route.ts:22`](../../app/api/workspaces/%5BworkspaceId%5D/boards/route.ts#L22) |
| `GET /api/boards/{boardId}` | Obtener un tablero con sus listas y tarjetas. | Retornar el board solicitado con sus listas y cards. | [`app/api/boards/[boardId]/route.ts:7`](../../app/api/boards/%5BboardId%5D/route.ts#L7) |
| `PATCH /api/boards/{boardId}` | Actualizar el título de un tablero. | Actualizar el board indicado. | [`app/api/boards/[boardId]/route.ts:23`](../../app/api/boards/%5BboardId%5D/route.ts#L23) |
| `DELETE /api/boards/{boardId}` | Archivar un tablero. | Archivar el board indicado. | [`app/api/boards/[boardId]/route.ts:35`](../../app/api/boards/%5BboardId%5D/route.ts#L35) |

**Lists**

| Endpoint | Uso | Resultado esperado | Archivo |
|---|---|---|---|
| `POST /api/boards/{boardId}/lists` | Crear una lista dentro de un tablero. | Crear una nueva lista en el board. | [`app/api/boards/[boardId]/lists/route.ts:7`](../../app/api/boards/%5BboardId%5D/lists/route.ts#L7) |
| `PATCH /api/lists/{listId}` | Actualizar título o posición de una lista. | Actualizar la lista indicada. | [`app/api/lists/[listId]/route.ts:7`](../../app/api/lists/%5BlistId%5D/route.ts#L7) |
| `DELETE /api/lists/{listId}` | Archivar una lista. | Archivar la lista indicada. | [`app/api/lists/[listId]/route.ts:23`](../../app/api/lists/%5BlistId%5D/route.ts#L23) |

**Cards**

| Endpoint | Uso | Resultado esperado | Archivo |
|---|---|---|---|
| `POST /api/lists/{listId}/cards` | Crear una tarjeta dentro de una lista. | Crear una nueva card en la lista. | [`app/api/lists/[listId]/cards/route.ts:7`](../../app/api/lists/%5BlistId%5D/cards/route.ts#L7) |
| `PATCH /api/cards/{cardId}` | Actualizar título o descripción de una tarjeta. | Actualizar la card indicada. | [`app/api/cards/[cardId]/route.ts:7`](../../app/api/cards/%5BcardId%5D/route.ts#L7) |
| `DELETE /api/cards/{cardId}` | Archivar una tarjeta. | Archivar la card indicada. | [`app/api/cards/[cardId]/route.ts:23`](../../app/api/cards/%5BcardId%5D/route.ts#L23) |
| `POST /api/cards/{cardId}/move` | Mover una tarjeta a otra lista. | Mover la card a la lista indicada. | [`app/api/cards/[cardId]/move/route.ts:7`](../../app/api/cards/%5BcardId%5D/move/route.ts#L7) |

**Members**

| Endpoint | Uso | Resultado esperado | Archivo |
|---|---|---|---|
| `GET /api/workspaces/{workspaceId}/members` | Listar los miembros de un espacio de trabajo. | Retornar los miembros del workspace. | [`app/api/workspaces/[workspaceId]/members/route.ts:6`](../../app/api/workspaces/%5BworkspaceId%5D/members/route.ts#L6) |
| `PATCH /api/workspaces/{workspaceId}/members/{userId}` | Cambiar el rol de un miembro. | Actualizar el rol del miembro indicado. | [`app/api/workspaces/[workspaceId]/members/[userId]/route.ts:7`](../../app/api/workspaces/%5BworkspaceId%5D/members/%5BuserId%5D/route.ts#L7) |
| `DELETE /api/workspaces/{workspaceId}/members/{userId}` | Eliminar un miembro del espacio de trabajo. | Eliminar el miembro indicado. | [`app/api/workspaces/[workspaceId]/members/[userId]/route.ts:42`](../../app/api/workspaces/%5BworkspaceId%5D/members/%5BuserId%5D/route.ts#L42) |

**Invitations**

| Endpoint | Uso | Resultado esperado | Archivo |
|---|---|---|---|
| `POST /api/workspaces/{workspaceId}/invitations` | Crear una invitación por email. | Crear una invitación para un nuevo miembro. | [`app/api/workspaces/[workspaceId]/invitations/route.ts:8`](../../app/api/workspaces/%5BworkspaceId%5D/invitations/route.ts#L8) |
| `POST /api/invitations/{token}/accept` | Aceptar una invitación por token. | Aceptar la invitación y agregar al usuario al workspace. | [`app/api/invitations/[token]/accept/route.ts:7`](../../app/api/invitations/%5Btoken%5D/accept/route.ts#L7) |

**Location & Context**

| Endpoint | Uso | Resultado esperado | Archivo |
|---|---|---|---|
| `PATCH /api/workspaces/{workspaceId}/location` | Actualizar la ubicación de un espacio de trabajo. | Actualizar la ubicación del workspace. | [`app/api/workspaces/[workspaceId]/location/route.ts:7`](../../app/api/workspaces/%5BworkspaceId%5D/location/route.ts#L7) |
| `GET /api/workspaces/{workspaceId}/context` | Obtener contexto de hora y clima. | Retornar el contexto de hora y clima del workspace. | [`app/api/workspaces/[workspaceId]/context/route.ts:8`](../../app/api/workspaces/%5BworkspaceId%5D/context/route.ts#L8) |

### 4.2 Supabase (externa)

| Recurso | Uso | Archivo |
|---|---|---|
| Auth · sesión | Obtener el usuario actual (`getUser`) y cerrar sesión (`signOut`). | [`lib/auth/require-user.ts:10`](../../lib/auth/require-user.ts#L10) |
| Auth · MFA | Nivel de garantía (AAL) y factores TOTP verificados. | [`lib/auth/mfa.ts:19`](../../lib/auth/mfa.ts#L19) |
| Postgres | Tablas: `workspaces`, `memberships`, `boards`, `lists`, `cards`, `invitations`, `profiles`. | [`lib/supabase/types.ts:5`](../../lib/supabase/types.ts#L5) |

### 4.3 Open-Meteo (externa)

| Recurso | Uso | Archivo |
|---|---|---|
| `GET /v1/forecast` | Clima por lat/long: temperatura, código de clima y viento. | [`lib/weather/provider.ts:29`](../../lib/weather/provider.ts#L29) |

## 5. Variables utilizadas en Postman

| Variable | Descripción |
|---|---|
| `baseUrl` | URL base de la API (Local o Producción). |
| `workspaceId` | ID del workspace usado por requests dependientes. Se guarda automáticamente tras `Workspaces - Create`. |
| `boardId` | ID del board usado por requests dependientes. Se guarda automáticamente tras `Boards - Create`. |
| `listId` | ID de la lista usado por requests dependientes. Se guarda automáticamente tras `Lists - Create`. |
| `cardId` | ID de la card usado por requests dependientes. Se guarda automáticamente tras `Cards - Create`. |
| `userId` | ID del usuario autenticado como owner. Se guarda automáticamente tras `Sign In (password)`. |
| `invitationToken` | Token en claro devuelto al crear una invitación. Se guarda automáticamente tras `Invitations - Create`. |
| `loginEmail` | Email de la cuenta owner usada para iniciar sesión en Postman. |
| `loginPassword` | Contraseña de la cuenta owner usada para iniciar sesión en Postman. No se documenta el valor en este archivo. |
| `supabaseUrl` | URL del proyecto Supabase usada por el request de login. No se versiona con valor real en los environments. |
| `supabaseAnonKey` | Key de Supabase usada por el request de login. No se versiona con valor real en los environments. |
| `authCookie` | Cookie Supabase generada automáticamente tras `Sign In (password)` e inyectada en endpoints privados. |
| `accessToken` | Access token de referencia guardado tras `Sign In (password)`. |

## 6. Flujo recomendado de pruebas

1. `Sign In (password)` con la cuenta owner configurada en el environment.
2. `GET /api/health/supabase` (verificar conectividad).
3. `GET /api/auth/session` (verificar sesión autenticada).
4. `POST /api/workspaces` → guarda `workspaceId`.
5. `POST /api/workspaces/{workspaceId}/boards` → guarda `boardId`.
6. `POST /api/boards/{boardId}/lists` → guarda `listId`.
7. `POST /api/lists/{listId}/cards` → guarda `cardId`.
8. Actualizar/mover con los `PATCH` de board/list/card y `POST /api/cards/{cardId}/move`.
9. Members (`List`, `Change role`, `Remove`) usando `workspaceId` y `userId`.
10. Invitations (`Create` → guarda `invitationToken`, luego `Accept` con un segundo usuario).
11. Location & Context (`Location - Update`, `Context - Get time/weather`).
12. Archivar en orden inverso: card → list → board → workspace.
13. `POST /api/auth/logout` al final (invalida la sesión).

Los IDs (`userId`, `workspaceId`, `boardId`, `listId`, `cardId`, `invitationToken`) se guardan automáticamente
durante el flujo de Postman.
