# Annual Plans and Stock Officer Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** เพิ่มโมดูล `แผนประจำปี` สำหรับ PDF แผนจัดซื้อ/จัดจ้าง และทำให้ `stock_officer` จัดการสิทธิ์ผู้ใช้งานที่ไม่ใช่ `admin` ได้บน `main` โดยมี hard-delete retention ครบวงจร

**Architecture:** สร้าง domain `lib/annual-plans` แยกจาก contracts/inventory ใช้ private Supabase Storage และ PostgreSQL RPC สำหรับ upsert, audit และ hard-delete retention. หน้า `/annual-plans` เป็น Server Component ที่อ่านข้อมูล 2 ปีงบประมาณ แล้วส่งให้ client card/dropzone/preview components; navigation จัดกลุ่ม `/settings/access` ใต้ `เจ้าหน้าที่คลัง` และ authorization ตรวจซ้ำที่ server/RPC.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Supabase/Postgres/Storage, Zod, CSS ใน `app/globals.css`, source-contract tests ด้วย `tsx`, existing Vercel daily cleanup cron.

## Global Constraints

- ทำงานบน branch `main` โดยตรง; ห้ามสร้าง worktree หรือ branch แยก
- ใช้ TDD red-green-refactor: production behavior ใหม่ต้องมี failing test ก่อน implementation
- โมดูล `แผนประจำปี` อยู่ถัดจาก `Dashboard` และใช้ภาษาไทยเต็มรูปแบบ
- แสดง/อัปโหลดเฉพาะปีงบประมาณปัจจุบันและปีก่อนหน้า; อัปโหลดซ้ำใน slot เดิมแทนที่ไฟล์เดิม
- รับเฉพาะ PDF ไม่เกิน 25 MB และใช้ private bucket/signed URL
- ไฟล์เก่าและ row เอกสารต้อง hard delete; ไม่มี `deleted_at`, recycle bin หรือ soft-deleted document state
- audit log เก็บเหตุการณ์และ metadata ที่จำเป็น แต่ไม่เก็บ binary content
- `admin` แก้ role ได้ทุกชนิด; `stock_officer` แก้ได้เฉพาะ `head`, `stock_officer`, `viewer` และห้ามมอบ/ถอน `admin`
- ผู้ใช้ active ทุก role ดู/เปิด/ดาวน์โหลดแผนได้; เฉพาะ `admin`/`stock_officer` อัปโหลดหรือแทนที่ได้
- คง visual language `Laboratory Control Bench`, Noto Sans Thai, semantic tokens, no gradient/emoji icons, 44px targets, responsive 375/768/1024/1440px
- เปลี่ยน cleanup cron เดิมเท่าที่จำเป็น; ไม่สร้าง external integration หรือเปลี่ยน business logic domain อื่น

## File map

Create these focused files:

- `lib/annual-plans/fiscal.ts` — Bangkok fiscal-year arithmetic and retained-year slots
- `lib/annual-plans/schema.ts` — plan type, upload input, file metadata validation
- `lib/annual-plans/types.ts` — database/read model and slot types
- `lib/annual-plans/files.ts` — bucket, MIME/size constants, safe path builder/validator
- `lib/annual-plans/authorization.ts` — upload/read/retention permission assertions
- `lib/annual-plans/presenter.ts` — Thai labels and display formatting
- `lib/annual-plans/queries.ts` — server-only list/read functions
- `lib/annual-plans/actions.ts` — server actions for upload and signed URLs
- `lib/annual-plans/cleanup.ts` — retention hard-delete and retry orchestration
- `components/annual-plans/AnnualPlanGrid.tsx` — client grid and dialog/upload state
- `components/annual-plans/AnnualPlanCard.tsx` — one fiscal-year/plan-type working card
- `components/annual-plans/AnnualPlanUploadDropzone.tsx` — accessible drag/drop and file input
- `components/annual-plans/AnnualPlanPreviewDialog.tsx` — inline PDF dialog and focus handling
- `app/(protected)/annual-plans/page.tsx` — protected server page
- `app/api/annual-plans/upload/route.ts` — multipart upload route used for progress-capable uploads

Modify these existing files:

