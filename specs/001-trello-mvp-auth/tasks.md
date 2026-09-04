---
description: "Implementation tasks for Trello MVP Auth"
---

# Tasks: Trello MVP Auth

**Input**: Design documents from `/specs/001-trello-mvp-auth/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/api.md`, `quickstart.md`

**Tests**: Included because the implementation plan requires Vitest, React Testing Library, and Playwright coverage for auth, board workflows, RBAC, persistence, and time/weather fallback behavior.

**Organization**: Tasks are grouped by user story so each story can be implemented and tested independently after shared foundation work is complete.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel because it touches different files and has no dependency on another incomplete task in the same phase
- **[Story]**: Maps to a user story from `spec.md`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Initialize the full-stack Next.js TypeScript project and baseline tooling.

- [ ] T001 Initialize the Next.js App Router TypeScript project in `package.json`
- [ ] T002 Add TypeScript, Next.js, React, Drizzle, PostgreSQL, Zod, Vitest, React Testing Library, and Playwright dependencies in `package.json`
- [ ] T003 [P] Configure TypeScript compiler options in `tsconfig.json`
- [ ] T004 [P] Configure Next.js runtime settings in `next.config.ts`
- [ ] T005 [P] Configure ESLint for TypeScript and Next.js in `eslint.config.mjs`
- [ ] T006 [P] Configure Vitest and jsdom test setup in `vitest.config.ts`
- [ ] T007 [P] Configure Playwright browser tests in `playwright.config.ts`
- [ ] T008 [P] Create environment variable example file in `.env.example`
- [ ] T009 Create base app shell and navigation slots in `app/layout.tsx`
- [ ] T010 Create initial landing redirect page in `app/page.tsx`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Build shared persistence, validation, auth, RBAC, and API conventions required by every story.

**Critical**: No user story implementation should begin until this phase is complete.

- [ ] T011 Define Drizzle database connection and query client in `lib/db/client.ts`
- [ ] T012 Define users, sessions, workspaces, memberships, invitations, boards, lists, cards, card assignees, and context snapshots schema in `db/schema.ts`
- [ ] T013 Create initial Drizzle migration for all MVP tables and constraints in `db/migrations/0001_initial.sql`
- [ ] T014 Configure migration scripts and Drizzle settings in `drizzle.config.ts`
- [ ] T015 Implement shared environment validation with Zod in `lib/env.ts`
- [ ] T016 Implement shared API error helpers and response shape in `lib/api/errors.ts`
- [ ] T017 Implement shared request body validation helper in `lib/validation/request.ts`
- [ ] T018 Implement password hashing and verification utilities in `lib/auth/password.ts`
- [ ] T019 Implement secure token generation and hashing utilities in `lib/auth/tokens.ts`
- [ ] T020 Implement session cookie creation, lookup, revocation, and current-user loading in `lib/auth/session.ts`
- [ ] T021 Implement route protection helper for authenticated API routes in `lib/auth/require-user.ts`
- [ ] T022 Implement workspace membership lookup and role permissions in `lib/rbac/permissions.ts`
- [ ] T023 Implement resource-to-workspace authorization helpers for boards, lists, and cards in `lib/rbac/resources.ts`
- [ ] T024 [P] Add reusable auth validation schemas in `lib/validation/auth.ts`
- [ ] T025 [P] Add reusable workspace, board, list, card, member, and context validation schemas in `lib/validation/domain.ts`
- [ ] T026 [P] Add shared UI primitives for forms, errors, and buttons in `components/ui/primitives.tsx`
- [ ] T027 [P] Add global responsive styles and design token variables in `app/globals.css`
- [ ] T028 Add root middleware or route guards for private app routes in `middleware.ts`

**Checkpoint**: Database, auth/session primitives, role checks, validation, errors, and app shell are ready.

---

## Phase 3: User Story 1 - Sign in and access a workspace (Priority: P1)

**Goal**: A visitor can register, get a personal workspace automatically, sign out, sign back in, and access only authorized private data.

**Independent Test**: Register a new user, confirm a personal workspace exists, sign out, verify private routes require sign-in, sign back in, and confirm only that user's workspace data appears.

### Tests for User Story 1

- [ ] T029 [P] [US1] Add unit tests for password, token, and session behavior in `tests/unit/auth/session.test.ts`
- [ ] T030 [P] [US1] Add integration tests for register, login, logout, current session, and private workspace protection in `tests/integration/auth-workspace.test.ts`
- [ ] T031 [P] [US1] Add Playwright registration and sign-in journey in `tests/e2e/auth-workspace.spec.ts`

