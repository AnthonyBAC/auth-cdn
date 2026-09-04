# Quickstart: Design Theme Guide Validation

## Purpose

Use this guide to validate that the design theme documentation is ready to guide MVP screen planning and implementation.

## Prerequisites

- `specs/002-design-theme-guide/spec.md` exists.
- `specs/002-design-theme-guide/design-tokens.md` contains the supplied theme source.
- `specs/002-design-theme-guide/data-model.md` defines the design documentation concepts.
- Reviewers have access to the MVP auth/workspace/board feature requirements when mapping screens to the theme.

## Scenario 1: Token Completeness Review

1. Compare the original supplied theme with `design-tokens.md`.
2. Count each token group: colors, font families, typography scale, spacing, radius, and shadows.
3. Confirm names and values match the supplied theme exactly.

Expected outcome: 100% of supplied tokens are present, with canonical names and values preserved.

## Scenario 2: Semantic Usage Review

1. Review `spec.md` and `data-model.md` for semantic roles.
2. Confirm the guide explains default MVP roles for background `ash-canvas`, surface `paper-white`, primary text `inkwell-navy`, secondary text `slate`, and emphasis `coral-emphasis`.
3. Confirm the guide explains intended uses for accents, warnings, neutral colors, spacing, radii, and shadows.
4. Confirm the guide distinguishes expressive heading typography from general interface text.

Expected outcome: contributors can map primary visual decisions to documented theme guidance without guessing token intent.

## Scenario 3: MVP Screen Mapping Review

1. Select representative MVP screens: register, login, workspace list, board view, card detail, and workspace settings.
2. For each screen, map primary background, surface, text, emphasis, spacing, radius, and shadow choices to the guide.
3. Note any screen need that cannot be satisfied by existing tokens.

Expected outcome: at least 90% of reviewed screen requirements map to existing theme guidance without requiring a new token.

## Scenario 4: Accessibility Review

1. Identify text, control, emphasis, warning, and status color pairings proposed from the palette.
2. Review each pairing against WCAG 2.2 AA contrast for normal text, large text, and UI controls.
3. Confirm status or emphasis meanings are not communicated by color alone.
4. Confirm interaction requirements include keyboard-visible focus indicators, visually distinct disabled states, and error states with readable messages or non-color cues.

Expected outcome: all reviewed text and control pairings meet WCAG 2.2 AA contrast, and interactive/state guidance is present.

## Scenario 5: New Token Exception Review

1. Review proposed screen requirements for any color, font size, spacing, radius, or shadow not present in `design-tokens.md`.
2. Confirm each proposed new token includes a written product need explaining why existing tokens are insufficient.
3. Reject or defer undocumented one-off visual values.

Expected outcome: 100% of new visual token proposals include documented justification before release approval.

## Scenario 6: Contributor Comprehension Review

1. Give a reviewer the design guide artifacts.
2. Ask them to identify `GRIFTER` as the heading font, `Inter` as the body font, `ash-canvas` as the default background, `paper-white` as the default surface, `inkwell-navy` as primary text, `slate` as secondary text, and `coral-emphasis` as emphasis.
3. Time the review.

Expected outcome: 95% of contributors can identify all core theme decisions listed in SC-004 in under 3 minutes.

## Reference Artifacts

- Feature specification: [spec.md](./spec.md)
- Design tokens: [design-tokens.md](./design-tokens.md)
- Data model: [data-model.md](./data-model.md)
- Research decisions: [research.md](./research.md)
