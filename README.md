# Auth DCN

Supabase-backed Trello-style MVP built with Next.js App Router, Ant Design, and Vercel-ready configuration.

## Features

- Supabase Auth registration and sign-in.
- Optional TOTP two-factor authentication (Supabase MFA): users enable it from `/security`, scan the QR code with an authenticator app, get a single-use recovery code, and complete a 6-digit code challenge on every sign-in.
- Automatic personal workspace creation through a Supabase trigger.
- Workspace-scoped RLS for profiles, memberships, invitations, boards, lists, cards, assignees, and context snapshots.
- Owner/editor/viewer role behavior.
- Board, list, and card CRUD with archive behavior.
- Owner-only member invitations, role changes, removals, and location settings.
- Non-blocking time/weather context via Open-Meteo fallback-safe server code.
- MVP theme tokens mapped into global CSS and Ant Design theme settings.

## Local Setup

1. Install dependencies:

```sh
pnpm install
```

2. Create `.env.local` from `.env.example` and set the Supabase project URL plus publishable/anon key.

3. Apply the migrations in `supabase/migrations/` (in order) to the Supabase project.

4. Run the app:

```sh
pnpm dev
```

5. Verify Supabase connectivity:

```sh
curl http://localhost:3000/api/health/supabase
```

You can also open `/diagnostics/supabase` in the browser. It checks whether the project URL and publishable key are configured, whether Supabase Auth responds, and whether a basic RLS-protected workspace query succeeds.

## Two-Factor Authentication (TOTP)

TOTP MFA is opt-in per user and uses Supabase Auth MFA. Make sure TOTP is enabled in the Supabase Dashboard under **Authentication → Sign In / Providers → MFA** (enabled by default), and apply `supabase/migrations/0002_profile_totp.sql` (adds `totp_enabled` and `totp_recovery_code_hash` to `profiles`).

- Enable it from `/security` (linked in the Workspaces toolbar): scan the QR code with an authenticator app and confirm with the 6-digit code it generates.
- On activation a **recovery code** is shown once; only its SHA-256 hash is stored in `profiles.totp_recovery_code_hash`. The TOTP secret itself stays in Supabase Auth (`auth.mfa_factors`) and is never stored in cookies or in the database.
- After enabling, every sign-in requires the password **plus** a 6-digit TOTP code (`/login/mfa`). Users who lose their device can sign in with the recovery code, which disables TOTP on the account (single-use).
- The session's authenticator assurance level (AAL) is enforced in `middleware.ts` for pages and in `lib/auth/require-user.ts` for API routes: an `aal1` session with a verified factor is redirected to the challenge / rejected until the code is verified (`aal2`). The session JWT remains in httpOnly cookies via `@supabase/ssr`.

## Vercel

Set these environment variables in Vercel:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `NEXT_PUBLIC_SITE_URL`
- `OPEN_METEO_TIMEOUT_MS`

Do not expose `SUPABASE_SERVICE_ROLE_KEY` to browser code. It is only listed for future server-only administrative jobs.

## Verification

```sh
pnpm test
pnpm typecheck
pnpm build
```

## Demo Users

Seed demo users with:

```sh
pnpm seed:supabase
```

The script requires `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`SEED_PASSWORD`, `SEED_OWNER_EMAIL`, `SEED_EDITOR_EMAIL`, and `SEED_VIEWER_EMAIL`.
Configure those values through local environment variables; do not commit real credentials.
