# MVP Theme Guide

The Trello MVP uses the supplied token set as its visual baseline. Default roles are:

- Background: `ash-canvas`
- Surface: `paper-white`
- Primary text: `inkwell-navy`
- Secondary text: `slate`
- Emphasis and destructive action: `coral-emphasis`

Use `GRIFTER` for expressive headings when the font is available. Use `Inter` for body text, form controls, card content, board labels, and dense workspace UI. If `GRIFTER` is unavailable, fall back to the documented sans-serif stack without changing size or spacing decisions.

Use the documented type scale for captions, body text, subheadings, headings, display, and extra-large display. Product UI should prefer body, body-sm, subheading, and heading-sm levels; larger display levels are reserved for rare onboarding or empty-state moments.

Use the spacing scale consistently across related screens. Prefer the nearest documented spacing token before adding a new gap. Use `radius-lg` for controls and task cards, `radius-2xl` for larger panels only when a screen needs stronger separation, and subtle shadows only for actionable cards, lists, and overlays.

All color pairings for normal text, large text, and UI controls must meet WCAG 2.2 AA. Interactive elements need keyboard-visible focus, disabled states that are visibly distinct, and error states with readable messages or non-color cues. New visual tokens are avoided for MVP unless an existing token cannot satisfy a documented product need.