### Implementation for User Story 1

- [ ] T032 [US1] Implement registration service with user creation, session creation, and automatic owned personal workspace creation in `lib/auth/register.ts`
- [ ] T033 [US1] Implement login and logout services in `lib/auth/login.ts`
- [ ] T034 [US1] Implement `POST /api/auth/register` route in `app/api/auth/register/route.ts`
- [ ] T035 [US1] Implement `POST /api/auth/login` route in `app/api/auth/login/route.ts`
- [ ] T036 [US1] Implement `POST /api/auth/logout` route in `app/api/auth/logout/route.ts`
- [ ] T037 [US1] Implement `GET /api/auth/session` route in `app/api/auth/session/route.ts`
- [ ] T038 [US1] Implement workspace service for list, create, and detail queries in `lib/workspace/workspaces.ts`
- [ ] T039 [US1] Implement `GET /api/workspaces` and `POST /api/workspaces` routes in `app/api/workspaces/route.ts`
- [ ] T040 [US1] Implement `GET /api/workspaces/{workspaceId}` route in `app/api/workspaces/[workspaceId]/route.ts`
- [ ] T041 [US1] Implement login page and form in `app/(auth)/login/page.tsx`
- [ ] T042 [US1] Implement registration page and form in `app/(auth)/register/page.tsx`
- [ ] T043 [US1] Implement authenticated workspace list page with sign-out affordance in `app/(workspace)/workspaces/page.tsx`
- [ ] T044 [US1] Add auth form components and validation messages in `components/auth/auth-forms.tsx`

**Checkpoint**: User Story 1 is functional and testable independently.

---

## Phase 4: User Story 2 - Manage boards, lists, and cards (Priority: P1)

**Goal**: A signed-in workspace member with edit permission can create boards, organize lists, create/edit/move/archive cards, and see persisted board state after returning.

**Independent Test**: Create a board with three lists and three cards, edit a card, move a card, leave and reopen the board, and confirm the state persists.

### Tests for User Story 2

- [ ] T045 [P] [US2] Add unit tests for board/list/card validation and move rules in `tests/unit/board/board-rules.test.ts`
- [ ] T046 [P] [US2] Add integration tests for board, list, and card API persistence in `tests/integration/board-crud.test.ts`
- [ ] T047 [P] [US2] Add Playwright board management journey in `tests/e2e/board-management.spec.ts`

### Implementation for User Story 2

- [ ] T048 [US2] Implement board service for list, create, update, reorder, archive, and detail queries in `lib/board/boards.ts`
- [ ] T049 [US2] Implement list service for create, rename, reorder, and archive operations in `lib/board/lists.ts`
- [ ] T050 [US2] Implement card service for create, view, edit, move, assign, and archive operations in `lib/board/cards.ts`
- [ ] T051 [US2] Implement `POST /api/workspaces/{workspaceId}/boards` and `GET /api/workspaces/{workspaceId}/boards` routes in `app/api/workspaces/[workspaceId]/boards/route.ts`
- [ ] T052 [US2] Implement `GET /api/boards/{boardId}`, `PATCH /api/boards/{boardId}`, and `DELETE /api/boards/{boardId}` routes in `app/api/boards/[boardId]/route.ts`
- [ ] T053 [US2] Implement `POST /api/boards/{boardId}/lists` route in `app/api/boards/[boardId]/lists/route.ts`
- [ ] T054 [US2] Implement `PATCH /api/lists/{listId}` and `DELETE /api/lists/{listId}` routes in `app/api/lists/[listId]/route.ts`
- [ ] T055 [US2] Implement `POST /api/lists/{listId}/cards` route in `app/api/lists/[listId]/cards/route.ts`
- [ ] T056 [US2] Implement `PATCH /api/cards/{cardId}` and `DELETE /api/cards/{cardId}` routes in `app/api/cards/[cardId]/route.ts`
- [ ] T057 [US2] Implement `POST /api/cards/{cardId}/move` route in `app/api/cards/[cardId]/move/route.ts`
- [ ] T058 [US2] Implement workspace board list UI and board creation form in `components/workspace/board-list.tsx`
- [ ] T059 [US2] Implement board page data loading in `app/(workspace)/boards/[boardId]/page.tsx`
- [ ] T060 [US2] Implement board, list, and card interactive components in `components/board/board-view.tsx`

