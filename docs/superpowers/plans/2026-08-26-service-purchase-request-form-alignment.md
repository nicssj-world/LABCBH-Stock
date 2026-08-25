# Service Purchase Request Form Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align the service purchase request form with the proven `/purchase-requests/new` form architecture while preserving service-procurement behavior and payloads.

**Architecture:** Reuse the existing PR presentation primitives where their semantics fit (`ThaiDateInput`, `StickyScroll`, the item-picker pattern and responsive line-card structure). Add a small service mode to `ContractItemPicker` so search/result/manual-entry behavior remains one implementation, then render service-specific request lines and checklist fields inside the same panel/inset rhythm. Keep all service state and submit validation in `ServicePurchaseRequestForm`.

**Tech Stack:** Next.js App Router, React 19, TypeScript, plain CSS design tokens, `tsx` source-level UI tests, Playwright for rendered verification.

## Global Constraints

- Preserve `createServicePurchaseRequest`, payload shape, route, authorization, and service validation rules.
- Follow the existing `bench-panel`, `field-row`, `StickyScroll`, `data-table`, `form-action-bar`, and `pr-form-line-card` design tokens.
- Do not add inline styles, new dependencies, emoji icons, or a second styling system.
- Keep Thai copy and WCAG AA contrast; interactive controls are at least 44px high.
- Verify at 375px, 800px, and desktop widths; no page-level horizontal overflow.

---

### Task 1: Add failing UI contract assertions

**Files:**
- Modify: `scripts/service-procurement-ui.test.ts`

**Interfaces:**
- Produces source-level assertions that the service form imports the shared controls, separates item selection from request lines, and provides desktop/mobile line presentations.

- [ ] **Step 1: Write the failing test**

Add assertions after the existing service form checks:

```ts
const serviceForm = read('components/service-procurement/ServicePurchaseRequestForm.tsx')
assert.match(serviceForm, /ThaiDateInput/, 'service PR date must use the shared Thai date control')
assert.match(serviceForm, /StickyScroll/, 'service PR lines must use the shared scroll container')
assert.match(serviceForm, /ContractItemPicker/, 'service PR item selection must reuse the shared picker pattern')
assert.match(serviceForm, /REQUEST LINES/, 'selected service items must have their own request-lines panel')
assert.match(serviceForm, /pr-form-line-cards/, 'service PR lines must have a mobile card presentation')
assert.match(serviceForm, /pr-form-lines-table--desktop/, 'service PR lines must have an explicit desktop presentation')
assert.match(serviceForm, /aria-labelledby="service-header-title"/, 'service panels must expose heading relationships')
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:service-procurement`

Expected: FAIL because the current service form does not import `ThaiDateInput`, `StickyScroll`, or `ContractItemPicker`, and has no `REQUEST LINES`/mobile-card structure.

### Task 2: Make the shared picker support service semantics

**Files:**
- Modify: `components/pr/ContractItemPicker.tsx`
- Modify: `app/globals.css`

**Interfaces:**
- `ContractItemPickerProps` gains `variant?: 'inventory' | 'service'` and `manualUnitPrice?: boolean`.
- `PickerOption` remains backward compatible; inventory facts stay required for the default variant.
- Service variant renders the same search/result/manual layout but displays only unit and unit price facts relevant to service procurement, and returns optional manual unit price through `ManualItemInput` when requested.

- [ ] **Step 1: Write the failing test**

Extend `scripts/service-procurement-ui.test.ts` with:

```ts
const picker = read('components/pr/ContractItemPicker.tsx')
assert.match(picker, /variant\?: 'inventory' \| 'service'/, 'shared picker must expose a service presentation variant')
assert.match(picker, /manualUnitPrice\?: boolean/, 'service manual items must optionally collect a unit price')
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:service-procurement`

Expected: FAIL because the picker has no variant or optional price interface.

- [ ] **Step 3: Write minimal implementation**