- `components/ui/AppShell.tsx` — add annual-plan item and role-gated nested stock-officer group
- `app/globals.css` — annual-plan cards/dropzone/preview and nested navigation states
- `lib/access/authorization.ts`, `lib/access/actions.ts`, `lib/access/queries.ts` — membership manager boundary
- `components/settings/AccessMatrix.tsx` — non-admin role editing for stock officers and read-only admin state
- `app/api/internal/storage-cleanup/route.ts`, `lib/storage/cleanup-jobs.ts` — annual-plan retention retry
- `supabase/migrations/20260825180000_lab_stock_membership_manager.sql` — RPC guard expansion
- `supabase/migrations/20260825181000_lab_stock_annual_plans.sql` — annual plan table, audit, bucket, policies and RPCs
- `scripts/app-shell-contract.test.ts`, `scripts/access-ui.test.ts`, `scripts/access-policy.test.ts`, `scripts/storage-cleanup.test.ts`, `package.json`

Create focused test files:

- `scripts/annual-plans-fiscal.test.ts`
- `scripts/annual-plans-files.test.ts`
- `scripts/annual-plans-schema.test.ts`
- `scripts/annual-plans-schema-sql.test.ts`
- `scripts/annual-plans-ui.test.ts`
- `scripts/annual-plans-action.test.ts`

---

### Task 1: Define fiscal-year, slot, and file validation contracts

**Files:**
- Create: `scripts/annual-plans-fiscal.test.ts`
- Create: `scripts/annual-plans-files.test.ts`
- Create: `scripts/annual-plans-schema.test.ts`
- Create: `lib/annual-plans/fiscal.ts`
- Create: `lib/annual-plans/files.ts`
- Create: `lib/annual-plans/schema.ts`
- Create: `lib/annual-plans/types.ts`
- Create: `lib/annual-plans/presenter.ts`

**Interfaces:**
- `fiscalYearOfDate(date: Date): number`
- `retainedFiscalYears(date: Date): [number, number]`
- `isRetainedFiscalYear(fiscalYear: number, date?: Date): boolean`
- `ANNUAL_PLAN_TYPES = ['procurement', 'hiring'] as const`
- `annualPlanFilePath(fiscalYear: number, planType: AnnualPlanType, fileName: string): string`
- `isAnnualPlanFilePathAllowed(path: string, fiscalYear: number, planType: AnnualPlanType): boolean`
- `validateAnnualPlanFile(file: File): Promise<void>`
- `annualPlanInputSchema` validates `{ fiscalYear, planType }`

- [ ] **Step 1: Write failing fiscal-year tests**

```ts
import assert from 'node:assert/strict'
import { fiscalYearOfDate, isRetainedFiscalYear, retainedFiscalYears } from '@/lib/annual-plans/fiscal'

const bangkok = (value: string) => new Date(`${value}+07:00`)

assert.equal(fiscalYearOfDate(bangkok('2026-09-30T23:59:59')), 2569)
assert.equal(fiscalYearOfDate(bangkok('2026-10-01T00:00:00')), 2570)
assert.deepEqual(retainedFiscalYears(bangkok('2026-10-01T08:00:00')), [2570, 2569])
assert.equal(isRetainedFiscalYear(2568, bangkok('2026-10-01T08:00:00')), false)
console.log('annual plan fiscal: ok')
```

- [ ] **Step 2: Run the fiscal test and verify the missing-module failure**

Run: `npx tsx scripts/annual-plans-fiscal.test.ts`

Expected: FAIL because `lib/annual-plans/fiscal.ts` does not exist yet.

- [ ] **Step 3: Write failing file/path/schema tests**

