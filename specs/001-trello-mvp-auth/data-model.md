# Data Model: Trello MVP Auth

## Overview

The MVP uses a relational model centered on workspace membership. Every private board, list, card, membership, role, and location-context record is reachable only through an authenticated user's authorized workspace membership.

## Entities

### User

Represents a person who can sign in, own or collaborate in workspaces, and be assigned to cards.

**Fields**:

- `id`: opaque unique identifier
- `email`: unique normalized email address
- `name`: display name
- `passwordHash`: hashed password credential
- `createdAt`: server-generated timestamp
- `updatedAt`: server-generated timestamp

**Relationships**:

- Has many `Session` records
- Has many `Membership` records
- Can be assigned to many `Card` records through `CardAssignee`

**Validation Rules**:

- Email must be valid, normalized, and unique.
- Password must satisfy the configured minimum strength rules before hashing.
- Display name must be present for visible collaboration contexts.

### Session

Represents an authenticated browser session.

**Fields**:

- `id`: opaque unique identifier
- `userId`: owning user
- `tokenHash`: hash of the session token stored in the browser cookie
- `expiresAt`: expiration timestamp
- `createdAt`: server-generated timestamp
- `revokedAt`: nullable revocation timestamp

**Relationships**:

- Belongs to one `User`

**Validation Rules**:

- Session tokens must never be stored in plaintext.
- Expired or revoked sessions must not authorize requests.

**State Transitions**:

- `active` -> `expired` when `expiresAt` passes
- `active` -> `revoked` on sign-out or administrative invalidation

### Workspace

Represents a private collaboration area containing boards, roles, and optional location context.

**Fields**:

- `id`: opaque unique identifier
- `name`: workspace name
- `locationName`: optional human-readable location label
- `latitude`: optional decimal latitude
- `longitude`: optional decimal longitude
- `timezone`: optional IANA timezone
- `createdAt`: server-generated timestamp
- `updatedAt`: server-generated timestamp
- `archivedAt`: nullable archive timestamp

**Relationships**:

- Has many `Membership` records
- Has many `Invitation` records
- Has many `Board` records

**Validation Rules**:

- Name must be 1-100 trimmed characters.
- Latitude must be between -90 and 90 when present.
- Longitude must be between -180 and 180 when present.
- Timezone must be a valid IANA timezone when present.
- A workspace must always have at least one owner membership.
- Successful registration must create one personal workspace owned by the new user.
- Only owners can update workspace location fields.

**State Transitions**:

- `active` -> `archived` when removed by an owner

### Membership

Represents a user's relationship to a workspace and the role used for authorization.

**Fields**:

- `id`: opaque unique identifier
- `workspaceId`: workspace reference
- `userId`: user reference
- `role`: `owner`, `editor`, or `viewer`
- `status`: `invited`, `active`, or `removed`
- `createdAt`: server-generated timestamp
- `updatedAt`: server-generated timestamp

**Relationships**:

- Belongs to one `Workspace`
- Belongs to one `User`

**Validation Rules**:

- `(workspaceId, userId)` must be unique for non-removed memberships.
- Role must be one of `owner`, `editor`, or `viewer`.
- Only owners can invite users, change roles, remove users, update workspace location, or archive the workspace.
- Editors can manage boards, lists, and cards but cannot manage memberships.
- Viewers can read authorized content only.
- Owners cannot remove or demote the last remaining owner.

**State Transitions**:

- `invited` -> `active` when the invited user accepts access
- `active` -> `removed` when an owner removes access

### Invitation

Represents an invitation to join a workspace with a specific role.

**Fields**:

- `id`: opaque unique identifier
- `workspaceId`: workspace reference
- `email`: invitee email address
- `role`: `owner`, `editor`, or `viewer`
- `tokenHash`: hash of the invitation token
- `expiresAt`: expiration timestamp
- `acceptedAt`: nullable acceptance timestamp
- `revokedAt`: nullable revocation timestamp
- `createdByUserId`: owner who created the invitation
- `createdAt`: server-generated timestamp

**Relationships**:

- Belongs to one `Workspace`
- Created by one owner `User`

**Validation Rules**:

- Email must be valid and normalized.
- Role must be one of `owner`, `editor`, or `viewer`.
- Invitation tokens must never be stored in plaintext.
- Expired, accepted, or revoked invitations cannot be accepted.

**State Transitions**:

- `pending` -> `accepted` when the invitee joins
- `pending` -> `expired` when `expiresAt` passes
- `pending` -> `revoked` when an owner cancels it

### Board

Represents a task management surface inside a workspace.

