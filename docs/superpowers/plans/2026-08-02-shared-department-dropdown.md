# Shared Department Dropdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Use one required department dropdown across purchase requests, goods receipts, requisitions, and contracts.

**Architecture:** Move the contract-owned department tuple into a neutral shared module. Re-export it from the contracts schema for compatibility, and pass the same list into the three client form components so they submit the existing `department` string unchanged.

**Tech Stack:** Next.js App Router, React, TypeScript, Zod, Node static-contract tests, Playwright.

## Global Constraints

- The standard list contains the existing 11 department names unchanged.
- The default department is `สำนักงานกลุ่มงานเทคนิคการแพทย์`.
- No database migrations or historical records change.
- Native required `select` controls replace only the three free-text department inputs.

---

### Task 1: Centralize the department list

**Files:**
- Create: `lib/organization/departments.ts`
- Modify: `lib/contracts/schema.ts:1-35`
- Modify: `scripts/contracts-department.test.ts:1-22`

**Interfaces:**
- Produces: `DEPARTMENTS`, a readonly tuple of standard department strings.
- Consumes: `CONTRACT_DEPARTMENTS` remains re-exported by `lib/contracts/schema.ts`.

- [ ] **Step 1: Write the failing test**

```ts
const sharedDepartments = read('lib/organization/departments.ts')
assert.match(sharedDepartments, /export const DEPARTMENTS = \[/)
assert.match(contractSchema, /import \{ DEPARTMENTS \} from '@\/lib\/organization\/departments'/)
assert.match(contractSchema, /export const CONTRACT_DEPARTMENTS = DEPARTMENTS/)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:contracts`

Expected: the department module assertion fails because the shared module does not exist.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/organization/departments.ts
export const DEPARTMENTS = [
  'สำนักงานกลุ่มงานเทคนิคการแพทย์',
  'งานเคมีคลินิก',
  'งานโลหิตวิทยาคลินิก',
  'งานภูมิคุ้มกันวิทยาคลินิก',
  'งานจุลทรรศนศาสตร์คลินิก',
  'งานอณูชีววิทยา',
  'งานจุลชีววิทยา',
  'งานคลังเลือด',
  'งานตรวจพิเศษและห้องปฏิบัติการตรวจต่อ',
  'งานบริการผู้ป่วยนอก',
  'ห้องปฏิบัติการศูนย์สุขภาพชุมชนเมืองชลบุรี',
] as const
```

Replace the tuple in `lib/contracts/schema.ts` with `export const CONTRACT_DEPARTMENTS = DEPARTMENTS`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:contracts`

Expected: all contract test scripts pass.

### Task 2: Render department dropdowns in operational forms

**Files:**
- Modify: `components/pr/PurchaseRequestForm.tsx:20-180`
- Modify: `components/receipts/ReceiptForm.tsx:15-135`
- Modify: `components/requisitions/RequisitionForm.tsx:15-115`
- Modify: `app/(protected)/purchase-requests/new/page.tsx:1-80`
- Modify: `app/(protected)/receipts/new/page.tsx`
- Modify: `app/(protected)/requisitions/new/page.tsx`
- Modify: `scripts/pr-ui.test.ts:20-42`
- Modify: `scripts/receiving-ui.test.ts`
- Modify: `scripts/requisition-schema.test.ts`
- Modify: `tests/e2e/pr.spec.ts:16`

**Interfaces:**
- Consumes: `DEPARTMENTS` from `@/lib/organization/departments`.
- Produces: each form receives `departments: readonly string[]` and submits its selected department.

- [ ] **Step 1: Write the failing tests**

```ts
assert.match(form, /departments: readonly string\[\]/)
assert.match(form, /<select required value=\{department\}/)
assert.match(form, /\{departments\.map\(\(department\)/)
assert.doesNotMatch(form, /<input type="text" required value=\{department\}/)
```

Update the PR Playwright workflow to select the default department by label instead of filling a text field.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:pr && npm run test:receiving && npm run test:requisitions`

Expected: UI assertions fail because each operational form still renders a text input.

- [ ] **Step 3: Write minimal implementation**

For each page, import `DEPARTMENTS` and pass `departments={DEPARTMENTS}`. For each client form, add the readonly `departments` prop, initialize its state with `departments[0]`, and replace only the department input with:

```tsx
<select required value={department} onChange={(event) => setDepartment(event.target.value)}>
  {departments.map((department) => (
    <option value={department} key={department}>{department}</option>
  ))}
</select>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:pr && npm run test:receiving && npm run test:requisitions && npm run lint`

Expected: all scripts complete with exit code 0.

### Task 3: Build verification

**Files:**
- Modify: none

- [ ] **Step 1: Build the production application**

Run: `npm run build`

Expected: Next.js completes compilation, TypeScript checking, and page generation with exit code 0.

- [ ] **Step 2: Check the final diff**

Run: `git diff --check && git diff -- docs/superpowers/specs/2026-08-02-shared-department-dropdown-design.md docs/superpowers/plans/2026-08-02-shared-department-dropdown.md lib/organization/departments.ts lib/contracts/schema.ts components/pr/PurchaseRequestForm.tsx components/receipts/ReceiptForm.tsx components/requisitions/RequisitionForm.tsx`

Expected: no whitespace errors; changes are limited to the shared department source, its consumers, tests, and the approved docs.
