# Cómo implementamos la seguridad en Auth DCN

Este documento explica, para cada uno de estos 5 temas, **qué es** y **cómo lo implementamos** en el proyecto: RBAC, autenticación con Supabase Auth, `mfa_factors`, TOTP y RLS.

---

## 1. RBAC — Control de acceso basado en roles

**Qué es:** un modelo de seguridad donde cada usuario tiene un *rol* (un conjunto de permisos predefinido), en vez de asignarle permisos uno por uno.

**Cómo lo implementamos:**
- Definimos 3 roles por workspace: `owner`, `editor`, `viewer` (un `enum` en la base de datos).
- El rol de cada usuario en cada workspace se guarda en la tabla `memberships` (una fila por combinación de usuario + workspace).
- En el frontend, un archivo (`lib/rbac/permissions.ts`) define funciones simples como `canManageContent(role)` o `canManageMembership(role)`, que la interfaz usa para mostrar u ocultar botones según el rol del usuario.

**Punto clave:** este archivo del frontend **no es la seguridad real**, es solo para la experiencia de usuario (ocultar botones que no le servirían). La autorización de verdad se aplica en la base de datos con RLS (tema 5). Así, aunque alguien manipulara la interfaz, la base de datos igual rechazaría la operación.

---

## 2. Supabase Auth — Autenticación de usuarios

**Qué es:** el servicio de autenticación de Supabase (basado en GoTrue), que maneja registro, login y sesiones sin que nosotros tengamos que implementar nuestro propio sistema de contraseñas.

**Cómo lo implementamos:**
- No creamos rutas propias de login/registro. El cliente llama directamente a los métodos del SDK: `supabase.auth.signUp(...)` y `supabase.auth.signInWithPassword(...)`.
- La sesión queda guardada en **cookies httpOnly** (vía `@supabase/ssr`), no en `localStorage`, lo que la protege de ataques XSS.
- Creamos una función central, `requireUser()`, que **todas** las rutas de nuestra API llaman primero: obtiene el usuario autenticado desde la cookie y entrega un cliente de Supabase ya identificado como ese usuario (nunca usamos una clave de administrador).
- Al registrarse, un **trigger de base de datos** (`handle_new_user()`) crea automáticamente el perfil del usuario y su primer workspace, con rol `owner`, en una sola transacción.

---

## 3. `mfa_factors` — Dónde Supabase guarda el segundo factor

**Qué es:** una tabla interna de Supabase Auth (`auth.mfa_factors`) donde el propio Supabase guarda los factores de autenticación multifactor de cada usuario: su tipo, si está verificado, y el secreto correspondiente.

**Cómo lo usamos:**
- No la tocamos directamente (no está en nuestras migraciones, no le hacemos consultas SQL). Solo la usamos a través de los métodos del SDK: `enroll`, `challenge`, `verify`, `unenroll`, `listFactors`, `getAuthenticatorAssuranceLevel`.
- Con esos métodos calculamos el **AAL** (Authenticator Assurance Level) de la sesión: `aal1` (solo contraseña) o `aal2` (contraseña + segundo factor ya verificado en esta sesión).
- Esta lógica está centralizada en una sola función, `getMfaState()`, que usamos tanto en el middleware de páginas como en `requireUser()`, para que ambos apliquen exactamente la misma regla.

---

## 4. TOTP — Verificación en dos pasos

**Qué es:** el segundo factor que implementamos: códigos de 6 dígitos que cambian cada cierto tiempo, generados con una app autenticadora (RFC 6238), el mismo estándar que usan Google Authenticator, Microsoft Authenticator, etc.

**Cómo implementamos la inscripción:**
1. `mfa.enroll({ factorType: "totp" })` crea el factor y devuelve una URI `otpauth://` y el secreto.
2. Mostramos esa URI como código QR para que el usuario lo escanee con su app.
3. El usuario ingresa el código de 6 dígitos → llamamos `mfa.challenge()` y luego `mfa.verify()` para confirmarlo.
4. Si es correcto, generamos **en el cliente** un código de recuperación aleatorio, guardamos solo su **hash SHA-256** en nuestra tabla `profiles` (`totp_recovery_code_hash`), y lo mostramos al usuario una única vez. El código en texto plano nunca se guarda en ningún lado.

**Cómo implementamos el login con 2FA activo:** buscamos el factor verificado con `listFactors()`, y encadenamos `challenge()` + `verify()` con el código que el usuario ingresa. Al validarse, la sesión sube de `aal1` a `aal2`.

**Cómo implementamos la recuperación:** si el usuario perdió su dispositivo, ingresa su código de recuperación; lo hasheamos y lo comparamos contra lo guardado en `profiles`. Si coincide, desactivamos **todos** sus factores TOTP (por eso es de un solo uso) y reseteamos las columnas de `profiles`.

**Dónde se aplica la restricción:** tanto `middleware.ts` (para páginas) como `requireUser()` (para la API) llaman a `getMfaState()` y bloquean el acceso si falta completar el desafío.

---

## 5. RLS — Row-Level Security en Supabase

**Qué es:** una funcionalidad de Postgres que permite definir, por tabla, qué filas puede leer o escribir cada usuario, aplicada **dentro de la base de datos**, sin importar qué código llame a la consulta.

**Cómo lo implementamos:**
- Activamos RLS en todas nuestras tablas.
- Centralizamos la lógica de roles en 3 funciones SQL `security definer`: `active_role()`, `can_read_workspace()`, `can_edit_workspace_content()`, `can_manage_workspace()`. Todas las políticas de todas las tablas llaman a una de estas tres, en vez de repetir la lógica en cada política.
- Estas funciones usan `auth.uid()`, que Postgres obtiene automáticamente del JWT de la sesión (el mismo que valida Supabase Auth), así RLS sabe quién está preguntando sin que nuestra API tenga que pasarle ningún id manualmente.

**Un problema que tuvimos que resolver:** crear un workspace, o aceptar una invitación, exige insertar la membresía del propio usuario en un instante en que **todavía no es miembro** de ese workspace. Las políticas normales bloqueaban esto (el usuario no podía darse a sí mismo el primer permiso). Lo resolvimos con dos funciones `security definer` (`create_workspace()` y `accept_invitation()`) que hacen esa operación completa de forma atómica, sorteando la RLS **solo para ese caso puntual**, en vez de debilitar las políticas generales.

**Resultado práctico:** nuestras rutas de API nunca escriben `if (role !== 'owner') return error`. Simplemente intentan la consulta; si RLS la rechaza, Postgres devuelve un error que traducimos a `403 Forbidden`. La seguridad real vive en la base de datos, no en el código de la aplicación.

---

## Cómo se relacionan entre sí

**Supabase Auth** (2) identifica al usuario y le da una sesión. Esa sesión es la que **RLS** (5) usa, a través de `auth.uid()`, para decidir qué puede tocar. **`mfa_factors`** (3) es donde vive el estado del segundo factor, y **TOTP** (4) es el mecanismo concreto que implementamos sobre esa base. **RBAC** (1) es el vocabulario de roles que usamos en toda la aplicación, pero es RLS quien realmente lo hace cumplir.