```ts
import assert from 'node:assert/strict'
import { annualPlanFilePath, isAnnualPlanFilePathAllowed, MAX_ANNUAL_PLAN_FILE_SIZE_BYTES } from '@/lib/annual-plans/files'
import { annualPlanInputSchema, ANNUAL_PLAN_TYPES } from '@/lib/annual-plans/schema'

const path = annualPlanFilePath(2570, 'procurement', 'แผน/../../plan.pdf')
assert.equal(ANNUAL_PLAN_TYPES.length, 2)
assert.equal(isAnnualPlanFilePathAllowed(path, 2570, 'procurement'), true)
assert.equal(path.includes('..'), false)
assert.equal(isAnnualPlanFilePathAllowed(path.replace('/procurement/', '/hiring/'), 2570, 'procurement'), false)
assert.equal(MAX_ANNUAL_PLAN_FILE_SIZE_BYTES, 25 * 1024 * 1024)
assert.equal(annualPlanInputSchema.safeParse({ fiscalYear: 2570, planType: 'procurement' }).success, true)
assert.equal(annualPlanInputSchema.safeParse({ fiscalYear: 2570, planType: 'unknown' }).success, false)
console.log('annual plan files/schema: ok')
```

- [ ] **Step 4: Run the file/schema test and verify it fails for the intended reason**

Run: `npx tsx scripts/annual-plans-files.test.ts && npx tsx scripts/annual-plans-schema.test.ts`

Expected: FAIL on missing exports, not on a TypeScript configuration error.

- [ ] **Step 5: Implement the pure domain helpers**

Use the existing Thai fiscal rule: October starts the next Buddhist fiscal year. `fiscalYearOfDate` must read `Asia/Bangkok` with `Intl.DateTimeFormat`, not the machine timezone. `annualPlanFilePath` must sanitize to one basename segment and emit `annual-plans/${fiscalYear}/${planType}/${uuid}-${safeName}`. `validateAnnualPlanFile` must reject zero bytes, non-PDF MIME/extension, files above 25 MB, and a missing `%PDF` header.

- [ ] **Step 6: Run the focused tests and commit the pure domain**

Run: `npx tsx scripts/annual-plans-fiscal.test.ts && npx tsx scripts/annual-plans-files.test.ts && npx tsx scripts/annual-plans-schema.test.ts`

Expected: PASS with no warnings.

Commit:

```bash
git add lib/annual-plans scripts/annual-plans-fiscal.test.ts scripts/annual-plans-files.test.ts scripts/annual-plans-schema.test.ts
git commit -m "feat: define annual plan domain contracts"
```

### Task 2: Add the annual-plan database, bucket, policies, and RPCs

**Files:**
- Create: `scripts/annual-plans-schema-sql.test.ts`
- Create: `supabase/migrations/20260825181000_lab_stock_annual_plans.sql`
- Modify: `scripts/storage-policy.test.ts` if its storage path assertions are the shared place for new buckets

**Interfaces:**
- RPC `upsert_lab_stock_annual_plan(p_actor_id uuid, p_fiscal_year integer, p_plan_type text, p_file_path text, p_file_name text, p_file_mime_type text, p_file_size_bytes integer)` returns the active row plus `previous_file_path`
- RPC `hard_delete_lab_stock_annual_plan(p_plan_id uuid, p_actor_id uuid, p_file_path text)` deletes the exact row after cleanup and inserts the append-only audit event
- RPC `list_expired_lab_stock_annual_plans(p_current_fiscal_year integer)` returns id, fiscal year, plan type and exact file path for rows below `current - 1`
- bucket id: `lab-stock-annual-plans`

- [ ] **Step 1: Write failing SQL contract assertions**

```ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const sql = readFileSync('supabase/migrations/20260825181000_lab_stock_annual_plans.sql', 'utf8')
assert.match(sql, /create table public\.lab_stock_annual_plans/)
assert.match(sql, /unique \(fiscal_year, plan_type\)/)
assert.match(sql, /lab-stock-annual-plans/)
assert.match(sql, /application\/pdf/)
assert.match(sql, /upsert_lab_stock_annual_plan/)
assert.match(sql, /hard_delete_lab_stock_annual_plan/)
assert.match(sql, /retention_hard_deleted/)
assert.match(sql, /annual-plans\/%/)
assert.doesNotMatch(sql, /deleted_at/)
console.log('annual plan SQL contract: ok')
```

- [ ] **Step 2: Run the SQL contract to verify RED**

Run: `npx tsx scripts/annual-plans-schema-sql.test.ts`

Expected: FAIL because the migration file does not exist.

- [ ] **Step 3: Implement the schema and policies**

