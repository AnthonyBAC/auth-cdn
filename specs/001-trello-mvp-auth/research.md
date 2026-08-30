# Phase 0 Research: Trello MVP Auth

## Language and Runtime

**Decision**: Use TypeScript on Node.js LTS.

**Rationale**: TypeScript provides one typed language across UI, route handlers, validation, RBAC rules, and tests. It is a pragmatic fit for a full-stack Trello-style web MVP and keeps permission-sensitive request/response shapes explicit.

**Alternatives considered**: Python/FastAPI was viable for an API-first backend but would require a separate frontend stack. Go was rejected for MVP speed because UI integration and ecosystem ergonomics are less direct for this product.

## Application Framework

**Decision**: Use Next.js App Router as the full-stack web framework.

**Rationale**: Next.js supports authenticated app routes, API handlers, server rendering, form workflows, and Vercel-compatible deployment with minimal setup. It avoids splitting the MVP into separate frontend and backend projects before team or scale demands it.

**Alternatives considered**: Remix was considered for web-form ergonomics; SvelteKit was considered for a lighter UI stack; separate React plus API services were rejected as unnecessary initial complexity.

## Storage and ORM

**Decision**: Use PostgreSQL with Drizzle ORM and migrations.

**Rationale**: The domain is relational: users belong to workspaces through memberships, boards contain ordered lists, cards belong to lists, and roles/invitations require consistent authorization lookups. Drizzle keeps SQL and migrations explicit while providing TypeScript type safety.

**Alternatives considered**: Prisma was considered for onboarding and tooling but adds more abstraction than needed. MongoDB was rejected because role, membership, and ordering relationships benefit from relational constraints. File storage was rejected because persistence and collaboration are MVP requirements.

## Authentication and Sessions

**Decision**: Use server-side email/password authentication with database-backed sessions stored in secure HTTP-only cookies.

**Rationale**: The MVP requires sign-up, automatic personal workspace creation, sign-in, sign-out, private data protection, and role checks. Server-side sessions support revocation and ensure workspace roles are looked up from current database state rather than trusted from client-provided data or stale JWT claims.

**Alternatives considered**: Hosted providers such as Clerk/Auth0 were considered for fastest setup but add external product dependency. OAuth-first Auth.js was considered but social login is not required by the spec. QR-based sign-in is explicitly deferred.

## Authorization Model

**Decision**: Enforce workspace-scoped `owner`, `editor`, and `viewer` roles on the server for every private read and mutation.

**Rationale**: The spec defines workspace roles and requires direct URL/repeated request attempts to be blocked consistently. Workspace-level roles are sufficient for MVP and avoid board-specific permission complexity.

**Alternatives considered**: Board-level permissions were rejected for MVP scope. Client-only role checks were rejected because they cannot protect API routes. Extra roles such as admin/member were rejected because they conflict with the feature specification.

## Board Ordering and Concurrency

**Decision**: Store ordered boards, lists, and cards with numeric `position` fields and server-side move commands.

**Rationale**: Position fields support create, reorder, and move operations without rewriting entire arrays on each change. Server-side move validation ensures source and destination resources belong to authorized workspaces and supports consistent latest-state behavior for close edits.

**Alternatives considered**: Array indexes were rejected because concurrent changes create frequent conflicts and large rewrites. Real-time CRDTs were rejected as unnecessary for the MVP.

## Time and Weather Context

**Decision**: Store workspace location context and fetch current time/weather through server-proxied provider calls with short-lived cache and fallback UI.

**Rationale**: The spec requires board management to remain usable when context data is unavailable. Server proxying avoids exposing provider secrets, allows validation, and centralizes timeout/fallback behavior.

**Alternatives considered**: Direct browser calls were rejected because they expose integration details and make fallback behavior harder to control. Persisting weather snapshots as authoritative data was rejected because weather is contextual, not core board state.

## Testing Strategy

**Decision**: Use Vitest for unit/domain tests, React Testing Library for component behavior, and Playwright for end-to-end flows.

**Rationale**: RBAC and validation logic need fast unit coverage, UI affordances need component-level coverage, and critical flows require browser-level validation: registration with automatic workspace creation, sign-in, board CRUD, role restriction messages, owner-only location updates, and weather fallback.

**Alternatives considered**: Jest is viable but Vitest fits modern TypeScript projects with fast startup. Cypress is viable, but Playwright provides broad browser automation and good auth setup control.

## Deployment Target

**Decision**: Target a Vercel-compatible Node deployment with managed PostgreSQL such as Neon, Supabase, or Railway.

**Rationale**: This minimizes operational overhead for an MVP and supports preview deployments, environment variables, and managed database backups.

**Alternatives considered**: Fly.io/Railway app hosting and cloud provider services are viable later. A self-managed VPS was rejected for the MVP because operations are not a product differentiator.

## MVP Scale and Scope

**Decision**: Optimize for small-team use without real-time collaboration, offline sync, comments, attachments, labels, notifications, calendar views, automation, billing, public boards, mobile apps, or QR sign-in.

**Rationale**: The feature specification emphasizes authentication, privacy, board management, role-based collaboration, and time/weather context. Deferring advanced collaboration and project-management features keeps the first release independently testable and deliverable.

**Alternatives considered**: Adding real-time multiplayer or richer Trello parity was rejected because it would increase complexity without being required for the MVP acceptance criteria.