**Checkpoint**: User Story 2 is functional and testable independently with persisted board state.

---

## Phase 5: User Story 3 - Control access with roles (Priority: P2)

**Goal**: A workspace owner can invite collaborators and manage roles while editors and viewers are restricted according to the authorization matrix.

**Independent Test**: Use owner, editor, and viewer accounts to verify owner-only membership management, editor content editing, viewer read-only access, and clear permission messages for blocked actions.

### Tests for User Story 3

- [ ] T061 [P] [US3] Add unit tests for owner/editor/viewer permission matrix in `tests/unit/rbac/permissions.test.ts`
- [ ] T062 [P] [US3] Add integration tests for invitations, role changes, member removal, and last-owner protection in `tests/integration/memberships.test.ts`
- [ ] T063 [P] [US3] Add Playwright owner/editor/viewer permission journey in `tests/e2e/rbac.spec.ts`

### Implementation for User Story 3

- [ ] T064 [US3] Implement invitation creation, token hashing, acceptance, and expiration behavior in `lib/workspace/invitations.ts`
- [ ] T065 [US3] Implement membership listing, role changes, removal, and last-owner protection in `lib/workspace/memberships.ts`
- [ ] T066 [US3] Implement `GET /api/workspaces/{workspaceId}/members` route in `app/api/workspaces/[workspaceId]/members/route.ts`
- [ ] T067 [US3] Implement `POST /api/workspaces/{workspaceId}/invitations` route in `app/api/workspaces/[workspaceId]/invitations/route.ts`
- [ ] T068 [US3] Implement `POST /api/invitations/{token}/accept` route in `app/api/invitations/[token]/accept/route.ts`
- [ ] T069 [US3] Implement `PATCH /api/workspaces/{workspaceId}/members/{userId}` and `DELETE /api/workspaces/{workspaceId}/members/{userId}` routes in `app/api/workspaces/[workspaceId]/members/[userId]/route.ts`
- [ ] T070 [US3] Implement workspace settings page with member list, invite form, role selector, and removal controls in `app/(workspace)/workspaces/[workspaceId]/settings/page.tsx`
- [ ] T071 [US3] Add permission-aware disabled controls and clear blocked-action messages in `components/workspace/member-management.tsx`

**Checkpoint**: User Story 3 is functional and testable independently against the role matrix.

---

## Phase 6: User Story 4 - View time and weather context (Priority: P3)

**Goal**: Workspace members can see non-blocking current time/weather context for an owner-configured workspace location.

**Independent Test**: Owner sets a workspace location, editor/viewer location updates are blocked, context appears when provider data is available, and unavailable provider data shows a fallback while boards remain usable.

### Tests for User Story 4

- [ ] T072 [P] [US4] Add unit tests for location validation, timezone handling, cache status, and provider fallback in `tests/unit/context/context.test.ts`
- [ ] T073 [P] [US4] Add integration tests for owner-only location updates and context fallback responses in `tests/integration/workspace-context.test.ts`
- [ ] T074 [P] [US4] Add Playwright location and weather fallback journey in `tests/e2e/workspace-context.spec.ts`

### Implementation for User Story 4

- [ ] T075 [US4] Implement workspace location update service with owner-only authorization in `lib/workspace/location.ts`
- [ ] T076 [US4] Implement weather/time provider client with timeout and safe fallback handling in `lib/weather/provider.ts`
- [ ] T077 [US4] Implement context snapshot cache lookup and refresh behavior in `lib/weather/context.ts`
- [ ] T078 [US4] Implement `PATCH /api/workspaces/{workspaceId}/location` route in `app/api/workspaces/[workspaceId]/location/route.ts`
- [ ] T079 [US4] Implement `GET /api/workspaces/{workspaceId}/context` route in `app/api/workspaces/[workspaceId]/context/route.ts`
- [ ] T080 [US4] Add owner-only location form to workspace settings in `components/context/location-settings.tsx`
- [ ] T081 [US4] Add non-blocking time/weather context panel to workspace and board pages in `components/context/context-panel.tsx`

**Checkpoint**: User Story 4 is functional and does not block core board workflows.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Final hardening, accessibility, documentation, and quickstart validation across the MVP.