Add the optional props and branch only the rendered facts/manual fields; preserve default inventory output exactly. For service mode, use `formatBaht(option.unitPrice)` and omit contract/on-hand facts. Keep `field-row`, `item-picker`, and `item-picker__manual` classes.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:service-procurement`

Expected: PASS for the picker contract and all existing service domain/schema/UI checks.

### Task 3: Refactor the service form structure

**Files:**
- Modify: `components/service-procurement/ServicePurchaseRequestForm.tsx`

**Interfaces:**
- Keep the component props, service state, submit handler, and `createServicePurchaseRequest` payload unchanged.
- Render the existing service line data as `PickerOption` values for `ContractItemPicker` and render selected lines in a separate desktop table/mobile card panel.

- [ ] **Step 1: Write the failing test**

The assertions from Task 1 remain the red contract. Add one assertion for the preserved server action and service route:

```ts
assert.match(serviceForm, /createServicePurchaseRequest\(formData\)/, 'service submit action must remain unchanged')
assert.match(serviceForm, /\/service-procurement\/purchase-requests/, 'service cancel route must remain unchanged')
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:service-procurement`

Expected: FAIL only on the new shared-structure assertions.

- [ ] **Step 3: Write minimal implementation**

1. Import `ThaiDateInput`, `StickyScroll`, `ContractItemPicker`, and the picker types.
2. Replace the native date input with `ThaiDateInput` and add `field-row`, required markers, `aria-labelledby` panel headings, and the same 2×2 header grid as the PR form.
3. Keep plan/method controls in a dedicated panel; retain service budget callout and laboratory-testing fields.
4. Replace direct search/results/manual JSX with `ContractItemPicker variant="service" manualUnitPrice` and adapt `addLine`/`addManualLine` without changing the final payload mapping.
5. Create a separate `REQUEST LINES` panel. Use `StickyScroll` around a desktop `data-table` with quantity/unit-price editors and total. Add a `pr-form-line-cards` list for mobile with identity, facts, editable fields, and remove controls.
6. Keep the checklist panel’s file names and committee state, but wrap attachments and committees in aligned content regions, add required markers, `min-width: 0`, and an empty/error state near the relevant group.
7. Add a summary sentence in the action bar and form bottom clearance class; keep submit disabled/loading/error behavior.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:service-procurement`

Expected: PASS with the shared structure assertions and all service domain/schema/UI tests.

### Task 4: Add responsive and overflow styling

**Files:**
- Modify: `app/globals.css`

**Interfaces:**
- Add only service-form structure modifiers and reuse existing PR line-card/picker tokens; do not change global form control semantics.

- [ ] **Step 1: Write the failing test**

Extend `scripts/service-procurement-ui.test.ts`:

```ts
const styles = read('app/globals.css')
assert.match(styles, /\.service-pr-form/, 'service form needs an explicit layout wrapper')
assert.match(styles, /\.service-lines[^\n]*overflow-x: auto|\.service-pr-form[^\n]*padding-bottom/, 'service form must reserve overflow/bottom clearance')
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:service-procurement`

Expected: FAIL because no service-form wrapper rule provides the required clearance/overflow contract.

- [ ] **Step 3: Write minimal implementation**

Add rules that:

- give raw picker/checklist content the same 20–22px horizontal inset as `item-picker-search`;
- set `.service-lines` to `overflow-x: auto` for desktop/tablet;
- hide the desktop table and show `.pr-form-line-cards` at the existing 800px breakpoint;
- set `min-width: 0`, `overflow-wrap: anywhere`, and `fieldset` constraints for long Thai names/legends;
- add bottom padding/scroll margin for the sticky action bar, and make action buttons stack at the existing 540px breakpoint;
- preserve 4/8px rhythm and 44px controls.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:service-procurement`

Expected: PASS.

### Task 5: Run bounded verification and render review

**Files:**
- Verify: `components/service-procurement/ServicePurchaseRequestForm.tsx`
- Verify: `components/pr/ContractItemPicker.tsx`
- Verify: `app/globals.css`
- Verify: `scripts/service-procurement-ui.test.ts`

- [ ] **Step 1: Run focused checks**

Run: `npm run test:service-procurement`, `npm run typecheck`, and `npm run lint`.

Expected: exit code 0 with no new warnings.

- [ ] **Step 2: Run Impeccable detector**

Run:

```powershell
node 'C:\Users\User\.agents\skills\impeccable\scripts\detect.mjs' --json --scope layout 'components/service-procurement/ServicePurchaseRequestForm.tsx' 'components/pr/ContractItemPicker.tsx' 'app/globals.css'
```

Expected: no unexplained layout findings.

- [ ] **Step 3: Render desktop and mobile states**

Run the app with `npm run dev` or the repository’s available local server and inspect `/service-procurement/purchase-requests/new` at desktop and 375px/800px widths. Confirm header alignment, separated item/request-lines panels, no page overflow, cards at mobile, and no active field hidden behind the action bar.

- [ ] **Step 4: Run production build**

Run: `npm run build`

Expected: exit code 0.
