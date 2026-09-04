# Implementation Plan: Trello MVP Auth

**Branch**: `001-trello-mvp-auth` | **Date**: 2026-08-30 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-trello-mvp-auth/spec.md`

## Summary

Build a simple Trello-style web MVP where registration automatically creates a personal workspace, authenticated users can access private workspaces, collaborators use owner/editor/viewer roles, and workspace members can view non-blocking time/weather context set by owners. The implementation will use a full-stack TypeScript Next.js application backed by PostgreSQL, with server-enforced authentication, workspace-scoped RBAC, persistent ordering, and external weather/time calls proxied through server routes.

## Technical Context

**Language/Version**: TypeScript on Node.js LTS

**Primary Dependencies**: Next.js App Router, React, Drizzle ORM, PostgreSQL driver, server-side session/auth utilities, Zod for request validation

**Storage**: PostgreSQL with Drizzle migrations for users, sessions, workspaces, memberships, boards, lists, cards, invitations, and cached context metadata

**Testing**: Vitest for unit/domain tests, React Testing Library for component behavior, Playwright for end-to-end auth/board/RBAC flows

**Target Platform**: Web application deployed to Vercel-compatible Node runtime with managed PostgreSQL

**Project Type**: Full-stack web application

**Performance Goals**: Account creation to first workspace under 2 minutes for 90% of first-time users; board/list/card workflow under 5 minutes for 90% of signed-in users; time/weather context visible within 5 seconds for 90% of workspace loads when providers are available

**Constraints**: Server-side authorization for every private resource and mutation; core board workflows remain usable when weather/time providers fail or time out; QR sign-in excluded from MVP; no real-time collaboration dependency in the first release

**Scale/Scope**: MVP for small teams with personal workspaces and invited collaboration, supporting hundreds of cards per board and dozens of active users per workspace before real-time sync, advanced search, comments, attachments, labels, automation, billing, public boards, or mobile apps are considered

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Current constitution content is still the generated placeholder and does not define enforceable principles, constraints, or quality gates. Planning therefore applies the feature specification and explicit MVP constraints as the operative gates.

**Gate Status**: PASS

**Applied Checks**:

- Authentication and authorization are required before any private workspace, board, list, card, membership, or role data is exposed.
- Successful registration automatically creates a personal workspace for the new user.
- Role behavior remains limited to the spec-defined `owner`, `editor`, and `viewer` roles.
- Only owners can update workspace location context.
- Time/weather context is non-blocking and cannot prevent board usage.
- QR-based sign-in remains out of MVP scope.
- No unresolved clarification markers remain after Phase 0 research.

## Project Structure

### Documentation (this feature)

```text
specs/001-trello-mvp-auth/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── api.md
└── tasks.md
```

### Source Code (repository root)

```text
app/
├── (auth)/
│   ├── login/
│   └── register/
├── (workspace)/
│   ├── workspaces/
│   └── boards/[boardId]/
├── api/
│   ├── auth/
│   ├── workspaces/
│   ├── boards/
│   ├── lists/
│   ├── cards/
│   └── context/
└── layout.tsx

components/
├── auth/
├── board/
├── workspace/
└── context/

db/
├── schema.ts
└── migrations/

lib/
├── auth/
├── db/
├── rbac/
├── validation/
└── weather/

tests/
├── unit/
├── integration/
└── e2e/
```

**Structure Decision**: Use a single full-stack Next.js application. App routes render auth, workspace, and board experiences; API routes/server functions enforce auth, validation, persistence, RBAC, and context-provider proxying. Domain utilities live under `lib/`, database schema and migrations under `db/`, and tests are split by unit, integration, and end-to-end coverage.

## Complexity Tracking

No constitution violations or justified complexity exceptions are currently identified.

## Post-Design Constitution Check

**Gate Status**: PASS

Phase 1 design artifacts preserve the MVP boundaries: automatic personal workspace creation during registration, server-side private resource protection, spec-defined workspace roles, owner-only workspace location updates, persistent board/list/card state, non-blocking time/weather context, and deferred QR sign-in. The placeholder constitution still provides no additional gates.