Create the table and append-only audit table with the exact columns in the approved spec. Create the private bucket with a 25 MB limit and PDF MIME restriction. Grant authenticated read and service-role writes; add defense-in-depth storage policies for active users and `admin`/`stock_officer`, with no authenticated delete policy. Add the unique `(fiscal_year, plan_type)` constraint and checks for `procurement`/`hiring`, PDF MIME, and 25 MB.

- [ ] **Step 4: Implement `upsert_lab_stock_annual_plan`**

The function must:

1. call the shared membership-manager predicate for `p_actor_id` and require `admin` or `stock_officer` for upload;
2. reject a fiscal year outside the current/previous Bangkok fiscal years;
3. validate plan type, path namespace, PDF MIME and size;
4. lock the existing slot, upsert the new metadata, and insert `uploaded` or `replaced` audit metadata;
5. return the new row and the previous path without deleting Storage inside Postgres.

- [ ] **Step 5: Implement hard-delete RPCs and grants**

`hard_delete_lab_stock_annual_plan` must lock by id, verify the supplied path exactly matches the row, delete the row (not update a flag), insert `retention_hard_deleted`, and return the deleted path. `list_expired_lab_stock_annual_plans` must return only rows older than `current - 1`. Revoke all public/anon/authenticated execution and grant only service role, following existing migration style.

- [ ] **Step 6: Run SQL/storage tests and commit**

Run: `npx tsx scripts/annual-plans-schema-sql.test.ts && npx tsx scripts/storage-policy.test.ts`

Expected: PASS. Then run `git diff --check`.

Commit:

```bash
git add supabase/migrations/20260825181000_lab_stock_annual_plans.sql scripts/annual-plans-schema-sql.test.ts scripts/storage-policy.test.ts
git commit -m "feat: add annual plan storage and retention schema"
```

### Task 3: Expand membership management safely to stock officers

**Files:**
- Create: `supabase/migrations/20260825180000_lab_stock_membership_manager.sql`
- Modify: `lib/access/authorization.ts`
- Modify: `lib/access/actions.ts`
- Modify: `lib/access/queries.ts`
- Modify: `components/settings/AccessMatrix.tsx`
- Modify: `scripts/access-policy.test.ts`
- Modify: `scripts/access-ui.test.ts`

**Interfaces:**
- `canManageMemberships(actor: Actor): boolean` returns true for `admin` or `stock_officer`
- `assertMembershipManager(actor: Actor): void` throws for other roles
- `canChangeMembershipRole(actor: Actor, role: LabStockRoleName): boolean` returns false for `stock_officer + admin`
- `setMembership` rejects a stock officer attempting role `admin` before the RPC and the RPC rejects it again

- [ ] **Step 1: Write failing authorization/UI assertions**

Add to `scripts/access-policy.test.ts`:

```ts
const authorization = read('lib/access/authorization.ts')
const actions = read('lib/access/actions.ts')
const migration = read('supabase/migrations/20260825180000_lab_stock_membership_manager.sql')
assert.match(authorization, /canManageMemberships|assertMembershipManager/)
assert.match(actions, /canChangeMembershipRole|stock_officer/)
assert.match(migration, /stock_officer/)
assert.match(migration, /p_role.*admin|admin.*stock_officer/)
```

Add to `scripts/access-ui.test.ts`:

```ts
assert.match(matrix, /สงวนสิทธิ์สำหรับผู้ดูแลระบบ/)
assert.match(matrix, /canChangeMembershipRole|isMembershipManager/)
```

- [ ] **Step 2: Run the access tests and verify RED**

Run: `npx tsx scripts/access-policy.test.ts && npx tsx scripts/access-ui.test.ts`

Expected: FAIL because the manager boundary and read-only admin state do not exist.

- [ ] **Step 3: Implement the pure/server authorization boundary**

Keep `canAdministerMemberships` for callers that specifically mean full admin management, add `canManageMemberships` for the page/query, and make `assertMembershipManager` the defense used by `listMemberships` and `setMembership`. In `setMembership`, parse input first, then reject `role === 'admin'` when `actor.appRoles` lacks `admin` before invoking Supabase.

- [ ] **Step 4: Replace the membership RPC guard in the migration**

