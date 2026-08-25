# Service-plan responsible-user picker

## Context

The create/edit service-plan form currently renders every active profile as a
five-column checkbox grid. This makes the responsible-user section dominate the
page, gives every person equal visual weight, has no search, and lets the sticky
form action bar cover the last rows. The existing `/contracts` detail flow
already has the right interaction model for a large directory: selected users
first, searchable results, a bounded list, and a native dialog.

## Design decision

Three approaches were considered:

1. **Inline searchable list** — add search and selected/unselected grouping to
   the current panel. It is easy to discover, but the form still grows with
   directory size and competes with plan details.
2. **Detail-page dialog following `/contracts`** — keep the create/edit form
   focused on plan metadata and manage responsible users from the plan detail
   page. It matches an established pattern, bounds the interaction, and works
   well on desktop and mobile. This is the selected approach.
3. **Extract one generic responsible-user component** — share a picker between
   service plans and contracts. It would reduce visual duplication, but the two
   flows have different persistence semantics (draft form selection versus an
   audited contract RPC), so a generic abstraction would add coupling without
   helping this change.

## User experience

The create/edit form contains only plan metadata. The plan detail page keeps the
responsible-user section as a read-only summary and exposes a manager-only
`กำหนดผู้รับผิดชอบ` action beside the detail actions:

- The section header keeps the count, e.g. `3 คน`.
- Selected people are shown as readable rows with name and department. An empty
  state explains that nobody has been assigned yet.
- The action opens a native modal dialog.
- The dialog shows selected people first, then a labelled search field that
  matches name or E-Phis ID, then at most eight matching candidates.
- Each candidate remains a full checkbox row with a minimum 44px target. A
  checked candidate is visibly selected without relying on color alone.
- No matches produce a helpful empty state. Long Thai names and positions wrap
  without widening the dialog.
- `บันทึกผู้รับผิดชอบ` persists the selected IDs through the audited service-plan
  RPC; `ยกเลิก` and Escape discard dialog-only changes.

## Component and data flow

Add a service-plan-specific client dialog/picker rather than reusing the
contract picker directly. The contract picker is coupled to
`setResponsibleUsers`, audit notes, and a different record shape.

`ServicePlanResponsibleDialog` receives the plan ID, candidate list, and current
IDs, creates a local draft when opened, and persists the chosen IDs with
`setServicePlanResponsibles` only when the user confirms. The candidate shape
includes the existing name and position plus the already-loaded `ePhisId` for
search and secondary identification. The create/edit form no longer loads
candidates or renders an assignment control; editing metadata preserves the
existing IDs.

All dialog controls that are not the outer form submit use `type="button"` so
the native dialog cannot accidentally submit the plan.

## Layout and visual rules

- Preserve the LABCBH Stock “Laboratory Control Bench” tokens and existing
  `bench-panel`/`lab-button` primitives.
- Add a scoped content wrapper/inset to the detail-page responsible section:
  20px desktop and 16px at the narrow breakpoint, with the read-only summary
  and manager action aligned to the detail header.
- Use a single-column list inside the dialog, not a multi-column directory.
- Keep the service-plan form action bar in normal flow so it cannot occlude
  content.
- Use the existing dialog surface, backdrop, focus ring, and reduced-motion
  rules. The dialog body is scrollable with a bounded height and adapts to the
  viewport; it must not create horizontal scrolling.
- Use semantic color tokens for selected/focus/error states. Text and state
  remain understandable in grayscale and with assistive technology.

## Accessibility and edge cases

- Native `<dialog>` with `aria-labelledby`, a visible heading, a labelled close
  button, and the browser Escape close path.
- Visible label for search; result status announced politely; checkbox labels
  include the person's name and position/ID.
- Preserve keyboard order: selected users, search, results, then dialog actions.
- Empty candidate list, zero selected users, no search matches, long names, and
  320px-wide screens all receive an intentional state.
- Pending form submission disables the form action controls. Pending dialog saves
  disable picker controls and report server errors inline with `role="alert"`.

## Verification plan

Before implementation, add a failing service-procurement picker test covering:

1. empty-search results are capped at eight;
2. search matches both name and E-Phis ID;
3. toggling a selected ID removes it and toggling an unselected ID adds it once;
4. the UI source keeps assignment out of the form, places the dialog on the
   detail page, uses labelled search and save/cancel semantics, and does not
   render the old unbounded grid.

After implementation, run the focused test through the red-green cycle, then
run the service-procurement UI suite, lint, typecheck, build, and the final
Impeccable detector on changed UI files. Inspect the rendered page at desktop
and narrow/mobile widths; source/build success alone is not sufficient.

## Scope boundary

This change is limited to the service-plan responsible-user interaction and its
scoped styles/tests. It does not change contract responsible-user behaviour,
permissions, the existing database RPC, candidate query ordering, or unrelated
form fields.
