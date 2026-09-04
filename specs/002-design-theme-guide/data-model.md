# Data Model: Design Theme Guide

## Overview

This feature has no application persistence model. The model below describes the design documentation concepts that must remain clear and traceable across `spec.md`, `design-tokens.md`, and future implementation tasks.

## Entities

### Design Theme

Represents the full visual language for the MVP.

**Fields**:

- `name`: Design Theme Guide
- `scope`: authentication, workspace, board, card, and settings experiences
- `tokenGroups`: colors, typography, typography scale, spacing, border radius, shadows
- `status`: draft, reviewed, approved

**Relationships**:

- Contains many `Design Token` records conceptually grouped by category
- Defines many `Color Role`, `Typography Level`, `Spacing Step`, and `Surface Treatment` decisions

**Validation Rules**:

- Must preserve the provided token names and values in the dedicated reference.
- Must not introduce additional MVP visual tokens unless a documented product need justifies them.
- Must stay usable as a design and product reference, not a coded implementation artifact.

**State Transitions**:

- `draft` -> `reviewed` when reviewers confirm token completeness and usage guidance
- `reviewed` -> `approved` when accessibility and screen-mapping checks pass
- `approved` -> `draft` if supplied tokens are changed or new tokens are proposed

### Design Token

Represents one named visual value from the supplied theme.

**Fields**:

- `name`: canonical token name, such as `--color-inkwell-navy`
- `value`: exact supplied value
- `group`: color, font, text size, line height, tracking, spacing, radius, or shadow
- `intendedUse`: short description of where the token should be used

**Relationships**:

- Belongs to one `Design Theme`
- May support one or more semantic roles

**Validation Rules**:

- Name and value must match the supplied theme exactly in `design-tokens.md`.
- Any renamed or replaced token must be explicitly documented before downstream use.
- Token usage must account for readability and accessibility when applied to UI requirements.

### Color Role

Represents a semantic purpose assigned to one or more color tokens.

**Fields**:

- `role`: background, surface, primary text, secondary text, emphasis, accent, warning, neutral
- `candidateTokens`: supplied color tokens appropriate for the role
- `accessibilityRequirement`: WCAG 2.2 AA contrast and non-color cue expectations

**Relationships**:

- Uses one or more color `Design Token` entries
- Applies to `Surface Treatment` and interactive UI requirements

**Validation Rules**:

- Text and control color pairings must meet WCAG 2.2 AA contrast.
- Status or emphasis color must not be the only cue where meaning would be ambiguous.
- Inaccessible pairings must be replaced with an accessible pairing from the supplied palette.
- Default MVP roles are background `ash-canvas`, surface `paper-white`, primary text `inkwell-navy`, secondary text `slate`, and emphasis `coral-emphasis`.

### Typography Level

Represents a named text hierarchy level from the supplied type scale.

**Fields**:

- `level`: caption, body-sm, body, body-lg, subheading, heading-sm, heading, heading-lg, display, display-xl
- `fontFamily`: expressive heading family or interface text family
- `size`: supplied text size
- `lineHeight`: supplied leading value
- `tracking`: supplied letter-spacing value
- `intendedUse`: display, heading, body, control, metadata, or dense UI text

**Relationships**:

- Uses font and scale `Design Token` entries
- Applies to screen hierarchy and readability requirements

**Validation Rules**:

- `GRIFTER` is intended for expressive headings and display moments when available.
- `Inter` is intended for body text, controls, forms, board content, cards, and dense UI.
- Fallback font stacks must remain acceptable when the primary font is unavailable.
- Typography choices must remain readable on desktop and mobile.

### Spacing Step

Represents one named spacing value from the supplied spacing scale.

**Fields**:

- `name`: canonical spacing token name
- `value`: exact pixel value
- `intendedUse`: compact gaps, component padding, section spacing, or page spacing

**Relationships**:

- Belongs to one `Design Theme`
- Applies to layout and component requirements

**Validation Rules**:

- Related layouts and components should reuse consistent spacing steps.
- The nearest documented spacing token should be used before introducing a new value.
- Responsive layouts must avoid spacing choices that reduce mobile usability.

### Surface Treatment

Represents the combined visual treatment for cards, panels, controls, and overlays.

**Fields**:

- `surfaceType`: compact control, card, prominent panel, overlay, or page background
- `backgroundRole`: semantic color role
- `radiusToken`: supplied radius token
- `shadowToken`: supplied shadow token when elevation is needed
- `stateRequirements`: default state, keyboard-visible focus indicator, visually distinct disabled state, error state with readable message or non-color cue, and elevated state where applicable

**Relationships**:

- Uses `Color Role`, radius `Design Token`, and shadow `Design Token` entries
- Applies to planned MVP screens and reusable UI elements

**Validation Rules**:

- Subtle elevation should be used only where it helps distinguish layered surfaces.
- Keyboard-visible focus indicators, visually distinct disabled states, and error states with readable messages or non-color cues must be documented for interactive surfaces.
- One-off radius or shadow values require documented justification.

## Token Group Inventory

| Group | Required Count | Source |
|-------|----------------|--------|
| Colors | 10 | `design-tokens.md` |
| Font families | 2 | `design-tokens.md` |
| Typography scale triplets | 10 | `design-tokens.md` |
| Spacing steps | 13 | `design-tokens.md` |
| Border radius values | 3 | `design-tokens.md` |
| Shadows | 3 | `design-tokens.md` |

## Review Rules

- Every MVP screen requirement should map primary visual decisions back to this guide.
- Every token reference should use the canonical token name.
- WCAG 2.2 AA accessibility review must happen before approving text, control, and status color pairings.
- New visual tokens remain exceptions and require a written justification.