Create a forward-only `create or replace function public.set_lab_stock_membership(...)` migration that uses a manager predicate allowing `admin`/`stock_officer`, but raises `42501` when `p_role = 'admin'` and the actor is not an admin. Preserve existing audit inserts, intrinsic role behavior, and service-role-only execute grants.

- [ ] **Step 5: Update the access page and matrix**

Change `app/(protected)/settings/access/page.tsx` to use `canManageMemberships`. Pass `canManageAdminRole={actor.appRoles.includes('admin')}` and `canManageMemberships={true}` to `AccessMatrix`. Keep intrinsic roles disabled. For a stock officer, render the `admin` checkbox disabled/read-only with helper text, while toggles for `head`, `stock_officer`, and `viewer` call the existing `setMembership` action.

- [ ] **Step 6: Run access tests and commit**

Run: `npx tsx scripts/access-policy.test.ts && npx tsx scripts/access-ui.test.ts && npm run test:access`

Expected: PASS; a stock officer cannot reach the admin toggle through either UI or action boundary.

Commit:

```bash
git add supabase/migrations/20260825180000_lab_stock_membership_manager.sql lib/access lib/auth/access.ts components/settings/AccessMatrix.tsx scripts/access-policy.test.ts scripts/access-ui.test.ts
git commit -m "feat: let stock officers manage non-admin roles"
```

### Task 4: Implement annual-plan queries, upload actions, signed URLs, and retention cleanup

**Files:**
- Create: `lib/annual-plans/authorization.ts`
- Create: `lib/annual-plans/queries.ts`
- Create: `lib/annual-plans/actions.ts`
- Create: `lib/annual-plans/cleanup.ts`
- Create: `app/api/annual-plans/upload/route.ts`
- Create: `scripts/annual-plans-action.test.ts`
- Modify: `lib/storage/cleanup-jobs.ts`
- Modify: `app/api/internal/storage-cleanup/route.ts`

**Interfaces:**
- `listAnnualPlanSlots(actor: Actor, now?: Date): Promise<AnnualPlanYearGroup[]>`
- `storeAnnualPlan(fiscalYear: number, planType: AnnualPlanType, file: File): Promise<{ planId: string; previousFilePath: string | null }>`
- `uploadAnnualPlan(formData: FormData): Promise<{ planId: string }>`
- `annualPlanFileUrl(planId: string, mode: 'inline' | 'download'): Promise<string>`
- `cleanupExpiredAnnualPlans(systemActorId: string): Promise<{ deleted: number; queued: number }>`
- `retryAnnualPlanHardDelete(planId: string, expectedPath: string, systemActorId: string): Promise<void>`

- [ ] **Step 1: Write failing action contract tests**

```ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(path, 'utf8')
const actions = read('lib/annual-plans/actions.ts')
const cleanup = read('lib/annual-plans/cleanup.ts')
const route = read('app/api/annual-plans/upload/route.ts')
assert.match(actions, /requireActor/)
assert.match(actions, /validateAnnualPlanFile/)
assert.match(actions, /supabaseAdmin\.storage/)
assert.match(actions, /upsert_lab_stock_annual_plan/)
assert.match(actions, /createSignedUrl/)
assert.match(cleanup, /hard_delete_lab_stock_annual_plan/)
assert.match(cleanup, /enqueueStorageCleanupJobBestEffort/)
assert.match(route, /storeAnnualPlan/)
assert.match(route, /FormData/)
console.log('annual plan actions: ok')
```

- [ ] **Step 2: Run the action test and verify RED**

Run: `npx tsx scripts/annual-plans-action.test.ts`

Expected: FAIL because the domain actions/route do not exist.

- [ ] **Step 3: Implement read authorization and slot queries**

`listAnnualPlanSlots` must call `requireActor`/verify the passed actor, derive `[current, previous]` with `retainedFiscalYears`, read only those rows through the service-role server client, join uploader display names, and return four stable slots even when rows are missing. Do not pass raw Storage paths to the browser; expose plan id and metadata only.

- [ ] **Step 4: Implement the upload flow**

