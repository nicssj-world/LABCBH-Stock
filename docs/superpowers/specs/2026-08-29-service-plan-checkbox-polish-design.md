# Service plan checkbox polish

## Context

The service-plan create/edit form renders the two plan conditions inside a
`.form-grid`. The shared `.form-grid input` rule is intended for text-like
controls and currently stretches checkbox inputs to the full grid cell,
creating the oversized blue square shown in the supplied screenshot.

In this form, “ทำสัญญา” remains a plan setting: it marks the plan as requiring
the contract workflow for later service PRs. This change does not alter that
meaning, persistence, or validation. The requested UI copy remains unchanged;
no helper explanation is added.

## Approved direction

Polish the existing “Laboratory Control Bench” surface in place:

- Keep the current panel, labels, colors, typography, and two-column layout.
- Render each condition as a compact, full-row label with a native checkbox
  sized at approximately 18×18px.
- Keep the entire label row keyboard- and pointer-friendly with at least a
  44px minimum row height and visible hover/focus treatment.
- Give selected rows a quiet semantic tint/border so state is legible without
  relying on the checkbox alone.
- Keep disabled “ทำสัญญา” styling clear when the plan already has PRs.
- Preserve the one-column responsive behavior at the existing breakpoint.

## Implementation boundary

1. Update `components/service-procurement/ServicePlanForm.tsx` only as needed
   to expose selected/disabled state classes for the existing labels.
2. Add scoped checkbox-row styles in `app/globals.css` so the generic form
   control sizing cannot enlarge these checkbox inputs.
3. Do not change service-plan actions, schemas, copy, or database behavior.

## Acceptance criteria

- Both checkboxes render as small native controls rather than 100%-wide,
  46px-tall inputs.
- The visible label row remains at least 44px tall and can be toggled by
  clicking the text or row.
- Keyboard focus is visible; the checkbox remains a real form control with its
  existing controlled state and disabled behavior.
- Checked, unchecked, hover, focus, and disabled states are distinguishable in
  light mode without introducing new decorative effects.
- The form remains readable at desktop, tablet, and narrow mobile widths.
- No helper text is introduced below “ทำสัญญา”.
- Existing service-plan UI tests and the production build continue to pass.