- [ ] T082 [P] Add accessible labels, focus states, and keyboard navigation checks for auth and board UI in `components/board/board-view.tsx`
- [ ] T083 [P] Add responsive layout verification for mobile and desktop app routes in `app/(workspace)/boards/[boardId]/page.tsx`
- [ ] T084 Add seed or test fixture utilities for local RBAC scenarios in `tests/fixtures/seed.ts`
- [ ] T085 Add npm scripts for lint, unit tests, e2e tests, migrations, and development in `package.json`
- [ ] T086 Update project usage and environment instructions in `README.md`
- [ ] T087 Run quickstart validation steps and record any deviations in `specs/001-trello-mvp-auth/quickstart.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 Setup**: No dependencies.
- **Phase 2 Foundational**: Depends on Phase 1 and blocks all user stories.
- **Phase 3 US1**: Depends on Phase 2 and provides the MVP authentication/workspace baseline.
- **Phase 4 US2**: Depends on Phase 2, but the browser journey also benefits from US1 being complete.
- **Phase 5 US3**: Depends on Phase 2 and uses US1/US2 flows for full acceptance coverage.
- **Phase 6 US4**: Depends on Phase 2 and uses workspace settings from US3 for the complete owner/editor/viewer test path.
- **Phase 7 Polish**: Depends on the desired user stories being complete.

### User Story Dependencies

- **US1 (P1)**: Can start after Foundational; no dependency on other user stories.
- **US2 (P1)**: Can start after Foundational; independently testable through API, with UI journey easiest after US1.
- **US3 (P2)**: Can start after Foundational; complete acceptance needs authenticated users and board content.
- **US4 (P3)**: Can start after Foundational; complete acceptance needs authenticated workspace access and owner-only settings.

### Within Each User Story

- Write tests before implementation tasks for that story.
- Implement services before API routes.
- Implement API routes before UI that consumes them.
- Finish each story checkpoint before moving to the next priority if working sequentially.

---

## Parallel Opportunities

- Setup tasks T003-T008 can run in parallel after T001-T002.
- Foundational tasks T024-T027 can run in parallel with remaining shared utilities once schema and conventions are stable.
- Test tasks inside each story can run in parallel because they target separate test files.
- US1 and US2 can proceed in parallel after Phase 2 if API-level testing is used.
- Service implementation for boards, lists, and cards can be split across T048-T050 before route integration.
- RBAC tests and invitation/member services can be developed in parallel after shared permissions are available.
- Context provider/cache work can proceed in parallel with context UI once the response shape is agreed.

### Parallel Example: User Story 2

```bash
Task: "T045 Add unit tests for board/list/card validation and move rules in tests/unit/board/board-rules.test.ts"
Task: "T046 Add integration tests for board, list, and card API persistence in tests/integration/board-crud.test.ts"
Task: "T047 Add Playwright board management journey in tests/e2e/board-management.spec.ts"
Task: "T048 Implement board service for list, create, update, reorder, archive, and detail queries in lib/board/boards.ts"
Task: "T049 Implement list service for create, rename, reorder, and archive operations in lib/board/lists.ts"
Task: "T050 Implement card service for create, view, edit, move, assign, and archive operations in lib/board/cards.ts"
```

---

## Implementation Strategy

### MVP First

1. Complete Phase 1 Setup.
2. Complete Phase 2 Foundational.
3. Complete Phase 3 US1 for authentication and personal workspace access.
4. Complete Phase 4 US2 for the core Trello-style board value.
5. Stop and validate registration, sign-in, private access, and board persistence before adding collaboration.

### Incremental Delivery

1. Deliver US1 to prove private authenticated workspace access.
2. Deliver US2 to prove board/list/card task management.
3. Deliver US3 to add shared workspace collaboration and role enforcement.
4. Deliver US4 to add time/weather context without blocking board workflows.

### Validation Gates

1. Run `npm run lint` after foundational and UI changes.
2. Run `npm run test` after each story phase.
3. Run `npm run test:e2e` after US1, US2, US3, and US4 browser flows are implemented.
4. Execute `specs/001-trello-mvp-auth/quickstart.md` before considering the MVP complete.

---

## Notes

- Every private resource and mutation must perform server-side session validation and workspace-scoped RBAC.
- Registration must atomically create the user, session, personal workspace, and owner membership.
- Provider failures for time/weather must return an unavailable context without blocking board APIs or pages.
- QR sign-in is intentionally excluded from the MVP tasks.