`storeAnnualPlan` must call `requireActor`, `assertAnnualPlanUploader`, parse fiscal year/type with Zod, validate the File including `%PDF`, generate a unique safe path, upload with `upsert: false`, invoke the upsert RPC, remove the returned previous path, and enqueue `storage_upload_rollback` if any object removal fails. If the RPC fails, remove the new object or enqueue its orphan cleanup before throwing a Thai error.

`uploadAnnualPlan` must accept a `FormData` containing `file`, `fiscalYear`, and `planType`, call the same helper, and `revalidatePath('/annual-plans')`.

- [ ] **Step 5: Implement signed preview/download URLs**

`annualPlanFileUrl` must resolve the authenticated actor, load the plan by id with service role, validate its stored path with `isAnnualPlanFilePathAllowed`, and call `createSignedUrl` with a short expiry. Use `inline` for preview and the original filename as the download disposition for `download`; never return a public URL.

- [ ] **Step 6: Implement hard-delete retention and retries**

`cleanupExpiredAnnualPlans` must use the system actor, call the expired-row RPC, delete each exact Storage object idempotently, call the hard-delete RPC only after the object deletion step, and enqueue an idempotent retry if the RPC or Storage operation fails. Do not add `deleted_at` or hide a failed deletion as success.

Extend `StorageCleanupJobKind` and the SQL job check constraint with `annual_plan_retention_retry`. In `app/api/internal/storage-cleanup/route.ts`, route that job to `retryAnnualPlanHardDelete`, which rechecks plan id/path before deleting so a replacement cannot delete the new file. Run retention once per daily cron invocation before/after the existing queue batch and include counts in the JSON response without breaking existing jobs.

- [ ] **Step 7: Run action tests and commit**

Run: `npx tsx scripts/annual-plans-action.test.ts && npm run test:storage-cleanup`

Expected: PASS with existing cleanup behavior unchanged.

Commit:

```bash
git add lib/annual-plans app/api/annual-plans app/api/internal/storage-cleanup/route.ts lib/storage/cleanup-jobs.ts scripts/annual-plans-action.test.ts supabase/migrations
git commit -m "feat: add annual plan upload and hard-delete lifecycle"
```

### Task 5: Build the annual-plan UI with accessible upload and inline preview

**Files:**
- Create: `components/annual-plans/AnnualPlanUploadDropzone.tsx`
- Create: `components/annual-plans/AnnualPlanPreviewDialog.tsx`
- Create: `components/annual-plans/AnnualPlanCard.tsx`
- Create: `components/annual-plans/AnnualPlanGrid.tsx`
- Create: `app/(protected)/annual-plans/page.tsx`
- Create: `scripts/annual-plans-ui.test.ts`
- Modify: `app/globals.css`

**Interfaces:**
- `AnnualPlanGrid({ groups, canManage }: { groups: AnnualPlanYearGroup[]; canManage: boolean })`
- `AnnualPlanCard({ slot, canManage, onPreview }: { slot: AnnualPlanSlot; canManage: boolean; onPreview: (planId: string) => void })`
- `AnnualPlanUploadDropzone({ fiscalYear, planType, existingFile, onUploaded }: ...)`
- `AnnualPlanPreviewDialog({ planId, fileName, open, onClose }: ...)`

- [ ] **Step 1: Write failing UI source contracts**

```ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(path, 'utf8')
const page = read('app/(protected)/annual-plans/page.tsx')
const grid = read('components/annual-plans/AnnualPlanGrid.tsx')
const dropzone = read('components/annual-plans/AnnualPlanUploadDropzone.tsx')
const dialog = read('components/annual-plans/AnnualPlanPreviewDialog.tsx')
const css = read('app/globals.css')
assert.match(page, /แผนประจำปี/)
assert.match(page, /retainedFiscalYears|listAnnualPlanSlots/)
assert.match(grid, /AnnualPlanCard/)
assert.match(dropzone, /application\/pdf/)
assert.match(dropzone, /onDragEnter|onDrop/)
assert.match(dropzone, /type="file"/)
assert.match(dropzone, /role="alert"|aria-live/)
assert.match(dialog, /iframe/)
assert.match(dialog, /ดาวน์โหลด/)
assert.match(dialog, /onCancel/)
assert.match(css, /annual-plan/)
console.log('annual plan UI: ok')
```

