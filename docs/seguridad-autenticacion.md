# Seguridad y autenticación en Auth DCN

Documento de referencia sobre cómo se maneja la **seguridad, la autenticación, el JWT, las cookies, el TOTP y las APIs** en este proyecto. Solo describe lo que está implementado. Para la lista completa de endpoints y sus respuestas, ver [`docs/postman/postman-api.md`](postman/postman-api.md); para una introducción a RBAC/Auth/RLS, ver [`docs/docs_v1.md`](docs_v1.md).

---

## 1. Visión general

La autenticación no la implementamos nosotros: la delega en **Supabase Auth** (GoTrue) a través de su **SDK**. El flujo completo se resume así:

1. El cliente (navegador) llama a los métodos del SDK (`signUp`, `signInWithPassword`, `signOut`).
2. Supabase Auth valida las credenciales y devuelve una **sesión** con un **access token (JWT)** y un **refresh token**.
3. El SDK (`@supabase/ssr`) guarda esa sesión en **cookies httpOnly** (`sb-...-auth-token`).
4. En cada request, nuestro código lee la cookie y reconstruye el usuario con `supabase.auth.getUser()`.
5. Las rutas de API y el middleware exigen ese usuario y, si hay TOTP activo, el nivel `aal2`.
6. La autorización real (qué filas puede leer/editar) la decide **RLS** en Postgres usando el `uid` del JWT.

---

## 2. Procedimiento de autenticación

### 2.1 Registro

