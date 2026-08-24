# Requisition Stock Reservation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** กันยอดคลังทันทีเมื่อใบเบิกถูกสร้างหรือแก้ไข โดยใช้ใบเบิกสถานะ `waiting` เป็น reservation และรักษาการตัด stock จริงไว้ที่การจ่ายของ

**Architecture:** เพิ่ม view สำหรับยอด usable/reserved/available และ re-define requisition RPCs ใน migration ใหม่ให้ล็อก `inventory_items` ตามลำดับเดียวกันก่อนตรวจยอดทุก mutation. ปรับ catalog/form ให้แสดงและ validate ยอด `available_to_request` แต่ให้ database เป็น source of truth สำหรับ race condition.

**Tech Stack:** Supabase PostgreSQL migrations/RPCs, Next.js 16 App Router Server Components, React client form, TypeScript contract tests, existing CSS tokens.

## Global Constraints

- ห้ามเขียน `requisition_issue` movement ตอนสร้างหรือแก้ไขใบเบิก; ตัด stock เฉพาะตอน `fulfill_requisition` เท่านั้น
- ใบ `waiting` นับเป็น reservation; ใบ `fulfilled` และ `cancelled` ไม่ถูกหักในยอด available
- usable lot ต้อง balance มากกว่า 0 และ expiry ต้องมากกว่า `public.lab_stock_today()` หรือไม่มีวันหมดอายุ
- ทุก RPC ต้อง `security invoker`, `set search_path = ''`, service-role-only execute และล็อก inventory item ids แบบ deterministic
- คง FIFO, append-only ledger, authorization และ protected route เดิม
- UI ต้องใช้ Noto Sans Thai/mono tokens เดิม, สถานะมีข้อความไม่พึ่งสีอย่างเดียว และ interactive target อย่างน้อย 44px

---

### Task 1: Add failing reservation contracts

**Files:**
- Create: `scripts/requisition-reservation.test.ts`
- Modify: `scripts/requisition-schema.test.ts`
- Modify: `scripts/requisition-transaction.test.ts`
- Modify: `scripts/requisition-ui.test.ts`

**Interfaces:**
- Tests look for the new migration suffix, the availability view, deterministic inventory-item locks, reservation checks in create/update, reservation release through status transitions, and the new form blocking contract.

- [x] **Step 1: Write assertions for the missing migration and transaction behavior**

Assert that the migration contains `inventory_item_requisition_availability`, `usable_on_hand`, `waiting_reserved`, `available_to_request`, an ordered `FOR UPDATE` lock on `inventory_items`, and an availability failure message. Assert create/update call the availability helper before inserting/replacing items and fulfillment locks inventory items before writing movements.

- [x] **Step 2: Write assertions for UI source contracts**

Assert the form consumes `availableToRequest`, filters on that value, sets an input `max`, blocks submit when a line exceeds available, and uses copy that explains waiting reservations. Assert list/detail/summary no longer render `รวมที่ขอ` or add raw cross-unit sums.

- [x] **Step 3: Run focused tests and verify RED**

Run:

```powershell
npx tsx scripts/requisition-reservation.test.ts
npx tsx scripts/requisition-schema.test.ts
npx tsx scripts/requisition-transaction.test.ts
npx tsx scripts/requisition-ui.test.ts
```

Expected: the new reservation test fails because the migration and source contracts do not exist yet.

### Task 2: Add the reservation-aware Supabase migration

**Files:**
- Create via `supabase migration new requisition_stock_reservation`: `supabase/migrations/<timestamp>_requisition_stock_reservation.sql`

**Interfaces:**
- Keep existing RPC signatures for `create_requisition`, `update_requisition`, `cancel_requisition`, and `fulfill_requisition`.
- Add `public.inventory_item_requisition_availability` as a security-invoker read view with `inventory_item_id`, `usable_on_hand`, `waiting_reserved`, and `available_to_request`.

- [x] **Step 1: Create the migration skeleton with the Supabase CLI**

Run `supabase migration new requisition_stock_reservation` and use the generated timestamped path; do not invent a migration filename.

- [x] **Step 2: Add the availability view and grants**

Aggregate eligible lot balances from `inventory_lot_balances`, aggregate `requested_quantity` for `requisitions.status = 'waiting'`, clamp available quantity at zero, add `security_invoker = true`, revoke public Data API mutations, and grant authenticated select/service-role select consistently with existing balance views.

- [x] **Step 3: Add deterministic lock and availability helper functions**

Create service-role-only `assert_requisition_stock_available(p_item_ids uuid[], p_quantities jsonb, p_exclude_requisition_id uuid default null)` that locks existing `inventory_items` in sorted id order, rejects missing/inactive items, computes usable stock minus other waiting reservations, and raises a Thai actionable error naming the item and requested/available quantities.

- [x] **Step 4: Re-define create/update/cancel/fulfill using the helper and lock order**