- [ ] **Step 2: Run the UI test and verify RED**

Run: `npx tsx scripts/annual-plans-ui.test.ts`

Expected: FAIL because the page/components/styles do not exist.

- [ ] **Step 3: Implement the server page and stable slot rendering**

`AnnualPlansPage` calls `requireActor`, `listAnnualPlanSlots`, and passes `canOperateStock(actor)` to the client grid. Render the approved `page-heading`, helper copy, and one heading per fiscal year with exactly two plan cards in the fixed order procurement then hiring. Use presenter labels `แผนจัดซื้อ` and `แผนจัดจ้าง`.

- [ ] **Step 4: Implement the card/dropzone states**

Use a visually large `<label>`/dropzone plus a real hidden input and visible `เลือกไฟล์ PDF` button. Handle click, keyboard, drag enter/leave/drop through one `validateAnnualPlanFile`-compatible client path. Use a 44px target, `aria-describedby`, `aria-busy`, `aria-live="polite"`, `role="alert"` for errors, and disable concurrent actions while uploading. For replacement, show a native confirmation dialog or existing app dialog text before sending the file.

- [ ] **Step 5: Implement the preview dialog**

Use the existing `.app-dialog` and `.file-preview-dialog` pattern. When opened, call `annualPlanFileUrl(planId, 'inline')`, show a loading state, render `<iframe title={...} src={url}>`, and expose `ดาวน์โหลด`, `เปิดแท็บใหม่`, and an icon-labeled close button. Handle Escape via `onCancel`, close after route changes, and provide a fallback link if the iframe cannot render.

- [ ] **Step 6: Add responsive LABCBH styling**

Add semantic classes such as `.annual-plan-groups`, `.annual-plan-group`, `.annual-plan-grid`, `.annual-plan-card`, `.annual-plan-dropzone`, and `.annual-plan-preview-dialog`. Reuse `--lab-*`, `--radius-*`, and existing dialog tokens. Desktop uses two columns; below the existing mobile breakpoint collapse to one. Preserve focus-visible outlines, reduced-motion behavior, filename `overflow-wrap:anywhere`, and no decorative gradient/shadow.

- [ ] **Step 7: Run the UI test and commit**

Run: `npx tsx scripts/annual-plans-ui.test.ts && git diff --check`

Expected: PASS with no whitespace errors.

Commit:

```bash
git add app/'(protected)'/annual-plans components/annual-plans app/globals.css scripts/annual-plans-ui.test.ts
git commit -m "feat: add annual plan upload and preview workspace"
```

### Task 6: Add the approved navigation hierarchy and role-gated visibility

**Files:**
- Modify: `components/ui/AppShell.tsx`
- Modify: `app/globals.css`
- Modify: `scripts/app-shell-contract.test.ts`

**Interfaces:**
- `navigation` keeps existing flat item behavior for operational routes
- add `annualPlansNavigation` after Dashboard
- add a role-gated `stockOfficerNavigation` group with `/settings/access` child
- `visibleNavigation`/active route calculation must include nested child paths for both `admin` and `stock_officer`

- [ ] **Step 1: Write failing shell contracts**

Add assertions:

```ts
assert.match(shell, /href: '\/annual-plans', label: 'แผนประจำปี'/)
assert.match(shell, /เจ้าหน้าที่คลัง/)
assert.match(shell, /stock_officer/)
assert.match(shell, /\/settings\/access/)
assert.match(shell, /สิทธิ์ผู้ใช้งาน/)
```

- [ ] **Step 2: Run the shell test and verify RED**

Run: `npx tsx scripts/app-shell-contract.test.ts`

Expected: FAIL because the annual-plan and nested stock-officer navigation are absent.

- [ ] **Step 3: Implement nested navigation without breaking mobile/collapsed behavior**

Add an SVG icon entry for annual plans and a consistent stock-officer icon. Render the `แผนประจำปี` link immediately after Dashboard. Render a visible group label and child link when `actor.appRoles.includes('admin') || actor.appRoles.includes('stock_officer')`. Keep `aria-current`, collapsed labels/titles, mobile close behavior, and current header context correct for `/settings/access`.

