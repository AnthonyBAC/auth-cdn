# Seguridad y autenticación en Auth DCN

Este documento explica cómo se maneja la seguridad del proyecto: autenticación, sesión, JWT, refresh token, cookies, MFA/TOTP, protección de rutas, autorización, RLS y tipos de API. Solo incluye comportamiento implementado en el código.

Para la referencia completa de endpoints, ver [`docs/postman/postman-api.md`](postman/postman-api.md). Para una introducción corta a RBAC/Auth/RLS, ver [`docs/docs_v1.md`](docs_v1.md).

---

## 1. Mapa de seguridad

La seguridad se divide en capas:

| Capa | Qué resuelve | Implementación |
|---|---|---|
| Identidad | Saber quién es el usuario | Supabase Auth + JWT de sesión |
| Sesión | Mantener al usuario autenticado | Cookies de sesión vía `@supabase/ssr` |
| MFA | Exigir segundo factor si está activo | Supabase Auth MFA + TOTP |
| Protección de páginas | Bloquear pantallas privadas | `middleware.ts` |
| Protección de API | Bloquear requests sin sesión o sin MFA completo | `requireUser()` |
| Autorización | Definir qué puede leer/editar cada usuario | RBAC + RLS en Postgres |

El proyecto no implementa su propio sistema de contraseñas. El registro, login, sesión y MFA se delegan en **Supabase Auth**.

---

## 2. Supabase SDK

Un **SDK** (Software Development Kit) es una librería que permite usar una API externa mediante funciones en el código, sin escribir manualmente cada request HTTP.

En este proyecto se usan:

| Paquete | Uso real |
|---|---|
| `@supabase/supabase-js` | Cliente para Auth, MFA, consultas a Postgres/PostgREST y llamadas RPC (Remote Procedure Call: ejecutar funciones de base de datos desde la app). |
| `@supabase/ssr` | Cliente adaptado a cookies de sesión en navegador, servidor y middleware. |

Clientes creados:

| Cliente | Archivo | Para qué se usa |
|---|---|---|
| `createSupabaseBrowserClient()` | [`lib/supabase/browser.ts`](../lib/supabase/browser.ts) | Login, registro, MFA y acciones desde componentes cliente. |
| `createSupabaseServerClient()` | [`lib/supabase/server.ts`](../lib/supabase/server.ts) | Leer sesión y consultar Supabase desde servidor/API. |
| `createServerClient()` | [`middleware.ts`](../middleware.ts) | Leer/actualizar cookies durante redirecciones y protección de rutas. |

Todos usan `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` o `NEXT_PUBLIC_SUPABASE_ANON_KEY`. La `SUPABASE_SERVICE_ROLE_KEY` no se usa en la app; solo aparece para scripts de seed.

---

## 3. Autenticación

### 3.1 Registro

El formulario llama al SDK:

```ts
supabase.auth.signUp({ email, password, options: { data: { name } } })
```

Al crearse el usuario, la base de datos ejecuta el trigger `on_auth_user_created`, que llama a `handle_new_user()` y crea:

| Registro creado | Tabla |
|---|---|
| Perfil del usuario | `profiles` |
| Workspace inicial | `workspaces` |
| Membresía como dueño | `memberships`, rol `owner` |

