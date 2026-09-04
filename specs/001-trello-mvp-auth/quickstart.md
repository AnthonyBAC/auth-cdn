# Quickstart: Trello MVP Auth Validation

## Purpose

Use this guide to validate the MVP end-to-end after implementation. It focuses on user-visible behavior and contract compliance, not implementation internals.

## Prerequisites

- Node.js LTS installed
- PostgreSQL available locally or through a managed development database
- Weather/time provider credentials configured if the selected provider requires them
- Environment variables defined for database, session, and context-provider settings

## Setup

From the repository root:

```bash
npm install
npm run db:migrate
npm run dev
```

Expected result: the web app starts locally and can connect to the configured PostgreSQL database.

## Automated Validation

Run the test suite:

```bash
npm run test
npm run test:e2e
```

Expected result: unit, integration, and browser tests pass for authentication, RBAC, board persistence, and time/weather fallback behavior.

## Scenario 1: Register and Reach First Workspace

1. Open the local app in a browser.
2. Register with a new email, password, and display name.
3. Confirm the user is signed in automatically.
4. Confirm a first personal workspace was created automatically without administrative setup.

Expected result: the new user reaches a private personal workspace they own and no other user's private data is visible.

## Scenario 2: Sign Out and Sign Back In

1. Sign out from the account navigation.
2. Attempt to open the workspace URL directly.
3. Sign in again with the same credentials.
4. Reopen the workspace.

Expected result: signed-out access redirects or prompts for sign-in before content is shown; signing back in restores authorized workspace access.

## Scenario 3: Manage Board, Lists, and Cards

1. Create a board named `MVP Roadmap`.
2. Add three lists: `Todo`, `Doing`, and `Done`.
3. Create three cards across the lists.
4. Edit one card title and description.
5. Move one card between lists.
6. Leave the board and reopen it.

Expected result: board, list, card, edit, and move state persists after navigation.

## Scenario 4: Owner, Editor, and Viewer Permissions

1. As an owner, invite one collaborator as `editor` and one as `viewer`.
2. Sign in as the editor and create or edit a board/list/card.
3. As the editor, attempt to change another user's role.
4. Sign in as the viewer and open the same board.
5. As the viewer, attempt to create, edit, move, archive, or delete a card.

Expected result: editor content changes succeed; editor membership changes are blocked with a clear permission message; viewer reads succeed and all mutations are blocked with a clear permission message.

## Scenario 5: Direct URL and Request Protection

1. Sign out and request a private workspace or board URL.
2. Sign in as a user without membership in that workspace.
3. Request the private workspace, board, list, card, or membership endpoint directly.

Expected result: signed-out requests do not expose private data; unauthorized signed-in requests return a blocked or hidden response according to the API contract.

## Scenario 6: Workspace Location, Time, and Weather

1. As workspace owner, set a location with name, latitude, longitude, and timezone.
2. As an editor or viewer, attempt to update the same workspace location.
3. Open the workspace board view.
4. Confirm local time and weather context appears near the workspace without interrupting board use.
5. Disable or invalidate the weather provider configuration in the development environment.
6. Reload the workspace.

Expected result: owner location updates succeed; editor and viewer location updates are blocked; available context appears within the configured target window when the provider works; provider failure shows a non-blocking unavailable message and the board remains usable.

## Scenario 7: Concurrent Card Edits

1. Open the same card as two authorized users or in two browser sessions.
2. Make two close-together edits to the card title or description.
3. Refresh the board.

Expected result: the board shows a single consistent latest card state and does not create duplicate cards.

## Reference Artifacts

- Data model: [data-model.md](./data-model.md)
- API contract: [contracts/api.md](./contracts/api.md)
- Feature specification: [spec.md](./spec.md)
