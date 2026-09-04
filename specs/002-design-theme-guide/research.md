# Phase 0 Research: Design Theme Guide

## Documentation Format

**Decision**: Use Markdown as the primary format for the design guide artifacts, with fenced CSS for the exact supplied token source.

**Rationale**: The project is already organized around Spec Kit Markdown artifacts, and the user explicitly asked for a separate Markdown document if needed. Markdown supports human review, links between spec artifacts, and preservation of the original token block without requiring code implementation.

**Alternatives considered**: A coded theme file was rejected for this phase because the request is to guide design and planning, not implement UI wiring. A design-tool-only file was rejected because it would not be reviewable in the repository.

## Token Preservation

**Decision**: Preserve all supplied token names and values exactly in `design-tokens.md` and treat them as canonical for MVP design review.

**Rationale**: Exact preservation prevents drift between the user's supplied visual direction and later implementation tasks. The reference can be compared directly against future coded theme configuration.

**Alternatives considered**: Renaming tokens to semantic aliases was rejected for the first pass because it could lose the user's intended naming. Generating derived palettes was rejected because it introduces visual decisions not requested by the user.

## Semantic Usage Guidance

**Decision**: Use the spec and data model to describe semantic roles for colors, typography, spacing, radius, shadows, and surface treatments.

**Rationale**: Tokens alone do not explain where each value should be used. Semantic guidance helps contributors map the theme to authentication, workspace, board, card, and settings screens consistently.

**Alternatives considered**: Leaving usage fully implicit was rejected because it would allow inconsistent interpretation across screens. Fully specifying every component state was rejected because component implementation is out of scope for this feature.

## Accessibility Baseline

**Decision**: Require WCAG 2.2 AA contrast for normal text, large text, and UI controls, plus non-color cues for status/emphasis, keyboard-visible focus indicators, visually distinct disabled states, and error states with readable messages or non-color cues in design review.

**Rationale**: The provided palette includes expressive colors that may not always satisfy contrast requirements in every pairing. Making accessibility a review requirement avoids locking in unreadable combinations.

**Alternatives considered**: Deferring accessibility to implementation was rejected because color and typography decisions are made during design. WCAG 2.2 AAA was considered stricter than necessary for the MVP baseline. Informal visual review was rejected because it would make release approval subjective.

## Default Color Roles

**Decision**: Use background `ash-canvas`, surface `paper-white`, primary text `inkwell-navy`, secondary text `slate`, and emphasis `coral-emphasis` as the default MVP color role mapping.

**Rationale**: This mapping gives screens a consistent light canvas, clear card/panel surfaces, high-emphasis text, subdued secondary text, and a strong accent for key emphasis while leaving other supplied colors available for accent, warning, and state moments.

**Alternatives considered**: A white-first background was considered but provides less distinction between canvas and card surfaces. A navy-first background was rejected as the default because it makes contrast and dense board usability more constrained.

## Responsive Use

**Decision**: Require typography and spacing choices to remain readable and usable on desktop and mobile, using the supplied scale before introducing new values.

**Rationale**: The theme will guide MVP screens that must work across common web layouts. Responsive guidance prevents display-scale typography or oversized spacing from being used where it harms mobile usability.

**Alternatives considered**: Desktop-only guidance was rejected because the MVP web app should remain usable on mobile. Creating a separate mobile token scale was rejected because it expands the supplied theme without a documented need.

## Review and Validation

**Decision**: Validate this feature through documentation review, token completeness comparison, accessibility contrast checks, and screen-requirement mapping scenarios.

**Rationale**: There is no runtime behavior in this feature; validation should prove that the requirements and references are complete, clear, and usable by contributors before implementation starts.

**Alternatives considered**: Automated UI tests were rejected because no UI implementation is created in this phase. Snapshot testing was rejected because there are no rendered components yet.

## Contract Scope

**Decision**: Do not create external interface contracts for this feature.

**Rationale**: The feature produces internal documentation and design guidance only. It does not expose APIs, CLI commands, public schemas, or parser grammar.

**Alternatives considered**: A JSON token schema was considered but rejected for this phase because the user supplied CSS-style theme tokens and asked for Markdown guidance. A schema can be added later if implementation tooling requires it.