- `signUp({ email, password, options.data.name })` — ver [`components/auth/auth-forms.tsx`](../components/auth/auth-forms.tsx).
- Al crearse el usuario, un **trigger** (`on_auth_user_created` → `handle_new_user()`) crea en una sola transacción su `profile`, su primer `workspace` y su `membership` con rol `owner` — ver [`supabase/migrations/0001_initial.sql:117`](../supabase/migrations/0001_initial.sql#L117).

### 2.2 Login (con contraseña)

1. `signInWithPassword({ email, password })`.
2. Tras el login, el cliente consulta `getMfaState()`.
3. Si el usuario tiene un factor TOTP verificado, redirige a `/login/mfa` para completar el desafío.
4. Si no, va directo a `/workspaces`.

### 2.3 Logout

- `signOut()` invalida la sesión y limpia las cookies; puede llamarse desde el botón (`components/auth/sign-out-button.tsx`) o vía `POST /api/auth/logout`.

### 2.4 Sesión

- `GET /api/auth/session` devuelve `{ user: { id, email, name } }` del usuario actual.
- `GET /api/health/supabase` es **público** y reporta el estado de la conexión con Supabase.

---

## 3. Qué es el SDK y cómo lo usamos

Un **SDK** (Software Development Kit) es una librería que envuelve una API externa para llamarla con funciones tipadas en vez de hacer `fetch` a mano. Usamos dos paquetes:

| Paquete | Uso |
|---|---|
| `@supabase/supabase-js` | Cliente de Supabase (Auth, Postgres/PostgREST, RPC). |
| `@supabase/ssr` | Maneja las cookies de sesión en entornos Next.js (server, browser y middleware). |

Creamos **tres clientes**, todos con la URL del proyecto y la **publishable/anon key**:

| Cliente | Archivo | Entorno |
|---|---|---|
| `createSupabaseBrowserClient()` | [`lib/supabase/browser.ts`](../lib/supabase/browser.ts) | Navegador (componentes `"use client"`). |
| `createSupabaseServerClient()` | [`lib/supabase/server.ts`](../lib/supabase/server.ts) | Server Components y Route Handlers (lee/escribe cookies). |
| `createServerClient()` en línea | [`middleware.ts`](../middleware.ts) | Middleware (Edge), con `getAll`/`setAll` sobre `request`/`response`. |

La **publishable/anon key** no es secreta: es la clave pública que identifica al proyecto y aplica **RLS**. La `SUPABASE_SERVICE_ROLE_KEY` (privilegiada, ignora RLS) **no se usa en la app**; solo está reservada para el seed de demo.

---

## 4. Cookies: qué se guarda y por qué

- La sesión vive en **cookies httpOnly** con nombre `sb-...-auth-token` (access token + refresh token + expiración).
- `httpOnly` impide que JavaScript del navegador la lea → protege contra **XSS**.
- No se usa `localStorage` para la sesión.
- El cliente del servidor (`lib/supabase/server.ts`) las lee/escribe; el middleware las propaga al `response`.

> Postman autentica guardando esta cookie en su Cookie Jar (ver `docs/postman/postman-api.md`).

---

## 5. JWT y header

- El **access token es un JWT** firmado por Supabase Auth.
- Se transporta **en la cookie**, **no** en un header `Authorization: Bearer`. Por eso nuestras rutas no inspeccionan headers de auth.
- Dentro de Postgres, Supabase expone el JWT como `auth.jwt()` y el id del usuario como `auth.uid()`; RLS y las funciones `security definer` lo usan para saber quién consulta.
- `accept_invitation()` lee `auth.jwt() ->> 'email'` para validar que la invitación corresponda al usuario autenticado — ver [`supabase/migrations/0003_workspace_invite_rpc.sql:50`](../supabase/migrations/0003_workspace_invite_rpc.sql#L50).

---

## 6. Protección de páginas (middleware)

[`middleware.ts`](../middleware.ts) aplica las reglas a todas las rutas salvo `_next/static`, `_next/image` y `favicon.ico`.

| Regla | Comportamiento |
|---|---|
| Supabase no configurado + ruta privada | Redirige a `/login`. |
| Ruta privada (`/workspaces`, `/boards`) sin usuario | Redirige a `/login?redirectTo=...`. |
| Usuario con TOTP activo y sesión `aal1` en ruta privada | Redirige a `/login/mfa?redirectTo=...`. |
| `/login/mfa` sin desafío pendiente | Redirige a `/workspaces`. |
| `/login/mfa` sin usuario | Redirige a `/login`. |

El `redirectTo` se pasa como **query param** y se respeta al completar login o MFA.

---

## 7. Protección de la API (`requireUser`)

Todas las rutas privadas empiezan llamando a [`requireUser()`](../lib/auth/require-user.ts):

1. `supabase.auth.getUser()` desde la cookie.
2. Si no hay usuario → `401 UNAUTHENTICATED`.
3. `getMfaState()`; si falta completar el desafío TOTP → `403 FORBIDDEN`.
4. Devuelve un `supabase` ya identificado con ese usuario (nunca con service role).

### Formato de error estándar

```json
{ "error": { "code": "FORBIDDEN", "message": "...", "details": {} } }
```

| Código | HTTP |
|---|---|
| `BAD_REQUEST` | 400 |
| `UNAUTHENTICATED` | 401 |
| `FORBIDDEN` | 403 |
| `NOT_FOUND` | 404 |
| `CONFLICT` | 409 |

Ver [`lib/api/errors.ts`](../lib/api/errors.ts).

---

## 8. TOTP (verificación en dos pasos)

### 8.1 De dónde viene

No usamos una librería TOTP propia. TOTP es **RFC 6238** (códigos de 6 dígitos que cambian cada 30 s). Todo lo maneja **Supabase Auth MFA** a través de su API:

`enroll`, `challenge`, `verify`, `unenroll`, `listFactors`, `getAuthenticatorAssuranceLevel`.

La inscripción devuelve una URI `otpauth://` y el secreto; el QR se dibuja con el componente `<QRCode>` de Ant Design (ver [`components/auth/mfa-enrollment.tsx`](../components/auth/mfa-enrollment.tsx)). El secreto TOTP vive en `auth.mfa_factors` (de Supabase), nunca en cookies ni en nuestra base de datos.

### 8.2 Inscripción (`/security`)

1. `mfa.enroll({ factorType: "totp" })` → `factorId`, `uri`, `secret`.
2. Se muestra el QR (`otpauth://...`) para escanear.
3. `mfa.challenge({ factorId })` → `challengeId`.
4. `mfa.verify({ factorId, challengeId, code })` con el código de 6 dígitos.
5. Se genera un **código de recuperación** (`createToken(9)`), se guarda **solo su hash SHA-256** en `profiles.totp_recovery_code_hash` y se muestra una única vez.

### 8.3 Desafío en cada login (`/login/mfa`)

1. `mfa.listFactors()` → factor `verified`.
2. `mfa.challenge({ factorId })` → `challengeId`.
3. `mfa.verify({ factorId, challengeId, code })`.
4. Al verificar, la sesión sube de `aal1` a `aal2`.

### 8.4 Código de recuperación

- Se compara el hash del código ingresado contra `profiles.totp_recovery_code_hash`.
- Si coincide, se des-inscriben **todos** los factores TOTP (`unenroll`) y se resetean las columnas → la cuenta vuelve a solo-contraseña (el código es de **un solo uso**).
- Ver [`components/auth/mfa-challenge-form.tsx`](../components/auth/mfa-challenge-form.tsx).

### 8.5 AAL (nivel de garantía)

`getMfaState()` centraliza la lógica en [`lib/auth/mfa.ts`](../lib/auth/mfa.ts):

| Estado | Significado |
|---|---|
| `aal1` | Sesión con solo contraseña. |
| `aal2` | Contraseña + segundo factor ya verificado. |
| `needsChallenge` | Tiene factor verificado pero la sesión sigue en `aal1` → debe completar el desafío. |

Middleware y `requireUser` usan **la misma función**, así ambas capas aplican la misma regla.

---

## 9. Roles (RBAC)

Tres roles por workspace: `owner`, `editor`, `viewer` (enum `workspace_role` en Postgres, guardado en `memberships`).

Las funciones de conveniencia en [`lib/rbac/permissions.ts`](../lib/rbac/permissions.ts) (`canManageContent`, `canManageMembership`, etc.) solo controlan la **interfaz** (mostrar/ocultar botones). La autorización real está en RLS.

| Acción | owner | editor | viewer |
|---|---|---|---|
| Ver contenido | ✅ | ✅ | ✅ |
| Crear/editar contenido | ✅ | ✅ | ❌ |
| Gestionar miembros / invitaciones | ✅ | ❌ | ❌ |
| Ubicación / eliminar workspace | ✅ | ❌ | ❌ |

---

## 10. RLS (Row-Level Security)

La seguridad real vive en Postgres, no en el código de la app.

- RLS está **activada en todas las tablas**.
- La lógica de roles se centraliza en funciones `security definer`: `active_role()`, `can_read_workspace()`, `can_edit_workspace_content()`, `can_manage_workspace()` — ver [`supabase/migrations/0001_initial.sql:147`](../supabase/migrations/0001_initial.sql#L147).
- Cada política llama a una de esas funciones usando `auth.uid()`.
- **Excepciones puntuales**: `create_workspace()` y `accept_invitation()` son RPC `security definer` que sortean RLS solo para la creación atómica de un workspace/membresía cuando el usuario aún no es miembro — ver [`supabase/migrations/0003_workspace_invite_rpc.sql`](../supabase/migrations/0003_workspace_invite_rpc.sql).

**Resultado práctico:** las rutas no escriben `if (role !== 'owner') ...`; simplemente ejecutan la consulta y, si RLS la rechaza, traducen el error a `403 FORBIDDEN`.

---

## 11. Tipo de API y protocolos

### 11.1 API propia

- **RESTful** sobre **HTTP/HTTPS**, con `Next.js Route Handlers` en `app/api/**/route.ts`.
- Métodos: `GET`, `POST`, `PATCH`, `DELETE` (los `DELETE` archivan, no borran físicamente: escriben `archived_at`).
- Cuerpo y respuestas en **JSON** (excepto `204 No Content` para logout/archivados).
- **No expone endpoints REST de login/register**: eso ocurre en el cliente con Supabase Auth.
- Autenticación por **cookie de sesión**, no por `Authorization` header.
- Un solo endpoint recibe datos por **query param**: `GET /api/geocode?query=...` (y `redirectTo` en páginas).

### 11.2 APIs externas que consumimos

| API | URL | Auth | Para qué |
|---|---|---|---|
| Supabase (PostgREST + Auth) | `NEXT_PUBLIC_SUPABASE_URL` | Publishable key | Base de datos y autenticación. |
| Open-Meteo Forecast | `https://api.open-meteo.com/v1/forecast` | Ninguna | Clima por lat/long. |
| Open-Meteo Geocoding | `https://geocoding-api.open-meteo.com/v1/search` | Ninguna | Búsqueda de lugares. |

Ambas APIs de Open-Meteo se consumen **desde el servidor** (`lib/weather/*`) y están protegidas contra fallo: si fallan, `getWorkspaceContext()` devuelve `status: "unavailable"` en vez de romper la app.

---

## 12. Cómo se ve en una URL

```text
# Página de login
/login
/register

# Desafío TOTP tras login (con destino de retorno)
/login/mfa?redirectTo=%2Fworkspaces

# Rutas privadas (protegidas por middleware)
/workspaces
/workspaces/{workspaceId}
/boards/{boardId}
/security

# Aceptar invitación (token en la ruta)
/invitations/{token}

# API privada (autenticada por cookie)
GET  /api/workspaces
POST /api/workspaces/{workspaceId}/boards
PATCH /api/cards/{cardId}

# API con query param
GET /api/geocode?query=medellin

# API pública (sin sesión)
GET /api/health/supabase
```

---

## 13. Referencia rápida

| Tema | Dónde | Mecanismo |
|---|---|---|
| Registro / login / logout | Supabase Auth SDK | `signUp`, `signInWithPassword`, `signOut` |
| Sesión | Cookies httpOnly `sb-...-auth-token` | `@supabase/ssr` |
| Identidad | JWT en cookie | `auth.uid()` / `auth.jwt()` en Postgres |
| Protección de páginas | [`middleware.ts`](../middleware.ts) | Redirecciones + `getMfaState()` |
| Protección de API | [`lib/auth/require-user.ts`](../lib/auth/require-user.ts) | `getUser()` + `getMfaState()` |
| TOTP | Supabase Auth MFA | `enroll` / `challenge` / `verify` / `unenroll` |
| Código de recuperación | [`lib/auth/tokens.ts`](../lib/auth/tokens.ts) | `createToken` (base64url) + `hashToken` (SHA-256) |
| Roles | [`lib/rbac/permissions.ts`](../lib/rbac/permissions.ts) | owner / editor / viewer |
| Autorización real | RLS en Postgres | Políticas + funciones `security definer` |
| Errores | [`lib/api/errors.ts`](../lib/api/errors.ts) | `{ error: { code, message, details } }` |