- [ ] **Step 4: Style the group and active child**

Reuse `.bench-nav__section` rhythm; add only nested child indentation/active styles and collapsed-state rules. Keep the group visible in mobile drawer and ensure the child remains a 44px target.

- [ ] **Step 5: Run app-shell/access tests and commit**

Run: `npx tsx scripts/app-shell-contract.test.ts && npx tsx scripts/access-ui.test.ts && npm run test:app-shell`

Expected: PASS; all existing navigation, theme, avatar, progress and portal-return contracts remain green.

Commit:

```bash
git add components/ui/AppShell.tsx app/globals.css scripts/app-shell-contract.test.ts
git commit -m "feat: add annual plans and stock officer navigation"
```

### Task 7: Wire package scripts, cleanup coverage, and full verification

**Files:**
- Modify: `package.json`
- Modify: `scripts/storage-cleanup.test.ts`
- Inspect: all files changed by Tasks 1–6

- [ ] **Step 1: Add focused scripts**

Add one focused command without reformatting unrelated script entries:

```json
"test:annual-plans": "tsx scripts/annual-plans-fiscal.test.ts && tsx scripts/annual-plans-files.test.ts && tsx scripts/annual-plans-schema.test.ts && tsx scripts/annual-plans-schema-sql.test.ts && tsx scripts/annual-plans-action.test.ts && tsx scripts/annual-plans-ui.test.ts"
```

Include `npm run test:annual-plans` in `verify` immediately before `npm run test:storage-cleanup`.

- [ ] **Step 2: Run focused regression suites**

Run: `npm run test:annual-plans && npm run test:access && npm run test:app-shell && npm run test:storage-cleanup`

Expected: PASS; failures must be fixed in production code/tests, never masked by weakening assertions.

- [ ] **Step 3: Run repository quality gates**

Run: `npm run lint`

Expected: exit 0 with no new warnings.

Run: `npm run typecheck`

Expected: exit 0.

Run: `npm run build`

Expected: production build completes with `/annual-plans` included and no route/type errors.

- [ ] **Step 4: Run visual/accessibility verification**

Start the existing Next dev server if not running and inspect `/annual-plans` as a viewer and as a stock officer at 375px, 768px, 1024px and 1440px. Verify keyboard-only upload/preview, focus return after dialog close, reduced motion, no horizontal scroll, and role-specific menu/toggle visibility.

Run the required detector once over the changed UI files:

```bash
node C:\Users\User\.agents\skills\impeccable\scripts\detect.mjs --json components/ui/AppShell.tsx components/settings/AccessMatrix.tsx components/annual-plans/AnnualPlanCard.tsx components/annual-plans/AnnualPlanGrid.tsx components/annual-plans/AnnualPlanPreviewDialog.tsx components/annual-plans/AnnualPlanUploadDropzone.tsx app/'(protected)'/annual-plans/page.tsx app/globals.css
```

Expected: review every finding, fix real findings in one bounded pass, then rerun only if fixes changed the inspected UI targets.

- [ ] **Step 5: Run final diff/status check and commit**

Run: `git diff --check; git status --short; git log -5 --oneline --decorate`

Expected: only intended feature files are changed and no generated secrets/build artifacts are staged.

Commit:

```bash
git add app components lib scripts supabase/migrations package.json
git commit -m "feat: add annual plans and stock officer module"
```

## Self-review checklist

- Spec coverage: navigation, two-year slots, both plan types, PDF-only validation, drag/drop plus keyboard fallback, inline preview/download, signed URLs, replacement, hard delete, retention cron, stock-officer non-admin membership management, audit logging, tests and visual detector are each assigned above.
- Placeholder scan: this plan contains no unfinished markers or unspecified “handle later” step.
- Type consistency: `AnnualPlanType`, `AnnualPlanSlot`, `retainedFiscalYears`, `annualPlanFilePath`, `storeAnnualPlan`, `annualPlanFileUrl`, `cleanupExpiredAnnualPlans`, `canManageMemberships`, `assertMembershipManager`, and `canChangeMembershipRole` are named consistently across tasks.
- Main-branch constraint: every commit is intended for the existing `main` branch; no worktree/branch step is included.