Referencia: [`supabase/migrations/0001_initial.sql:117`](../supabase/migrations/0001_initial.sql#L117).

### 3.2 Login

El formulario llama al SDK:

```ts
supabase.auth.signInWithPassword({ email, password })
```

Después del login:

1. Supabase Auth valida email y contraseña.
2. Supabase entrega una sesión con `access token` y `refresh token`.
3. `@supabase/ssr` guarda la sesión en cookies.
4. La app ejecuta `getMfaState()`.
5. Si el usuario tiene TOTP activo y la sesión sigue en `aal1`, se redirige a `/login/mfa`.
6. Si no requiere MFA, se redirige a `/workspaces` o al `redirectTo` recibido.

### 3.3 Logout

El cierre de sesión llama a:

```ts
supabase.auth.signOut()
```

Esto invalida la sesión y limpia las cookies. También existe `POST /api/auth/logout`, que exige sesión antes de cerrar.

---

## 4. Sesión, JWT, refresh token, cookies y headers

### 4.1 Qué contiene la sesión

La sesión de Supabase incluye:

| Elemento | Qué es | Uso |
|---|---|---|
| Access token | JWT firmado por Supabase Auth | Identifica al usuario en requests y en RLS. |
| Refresh token | Token usado por Supabase para renovar la sesión | Permite obtener un nuevo access token sin pedir login otra vez. |
| Expiración | Tiempo de vida de la sesión/token | El SDK la administra. |

### 4.2 Dónde se guarda

La sesión se guarda en cookies con prefijo/nombre tipo:

```text
sb-...-auth-token
```

Estas cookies son manejadas por `@supabase/ssr`. El código de la app no las lee ni escribe manualmente, y no guarda la sesión en `localStorage`.

### 4.3 JWT

El **JWT** es el access token de Supabase. En este proyecto:

- No se construye manualmente.
- No se decodifica en la app para autorizar.
- Se entrega a Supabase/Postgres mediante la sesión.
- Postgres lo usa con `auth.uid()` y `auth.jwt()`.

Ejemplo implementado: `accept_invitation()` valida que el email del JWT coincida con la invitación usando `auth.jwt() ->> 'email'`.

### 4.4 Headers de autenticación

La API propia **no usa**:

```http
Authorization: Bearer <token>
```

La autenticación viaja por cookie:

```http
Cookie: sb-...-auth-token=...
```

Por eso las rutas no leen manualmente el header `Authorization`; llaman a `supabase.auth.getUser()` y el SDK lee la sesión desde la cookie.

---

## 5. MFA y TOTP

### 5.1 Qué es MFA

**MFA** (Multi-Factor Authentication) es autenticación con más de un factor. En esta app significa:

| Factor | Ejemplo |
|---|---|
| Algo que sabes | Contraseña |
| Algo que tienes | Código TOTP desde una app autenticadora |

Cuando TOTP está activo, no basta con email y contraseña. La sesión debe llegar a `aal2`.

El **MFA también lo maneja Supabase Auth**. La app no implementa el algoritmo TOTP, no valida códigos manualmente y no guarda el secreto del autenticador. La app solo coordina el flujo: muestra el QR, recibe el código del usuario, llama al SDK de Supabase, redirige según el estado MFA y guarda el hash del código de recuperación.

### 5.2 Qué es TOTP y de dónde viene

**TOTP** es un código temporal de 6 dígitos basado en el estándar RFC 6238. Lo generan apps como Google Authenticator, Microsoft Authenticator, 1Password, etc.

El proyecto **no usa una librería TOTP propia**. Usa **Supabase Auth MFA**, con estos métodos del SDK:

```text
enroll, challenge, verify, unenroll, listFactors, getAuthenticatorAssuranceLevel
```

El secreto TOTP queda en Supabase Auth (`auth.mfa_factors`). No se guarda en cookies ni en nuestras tablas. En nuestras tablas solo se guarda `profiles.totp_enabled` y `profiles.totp_recovery_code_hash`.

| Parte del MFA | Quién la maneja |
|---|---|
| Crear factor TOTP | Supabase Auth |
| Guardar secreto TOTP | Supabase Auth (`auth.mfa_factors`) |
| Validar código de 6 dígitos | Supabase Auth |
| Calcular AAL (`aal1`/`aal2`) | Supabase Auth |
| Mostrar QR y formulario | La app |
| Redirigir a `/login/mfa` | La app |
| Código de recuperación | La app guarda solo el hash |

### 5.3 Activación en `/security`

Flujo implementado en [`components/auth/mfa-enrollment.tsx`](../components/auth/mfa-enrollment.tsx):

1. `mfa.enroll({ factorType: "totp" })` crea el factor.
2. Supabase devuelve `factorId`, `uri` `otpauth://...` y `secret`.
3. La app muestra el QR con `<QRCode>`.
4. El usuario escanea y escribe el código de 6 dígitos.
5. La app ejecuta `mfa.challenge()` y luego `mfa.verify()`.
6. Si verifica, se genera un código de recuperación.
7. Solo se guarda el hash SHA-256 en `profiles.totp_recovery_code_hash`.
8. `profiles.totp_enabled` queda en `true`.

### 5.4 Login con TOTP activo

Flujo implementado en [`components/auth/mfa-challenge-form.tsx`](../components/auth/mfa-challenge-form.tsx):

1. Tras login con contraseña, la sesión queda en `aal1`.
2. `getMfaState()` detecta que existe un factor TOTP verificado.
3. La app redirige a `/login/mfa?redirectTo=...`.
4. Se busca el factor con `mfa.listFactors()`.
5. Se crea un challenge con `mfa.challenge({ factorId })`.
6. Se valida el código con `mfa.verify({ factorId, challengeId, code })`.
7. Si es correcto, la sesión sube a `aal2` y puede entrar a rutas privadas.

### 5.5 Código de recuperación

El código se genera con [`lib/auth/tokens.ts`](../lib/auth/tokens.ts):

| Función | Qué hace |
|---|---|
| `createToken(9)` | Genera bytes aleatorios con `crypto.getRandomValues()` y los codifica en base64url. |
| `hashToken()` | Calcula SHA-256 con `crypto.subtle.digest()`. |

Solo se guarda el hash. Si el usuario lo usa:

1. Se hashea el código ingresado.
2. Se compara con `profiles.totp_recovery_code_hash`.
3. Si coincide, se eliminan todos los factores TOTP con `unenroll()`.
4. Se limpia `totp_enabled` y `totp_recovery_code_hash`.
5. El código queda consumido y la cuenta vuelve a login solo con contraseña.

### 5.6 Cómo funciona `getMfaState()`

Archivo: [`lib/auth/mfa.ts`](../lib/auth/mfa.ts).

La función consulta dos cosas en paralelo:

```ts
supabase.auth.mfa.getAuthenticatorAssuranceLevel()
supabase.auth.mfa.listFactors()
```

Luego calcula:

| Campo | Significado |
|---|---|
| `currentLevel` | Nivel actual de la sesión: `aal1` o `aal2`. |
| `nextLevel` | Nivel que podría alcanzar si completa el siguiente factor. |
| `hasVerifiedFactor` | `true` si existe un factor TOTP con estado `verified`. |
| `needsChallenge` | `true` si hay TOTP verificado, la sesión está en `aal1` y puede pasar a `aal2`. |

Regla central:

```text
needsChallenge = hasVerifiedFactor && currentLevel === "aal1" && nextLevel === "aal2"
```

Esta misma función se usa en el middleware y en `requireUser()`, así la regla de MFA es consistente en páginas y API.

---

## 6. Protección de páginas y API

### 6.1 Páginas privadas

Archivo: [`middleware.ts`](../middleware.ts).

Rutas protegidas actualmente:

```text
/workspaces...
/boards...
```

La página `/security` también valida sesión desde servidor y redirige a `/login` si no hay usuario.

Reglas:

| Caso | Resultado |
|---|---|
| Ruta privada sin sesión | Redirige a `/login?redirectTo=...`. |
| Ruta privada con TOTP pendiente | Redirige a `/login/mfa?redirectTo=...`. |
| `/login/mfa` sin usuario | Redirige a `/login`. |
| `/login/mfa` sin desafío pendiente | Redirige a `/workspaces`. |

El parámetro `redirectTo` es un query param usado para volver al destino original después de login/MFA.

### 6.2 API privada

Archivo: [`lib/auth/require-user.ts`](../lib/auth/require-user.ts).

Todas las rutas privadas llaman a `requireUser()`:

1. Crea cliente Supabase de servidor.
2. Ejecuta `supabase.auth.getUser()`.
3. Si no hay usuario, responde `401 UNAUTHENTICATED`.
4. Ejecuta `getMfaState()`.
5. Si falta MFA, responde `403 FORBIDDEN`.
6. Si todo está correcto, devuelve `{ supabase, user }`.

Formato de error:

```json
{ "error": { "code": "FORBIDDEN", "message": "...", "details": {} } }
```

Estados usados: `400 BAD_REQUEST`, `401 UNAUTHENTICATED`, `403 FORBIDDEN`, `404 NOT_FOUND`, `409 CONFLICT`.

---

## 7. Autorización: RBAC y RLS

### 7.1 RBAC

**RBAC** significa control de acceso basado en roles. En este proyecto los roles viven por workspace:

| Rol | Permisos esperados |
|---|---|
| `owner` | Ver, editar contenido, gestionar miembros/invitaciones, ubicación y eliminar workspace. |
| `editor` | Ver y editar contenido. |
| `viewer` | Solo ver contenido. |

Las funciones de [`lib/rbac/permissions.ts`](../lib/rbac/permissions.ts) ayudan a la interfaz a mostrar u ocultar botones. No son la seguridad final.

### 7.2 Qué es RLS

**RLS** (Row-Level Security) es seguridad a nivel de fila en Postgres. Permite que la base de datos decida qué filas puede leer o modificar cada usuario.

Ejemplo práctico: dos usuarios pueden consultar `workspaces`, pero Postgres solo devuelve los workspaces donde cada uno tiene una membresía activa.

### 7.3 Cómo se implementa RLS

RLS está activado en las tablas principales:

```text
profiles, workspaces, memberships, invitations, boards, lists, cards, card_assignees, context_snapshots
```

Las políticas usan funciones `security definer`:

| Función | Decisión |
|---|---|
| `active_role(workspace_id)` | Obtiene el rol activo del usuario autenticado. |
| `can_read_workspace(workspace_id)` | Permite lectura si el usuario tiene rol activo. |
| `can_edit_workspace_content(workspace_id)` | Permite edición si es `owner` o `editor`. |
| `can_manage_workspace(workspace_id)` | Permite gestión si es `owner`. |

Estas funciones usan `auth.uid()`, que viene del JWT de Supabase.

### 7.4 RPC especiales

**RPC** significa **Remote Procedure Call**. En este proyecto es una llamada desde la app hacia una función SQL de Supabase/Postgres, por ejemplo `create_workspace()` o `accept_invitation()`.

Hay dos funciones RPC `security definer` para casos donde RLS bloquearía el flujo normal:

| RPC | Qué significa | Uso |
|---|---|---|
| `create_workspace(workspace_name)` | Función SQL llamada desde la app | Crea workspace y membresía `owner` en una operación atómica. |
| `accept_invitation(token_hash_input)` | Función SQL llamada desde la app | Acepta invitación, valida email desde `auth.jwt()` y crea/actualiza membresía. |

Esto evita debilitar las políticas generales.

---

## 8. Tipos de API y protocolos

### 8.1 API propia de Auth DCN

La API propia está en `app/api/**/route.ts` y funciona sobre **HTTP/HTTPS** con respuestas **JSON**.

Es **mayormente RESTful** porque usa recursos y métodos HTTP:

| Método | Uso |
|---|---|
| `GET` | Leer datos. |
| `POST` | Crear recursos o ejecutar acciones. |
| `PATCH` | Actualizar datos. |
| `DELETE` | Archivar recursos con `archived_at`; no borra físicamente. |

No todos los endpoints son REST puro: `/api/cards/{cardId}/move` y `/api/invitations/{token}/accept` representan acciones específicas.

Seguridad de la API propia:

| Tipo | Seguridad |
|---|---|
| `GET /api/health/supabase` | Público. |
| `GET /api/auth/session` | Requiere sesión y MFA completo si aplica. |
| `POST /api/auth/logout` | Requiere sesión y MFA completo si aplica. |
| Workspaces/boards/lists/cards/members/invitations/location/context | Requieren sesión, MFA completo si aplica y permisos por RLS. |
| `GET /api/geocode?query=...` | Requiere sesión y MFA completo si aplica. |

### 8.2 Qué recibe y qué responde la API propia

| Tipo de dato | Cómo entra |
|---|---|
| IDs | Path params: `/api/workspaces/{workspaceId}`. |
| Búsqueda de lugar | Query param: `/api/geocode?query=medellin`. |
| Creación/actualización | Body JSON validado con Zod. |
| Sesión | Cookie `sb-...-auth-token`. |

Respuestas típicas:

```json
{ "workspace": { "id": "...", "name": "...", "role": "owner" } }
```

```json
{ "boards": [] }
```

```json
{ "error": { "code": "BAD_REQUEST", "message": "...", "details": {} } }
```

### 8.3 API de Supabase consumida por SDK

No escribimos `fetch` manual para autenticación. El SDK consume la API de Supabase usando `NEXT_PUBLIC_SUPABASE_URL`.

| Supabase API | Uso en el proyecto |
|---|---|
| Auth | Registro, login, logout, usuario actual. |
| Auth MFA | TOTP, factores, challenges, AAL. |
| PostgREST | `.from(...).select/insert/update(...)` contra tablas públicas con RLS. |
| RPC (Remote Procedure Call) | Ejecuta funciones SQL: `create_workspace()` y `accept_invitation()`. |

### 8.4 APIs externas

| API | URL | Auth | Uso |
|---|---|---|---|
| Open-Meteo Forecast | `https://api.open-meteo.com/v1/forecast` | Ninguna | Clima por latitud/longitud. |
| Open-Meteo Geocoding | `https://geocoding-api.open-meteo.com/v1/search` | Ninguna | Buscar lugares por texto. |

Se consumen desde servidor en `lib/weather/*`. Si fallan, la app responde contexto `unavailable` o lista vacía, sin romper el flujo principal.

---

## 9. Ejemplos de URL

```text
# Login y registro
/login
/register

# Login con segundo factor pendiente
/login/mfa?redirectTo=%2Fworkspaces

# Páginas privadas
/workspaces
/workspaces/{workspaceId}
/boards/{boardId}
/security

# Invitación con token en ruta
/invitations/{token}

# API privada autenticada por cookie
GET  /api/workspaces
POST /api/workspaces/{workspaceId}/boards
PATCH /api/cards/{cardId}

# API privada con query param
GET /api/geocode?query=medellin

# API pública
GET /api/health/supabase
```

---

## 10. Resumen rápido

| Tema | Implementación |
|---|---|
| Login/registro | Supabase Auth SDK. |
| Almacenamiento de sesión | Cookie `sb-...-auth-token` gestionada por `@supabase/ssr`. |
| Access token | JWT firmado por Supabase. |
| Refresh token | Guardado en la sesión/cookie y administrado por el SDK. |
| Header auth | No usa `Authorization: Bearer`; usa cookie. |
| MFA | Supabase Auth MFA; la app solo coordina UI/redirecciones y recovery code. |
| TOTP | Factor temporal de 6 dígitos; secreto en `auth.mfa_factors`. |
| `getMfaState()` | Calcula si la sesión necesita pasar de `aal1` a `aal2`. |
| API propia | Mayormente RESTful, HTTP/HTTPS, JSON, cookie auth. |
| Autorización real | RLS en Postgres usando `auth.uid()` del JWT. |
