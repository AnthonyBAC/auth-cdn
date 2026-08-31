# Auth DCN

Supabase-backed Trello-style MVP built with Next.js App Router, Ant Design, and Vercel-ready configuration.

## Features

- Supabase Auth registration and sign-in.
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

3. Apply `supabase/migrations/0001_initial.sql` to the Supabase project.

4. Run the app:

```sh
pnpm dev
```

5. Verify Supabase connectivity:

```sh
curl http://localhost:3000/api/health/supabase
```

You can also open `/diagnostics/supabase` in the browser. It checks whether the project URL and publishable key are configured, whether Supabase Auth responds, and whether a basic RLS-protected workspace query succeeds.

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

The script requires `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. It creates:

- `owner@example.com`
- `editor@example.com`
- `viewer@example.com`

Default password: `Password123!`. Override it with `SEED_PASSWORD`.