**Fields**:

- `id`: opaque unique identifier
- `workspaceId`: workspace reference
- `title`: board title
- `position`: numeric ordering value within the workspace
- `createdAt`: server-generated timestamp
- `updatedAt`: server-generated timestamp
- `archivedAt`: nullable archive timestamp

**Relationships**:

- Belongs to one `Workspace`
- Has many `List` records

**Validation Rules**:

- Title must be 1-100 trimmed characters.
- Position must be server-validated and scoped to the workspace.
- Only owners and editors can create, rename, reorder, or archive boards.

**State Transitions**:

- `active` -> `archived` when archived by an owner or editor

### List

Represents an ordered column on a board.

**Fields**:

- `id`: opaque unique identifier
- `boardId`: board reference
- `title`: list title
- `position`: numeric ordering value within the board
- `createdAt`: server-generated timestamp
- `updatedAt`: server-generated timestamp
- `archivedAt`: nullable archive timestamp

**Relationships**:

- Belongs to one `Board`
- Has many `Card` records

**Validation Rules**:

- Title must be 1-100 trimmed characters.
- Position must be server-validated and scoped to the board.
- Only owners and editors can create, rename, reorder, or archive lists.

**State Transitions**:

- `active` -> `archived` when archived by an owner or editor

### Card

Represents a task item inside a list.

**Fields**:

- `id`: opaque unique identifier
- `boardId`: denormalized board reference for authorization and queries
- `listId`: current list reference
- `title`: card title
- `description`: optional card details
- `position`: numeric ordering value within the list
- `createdAt`: server-generated timestamp
- `updatedAt`: server-generated timestamp
- `archivedAt`: nullable archive timestamp

**Relationships**:

- Belongs to one `Board`
- Belongs to one current `List`
- Has many assigned users through `CardAssignee`

**Validation Rules**:

- Title must be 1-200 trimmed characters.
- Description must be at most 10,000 characters when present.
- A card can only move to a list on the same board.
- Assignees must be active members of the card's workspace.
- Only owners and editors can create, edit, move, assign, or archive cards.
- Viewers can read cards but cannot mutate them.

**State Transitions**:

- `active` -> `archived` when archived by an owner or editor
- `list A` -> `list B` when moved to another list on the same board

### CardAssignee

Represents assignment of a workspace member to a card.

**Fields**:

- `cardId`: card reference
- `userId`: user reference
- `assignedAt`: server-generated timestamp
- `assignedByUserId`: assigning owner or editor

**Relationships**:

- Belongs to one `Card`
- Belongs to one `User`

**Validation Rules**:

- `(cardId, userId)` must be unique.
- Assigned user must be an active member of the card's workspace.
- Assigning user must have card edit permission.

### ContextSnapshot

Represents cached time/weather provider data for a workspace location.

**Fields**:

- `id`: opaque unique identifier
- `workspaceId`: workspace reference
- `provider`: context provider name
- `observedAt`: timestamp from provider or server fetch time
- `expiresAt`: cache expiry timestamp
- `timeSummary`: nullable formatted time summary
- `weatherSummary`: nullable weather condition summary
- `temperature`: nullable numeric temperature
- `status`: `available`, `unavailable`, or `stale`
- `rawMetadata`: optional provider metadata

**Relationships**:

- Belongs to one `Workspace`

**Validation Rules**:

- Context data is never required for board reads or mutations.
- Failed provider calls produce `unavailable` status rather than blocking workspace access.
- Provider secrets must not be persisted in snapshots or sent to clients.

**State Transitions**:

- `available` -> `stale` when cache expires
- any state -> `unavailable` when provider data cannot be retrieved

## Authorization Matrix

| Action | Owner | Editor | Viewer | Signed Out |
|--------|-------|--------|--------|------------|
| Read workspace/boards/lists/cards | Yes | Yes | Yes | No |
| Create/rename/reorder/archive boards | Yes | Yes | No | No |
| Create/rename/reorder/archive lists | Yes | Yes | No | No |
| Create/edit/move/archive cards | Yes | Yes | No | No |
| Assign cards to workspace members | Yes | Yes | No | No |
| Invite/remove members | Yes | No | No | No |
| Change roles | Yes | No | No | No |
| Archive workspace | Yes | No | No | No |
| Update workspace location | Yes | No | No | No |

## Persistence Rules

- All board, list, card, workspace, membership, and role changes must be durable before a success response is returned.
- Server-generated timestamps are authoritative.
- Archived resources remain hidden from normal views unless explicitly requested by a privileged recovery flow.
- Permission checks must be performed using current database state on every request.