Create/update call the helper before writing waiting lines; update excludes its own requisition from the waiting reservation sum. Cancel changes status only after locking its line items. Fulfill locks the requisition, then all its inventory items in sorted order, then the selected lots; it preserves the existing exact allocation, expiry, FIFO and negative-ledger checks and marks the waiting reservation consumed by changing status to fulfilled.

- [x] **Step 5: Run the static reservation contracts**

Run `npx tsx scripts/requisition-reservation.test.ts && npx tsx scripts/requisition-schema.test.ts && npx tsx scripts/requisition-transaction.test.ts`. Expected: PASS for the new migration contracts.

### Task 3: Expose available-to-request quantities to the requisition form

**Files:**
- Modify: `lib/requisitions/queries.ts`
- Modify: `app/(protected)/requisitions/new/page.tsx`
- Modify: `app/(protected)/requisitions/[id]/edit/page.tsx`
- Modify: `components/requisitions/RequisitionForm.tsx`

**Interfaces:**
- Add `availableToRequest: number` to the catalog item shape while preserving `onHand` for physical stock display.
- Read the new availability view in parallel with existing inventory balances and map a missing row to zero available.

- [x] **Step 1: Add failing form/type expectations**

Extend the source contract to require `availableToRequest` in catalog mapping, option hints, line state, input `max`, and the disabled submit condition.

- [x] **Step 2: Implement the batch availability read**

Read `inventory_item_requisition_availability` for the same catalog item ids or add a focused `listRequisitionCatalog` query; preserve existing department filtering and physical `onHand` semantics.

- [x] **Step 3: Implement client-side blocking and copy**

Filter new item options where `availableToRequest > 0`, show `เบิกได้อีก ...` beside physical on-hand, set `max={line.availableToRequest}`, show a blocking line error when requested quantity is above available, and disable submit while any line is invalid. Keep server error handling for stale availability.

- [x] **Step 4: Update create/edit page guidance**

Replace the old “not cut until issue” helper with “ระบบกันยอดไว้ระหว่างรอจ่าย และตัดยอดจริงเมื่อเจ้าหน้าที่คลังจ่าย” and make the empty state distinguish no physical stock from no unreserved stock.

- [x] **Step 5: Run form-focused tests and typecheck**

Run `npx tsx scripts/requisition-ui.test.ts && npx tsc --noEmit`. Expected: PASS.

### Task 4: Remove the invalid cross-unit total and align operational UI

**Files:**
- Modify: `app/(protected)/requisitions/page.tsx`
- Modify: `app/(protected)/requisitions/[id]/page.tsx`
- Modify: `components/requisitions/RequisitionSummaryDialog.tsx`
- Modify: `app/globals.css`

**Interfaces:**
- Do not add a new cross-unit arithmetic total.
- Use existing status chips, table tokens, and responsive patterns.

- [x] **Step 1: Add failing copy/source assertions**

Require `จำนวนรายการ`/operational picking facts and assert that no component reduces requested quantities across units for display.

- [x] **Step 2: Replace the header metric with picking work**

Use the line count as the primary workload summary; retain per-line quantity/unit and lot fields. Show the reservation lifecycle as a fact (`กันยอดแล้ว`, `ใช้ยอดกันแล้ว`, or `คืนยอดแล้ว`) instead of a redundant readiness badge.

- [x] **Step 3: Update list and summary dialog**

Remove `รวมที่ขอ` columns/facts and keep status, requested date, requester, line count, and per-line quantities. Do not duplicate reservation status as if it were a separate fulfillment state.

- [x] **Step 4: Refine responsive states**

Keep desktop table density, expose reservation blockers inline on create/edit, keep lot-selection feedback near the action, preserve 44px controls, and avoid adding decorative motion.

- [x] **Step 5: Run UI contracts and diff check**

Run `npx tsx scripts/requisition-ui.test.ts && git diff --check`.

### Task 5: Verify database and application behavior

**Files:**
- Inspect all changed files and generated migration.

- [x] **Step 1: Run migration lint or local database verification**

Attempted `supabase db lint --local`; local Postgres was unavailable because Docker/Supabase was not running. Static migration contracts remain green; live SQL/concurrency was not claimed.

- [x] **Step 2: Run focused domain and UI tests**

Run `npm run test:requisitions` and the new reservation test. Confirm the legacy fulfillment concurrency contract remains green.

- [x] **Step 3: Run quality gates**

Run `npm run lint`, `npm run typecheck`, `npm run build`, and the applicable repository verification command.

- [x] **Step 4: Run Impeccable detector once after UI edits**

Run:

```powershell
node 'D:\Claude workspace\lab-management-portal\.agents\skills\impeccable\scripts\detect.mjs' --json 'components/requisitions/RequisitionForm.tsx' 'app/(protected)/requisitions/page.tsx' 'app/(protected)/requisitions/[id]/page.tsx' 'components/requisitions/RequisitionSummaryDialog.tsx' 'app/globals.css'
```

- [x] **Step 5: Review status and hand off**

Run `git diff --check` and `git status --short`; report changed files, test results, and whether the migration was only prepared or also applied to a database.
