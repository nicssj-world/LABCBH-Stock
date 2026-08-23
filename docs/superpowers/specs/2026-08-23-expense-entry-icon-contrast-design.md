# Expense Entry Icon Contrast Design

## Request

Increase the visual prominence of the icon in the monthly expense form opening row. The existing “บันทึกค่าใช้จ่าย” action label and submit button are already clear; this change targets only the low-contrast plus icon tile shown in the collapsed form row.

## Scope

- Target: `.expense-entry__glyph` in the contract expense form.
- Preserve the existing row layout, copy, accordion behavior, 44px touch target, keyboard focus treatment, and responsive rules.
- Reuse the existing LABCBH Stock semantic color tokens; do not introduce a new color, font, shadow, or interaction pattern.
- Do not change the submit button or the separate out-lab monthly usage form.

## Design

Use the existing primary action color as the icon tile background and the surface color for the plus icon. This creates a clear foreground/background contrast while keeping the rounded tile, spacing, and icon family consistent with the current interface.

The icon remains 44×44px so the touch target is preserved. The surrounding row remains neutral so the icon becomes the visual cue for “open this entry form” without competing with the primary submit action after the form expands.

## Accessibility and interaction

- Keep the existing semantic `<button>` and `aria-expanded`/`aria-controls` state.
- Keep the visible `:focus-visible` outline on the row.
- Ensure the plus icon remains decorative with `aria-hidden="true"`; the row’s Thai label remains the accessible name.
- Use the existing reduced-motion behavior and hover transition without adding movement.

## Verification

- Run the existing lint and type checks.
- Run the targeted UI contract test for the expense form.
- Run Impeccable’s detector once against the changed UI targets.
- Inspect the final diff to confirm only the intended icon styling changed in the UI.
