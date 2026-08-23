# PR Stock Officer Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** จัดส่วนการทำงานของเจ้าหน้าที่คลังให้เป็น operational flow ที่สแกนง่ายและแก้ blocker ได้ตรงจุด โดยไม่เปลี่ยน business logic

**Architecture:** คง `PurchaseRequestChecklistPanel` เป็นส่วนเอกสาร/กรรมการ และ `PrReviewPanel` เป็นส่วนข้อมูลอ้างอิง/ผลกระทบ/การยืนยัน เพิ่ม semantic section wrappers และใช้ CSS ใน `app/globals.css` ตาม token เดิม

**Tech Stack:** Next.js App Router, React, TypeScript, CSS ใน `app/globals.css`, source/render contract tests ด้วย `tsx`

## Global Constraints

- คงเงื่อนไข `checklistReadyForConfirmation`, `isPending`, permission และ server actions เดิม
- ใช้ข้อความภาษาไทยในพื้นที่ operational เดียวกัน และไม่ใช้ตัวเลขวงกลมหรือ emoji เป็น icon
- คงระบบสี/spacing/radius จาก `DESIGN.md` และใช้ flat bench surfaces แทน decorative shadows
- interactive controls ต้องมี target อย่างน้อย 44px และ responsive ที่ 375/768/1024/1440px

---

### Task 1: Add failing workbench UI contracts

**Files:**
- Modify: `scripts/pr-ui.test.ts`
- Modify: `scripts/pr-checklist-ui.test.ts`

**Interfaces:**
- Tests inspect the existing `PrReviewPanel` and `PurchaseRequestChecklistPanel` source contracts; no production API changes.

- [x] **Step 1: Write the failing assertions**

Add assertions for `pr-review__section`, `pr-review__identifier-row`, `pr-review__confirm-zone`, `pr-review__blocker`, Thai download labels, checklist group headings, and attachment ordering.

- [x] **Step 2: Run focused tests to verify RED**

Run `npx tsx scripts/pr-ui.test.ts` and `npx tsx scripts/pr-checklist-ui.test.ts`.
Expected: fail because the new semantic classes and Thai labels are not present.

### Task 2: Restructure the checklist detail and review markup

**Files:**
- Modify: `components/pr/PurchaseRequestChecklistPanel.tsx`
- Modify: `components/pr/PrReviewPanel.tsx`

**Interfaces:**
- Consume existing `checklist`, `request`, `checklistReadyForConfirmation`, and callbacks.
- Produce stable class names used by `app/globals.css` and tests; mutation calls and disabled conditions remain unchanged.

- [x] **Step 1: Sort and label checklist content**

Derive `activeAttachments` in `PurchaseRequestChecklistPanel` with stable kind order `tor`, `plan`, `quotation`, change the archive label to Thai, replace the committee-PDF download control with `เปิดดู PDF กรรมการ` in the existing preview dialog, and update the committee-PDF route disposition to `inline` so the iframe renders it.

- [x] **Step 2: Group review content into working regions**

Wrap the E-Phis field/action in `pr-review__section` and `pr-review__identifier-row`. Wrap pending contract facts/date or the contract-impact table in a decision section. Keep existing inputs and server-action handlers intact.

- [x] **Step 3: Move the blocker beside the confirmation action**

Render `pr-review__blocker` immediately before the existing confirm button when `!checklistReadyForConfirmation`; retain the exact readiness condition and error copy. Put the button in `pr-review__confirm-zone` and keep loading text unchanged.

- [x] **Step 4: Run focused tests**

Run `npx tsx scripts/pr-ui.test.ts && npx tsx scripts/pr-checklist-ui.test.ts`.
Expected: PASS.

### Task 3: Implement the visual hierarchy and responsive layout

**Files:**
- Modify: `app/globals.css`

**Interfaces:**
- Style only the new `pr-review__*` and `pr-checklist-detail__*` hooks; reuse existing `--lab-*`, spacing, radius, and typography tokens.

- [x] **Step 1: Add flat section rhythm**

Use section padding and dividers to separate the four work regions, align identifier input/action in a desktop grid, and make the confirmation zone visually authoritative without adding a nested card.

- [x] **Step 2: Add blocker and control states**

Style blocker with semantic red surface plus written heading/copy, keep focus/disabled states visible, and preserve existing loading/error styles.

- [x] **Step 3: Add responsive rules**

At the existing 800px breakpoint collapse identifier/action and checklist toolbar; make action buttons full width on mobile and preserve readable table overflow.

- [x] **Step 4: Run focused tests and diff hygiene**

Run `npx tsx scripts/pr-ui.test.ts && npx tsx scripts/pr-checklist-ui.test.ts && git diff --check`.
Expected: PASS with no whitespace errors.

### Task 4: Verify and finish

**Files:**
- Inspect: `components/pr/PrReviewPanel.tsx`, `components/pr/PurchaseRequestChecklistPanel.tsx`, `app/globals.css`, and changed tests

- [x] **Step 1: Run quality gates**

Run `npm run test:pr`, `npm run typecheck`, `npm run lint`, and `npm run build`.

- [x] **Step 2: Run the full repository gate**

Run `npm run verify` and record any environment-skipped E2E tests without changing unrelated code.

- [x] **Step 3: Run the Impeccable detector once**

Run `node C:\Users\User\.agents\skills\impeccable\scripts\detect.mjs --json components/pr/PrReviewPanel.tsx components/pr/PurchaseRequestChecklistPanel.tsx app/globals.css`.
Expected: no findings.

- [x] **Step 4: Commit on main**

Run `git diff --check`, confirm `git status --short` contains only intended files, then commit with `feat: refine stock officer workbench`.
