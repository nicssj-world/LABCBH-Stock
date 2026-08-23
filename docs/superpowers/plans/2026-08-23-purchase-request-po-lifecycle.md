# Purchase Request PO Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Each task follows the repository's TDD requirement and ends with a focused commit.

**Goal:** Make the PR the source of truth for the PO number and temporary PO file, remove PO attachment from receipt creation/detail, and hard-delete PO objects only when the linked PR reaches `received` or `closed_short`, while preserving an audit trace on the PR.

**Architecture:** Move reusable PO file validation, preparation, and path guards into a neutral `lib/po` boundary. Add PR-owned metadata and RPCs in one forward-only Supabase migration. The PR detail gets the only upload/view UI; receipt actions derive PO from the locked PR and call a retry-safe server-side cleanup helper after terminal receiving transitions.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Supabase/Postgres RPCs, Supabase private Storage, zod, plain `tsx` contract tests, Playwright.

## Global Constraints

- Work directly on `main`; do not create a worktree or branch for this change.
- All database writes go through Postgres RPCs invoked with `supabaseAdmin`; application code must not write tables directly.
- Migrations are forward-only; create a new migration and do not edit an applied migration.
- Keep the PO bucket private and expose no client-side storage delete policy.
- Accepted PO MIME types are `image/jpeg`, `image/png`, `image/webp`, and `application/pdf`; maximum size is 10 MB.
- Use Thai user-facing copy and the existing LABCBH Stock `bench-panel`, `identifier`, `Button`, dialog, and semantic color tokens.
- Keep interactive targets at least 44px, preserve visible keyboard focus, and do not convey file state by color alone.
- Do not change receipt line validation, lot creation, FIFO rules, posting rules, or PR reversal rules.
- Do not modify or stage the existing unrelated untracked files in `docs/reports/`, `docs/superpowers/plans/2026-08-23-staging-schema-drift-reconciliation.md`, or `scripts/staging-schema-drift.test.ts`.

## File Map

Create:

- `supabase/migrations/20260823220000_purchase_request_po_file_lifecycle.sql` — PR PO metadata, file RPCs, PO derivation in receipt creation, and terminal-state guards/backfill.
- `lib/po/storage.ts` — neutral PO bucket constants, MIME/size checks, PR paths, and legacy receipt-path guards.
- `lib/po/file.ts` — browser-side image preparation and file-size presentation moved out of the receipt domain.
- `lib/po/cleanup.ts` — server-only, idempotent cleanup helper shared by receipt posting and PR short-close actions.
- `lib/pr/po-file-actions.ts` — PR PO upload, signed-URL, and cleanup-retry Server Actions.
- `components/po/PoFileDropzone.tsx` — shared PDF/image dropzone moved out of the receipt domain.
- `components/pr/PurchaseRequestPoFileCard.tsx` — PR detail upload/view/deleted-state UI.
- `scripts/po-file-lifecycle.test.ts` — path, lifecycle, SQL, and UI contract tests introduced before production changes.

Modify:

- `lib/receipts/schema.ts` — remove client-owned `poNumber` from receipt input.
- `lib/receipts/types.ts` — remove receipt-facing PO image ownership and add any derived PR PO link fields needed by the read model.
- `lib/receipts/queries.ts` — read the PO number from the embedded PR and retain legacy paths only for server-side cleanup compatibility.
- `lib/receipts/actions.ts` — remove receipt upload/preview actions and invoke terminal cleanup after posting.
- `lib/pr/types.ts` — add the PR PO-file audit record.
- `lib/pr/queries.ts` — select/map PR PO-file metadata and uploader/deleter names.
- `lib/pr/actions.ts` — invoke terminal cleanup after `close_purchase_request_remaining`.
- `components/pr/PrReviewPanel.tsx` — keep PO-number editing compatible with the new PR file card and prevent editing after terminal states.
- `app/(protected)/purchase-requests/[id]/page.tsx` — render the PR PO file card near the PO facts.
- `components/receipts/ReceiptForm.tsx` — remove manual PO/file state and render the selected PR PO as a read-only internal link.
- `app/(protected)/receipts/new/page.tsx` — change copy from receipt-owned attachment to PR-owned PO document.
- `app/(protected)/receipts/[id]/page.tsx` — link PO/PR context and remove `PO EVIDENCE`/upload failure UI.
- `app/globals.css` — move/reuse dropzone/card styles and add only the deleted/cleanup-pending state styles needed by the PR card.
- `scripts/pr-ui.test.ts` — assert the PR card and PO-file action contract.
- `scripts/receiving-ui.test.ts` — assert receipt creation/detail no longer own PO files and link back to PR.
- `scripts/receiving-schema.test.ts` — assert the new PR-owned columns and terminal cleanup SQL.
- `scripts/receiving-transaction.test.ts` — assert PO derivation and terminal lifecycle cleanup boundaries.
- `scripts/storage-policy.test.ts` — test PR-scoped paths while retaining private-bucket/no-client-delete guarantees.
- `package.json` — register the new focused test in `test:pr`/`test:receiving` without changing the full verify gate shape.

Delete after all imports/tests are migrated:

- `components/receipts/PoImageUploader.tsx` — receipt detail no longer owns PO upload/view.
- `components/receipts/PoFileDropzone.tsx` — replaced by the neutral shared component.
- `lib/receipts/po-file.ts` — replaced by `lib/po/file.ts`.
- `lib/receipts/storage.ts` — replaced by `lib/po/storage.ts`.

---

### Task 1: Add failing contract tests for PR ownership and terminal cleanup

**Files:**

- Create: `scripts/po-file-lifecycle.test.ts`
- Modify: `scripts/pr-ui.test.ts`
- Modify: `scripts/receiving-ui.test.ts`
- Modify: `scripts/receiving-schema.test.ts`
- Modify: `scripts/receiving-transaction.test.ts`
- Modify: `scripts/storage-policy.test.ts`
- Modify: `package.json`

**Interfaces:**

- The tests define the intended public names before they exist: `PurchaseRequestPoFileCard`, `uploadPurchaseRequestPoFile`, `getPurchaseRequestPoFileUrl`, `cleanupTerminalPurchaseRequestPoFile`, `buildPurchaseRequestPoFilePath`, and `isPurchaseRequestPoFilePathAllowed`.
- Implementation tasks must implement exactly those names or update all tests in the same red-green cycle.

- [ ] **Step 1: Write the failing tests.** Add these focused assertions to `scripts/po-file-lifecycle.test.ts`:

```ts
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const read = (path: string) => readFileSync(path, 'utf8')
const migrationsDir = join(process.cwd(), 'supabase', 'migrations')
const migration = readdirSync(migrationsDir).find((file) => file.includes('purchase_request_po_file_lifecycle'))
assert.ok(migration, 'the PR PO lifecycle migration must exist')
const sql = read(join(migrationsDir, migration!))

const prStorage = read('lib/po/storage.ts')
const prActions = read('lib/pr/po-file-actions.ts')
const cleanup = read('lib/po/cleanup.ts')
const prCard = read('components/pr/PurchaseRequestPoFileCard.tsx')

assert.match(prStorage, /buildPurchaseRequestPoFilePath/)
assert.match(prStorage, /isPurchaseRequestPoFilePathAllowed/)
assert.match(prStorage, /application\/pdf/)
assert.match(prStorage, /image\/jpeg|image\/png|image\/webp/)
assert.match(prActions, /uploadPurchaseRequestPoFile/)
assert.match(prActions, /getPurchaseRequestPoFileUrl/)
assert.match(cleanup, /cleanupTerminalPurchaseRequestPoFile/)
assert.match(cleanup, /received|closed_short/)
assert.match(prCard, /เปิดไฟล์ PO/)
assert.match(prCard, /ลบไฟล์แล้วหลังบันทึกเข้าคลัง/)
assert.match(sql, /po_file_path/)
assert.match(sql, /set_purchase_request_po_file/)
assert.match(sql, /clear_purchase_request_po_file/)
assert.match(sql, /poNumber.*unexpected|unexpected.*poNumber/i)
assert.match(sql, /locked_request\.po_number/)
assert.match(sql, /closed_short/)
```

Add the following negative UI assertions to the existing receiving tests:

```ts
assert.doesNotMatch(form, /PoFileDropzone|uploadPoImage|preparePoFile|poFile/)
assert.doesNotMatch(detailPage, /PO EVIDENCE|PoImageUploader|poUpload=failed/)
assert.match(form, /purchase-requests\/\$\{selectedRequest\.id\}/)
assert.match(form, /selectedRequest\.poNumber/)
```

Add the PR UI assertions:

```ts
const prPage = read('app/(protected)/purchase-requests/[id]/page.tsx')
assert.match(prPage, /PurchaseRequestPoFileCard/)
assert.match(prPage, /request\.poFile/)
```

- [ ] **Step 2: Register the new test.** Add `tsx scripts/po-file-lifecycle.test.ts` to both the PR and receiving test chains in `package.json` at the domain boundary where the new behavior is exercised.

- [ ] **Step 3: Run the new test to verify it fails for the intended reason.**

Run: `npx tsx scripts/po-file-lifecycle.test.ts`

Expected: FAIL because the new neutral storage/action/component files and migration do not exist yet. Do not create production files before seeing this failure.

- [ ] **Step 4: Commit the red tests.**

```bash
git add scripts/po-file-lifecycle.test.ts scripts/pr-ui.test.ts scripts/receiving-ui.test.ts scripts/receiving-schema.test.ts scripts/receiving-transaction.test.ts scripts/storage-policy.test.ts package.json
git commit -m "test: specify PR PO file lifecycle"
```

---

### Task 2: Move shared PO file utilities to a neutral boundary

**Files:**

- Create: `lib/po/storage.ts`
- Create: `lib/po/file.ts`
- Create: `components/po/PoFileDropzone.tsx`
- Modify: imports in `scripts/storage-policy.test.ts` and all PO-file consumers.
- Delete: `lib/receipts/storage.ts`, `lib/receipts/po-file.ts`, `components/receipts/PoFileDropzone.tsx` after import migration.

**Interfaces:**

```ts
export const PO_IMAGE_BUCKET = 'lab-stock-po'
export const PO_ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const
export const PO_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024

export function buildPurchaseRequestPoFilePath(input: {
  fiscalYear: number
  purchaseRequestId: string
  fileName: string
}): string

export function isPurchaseRequestPoFilePathAllowed(
  path: string,
  fiscalYear: number,
  purchaseRequestId: string,
): boolean

export function isLegacyReceiptPoImagePathAllowed(
  path: string,
  fiscalYear: number,
  receiptId: string,
): boolean

export function isPoFileTypeAllowed(fileType: string): fileType is (typeof PO_ALLOWED_MIME_TYPES)[number]
export async function preparePoFile(file: File): Promise<File>
export function formatPoFileSize(bytes: number): string
```

- [ ] **Step 1: Copy the existing pure preparation/dropzone behavior into the neutral modules.** Preserve PDF pass-through, image resize/recompression, 10 MB validation, drag/drop keyboard file selection, and the existing Thai messages. Change only imports and ownership names; do not add a new visual pattern.

- [ ] **Step 2: Implement PR and legacy path guards.** PR paths must be exactly `po/<fiscalYear>/<purchaseRequestId>/<unique-file-name>` with no `..` and no additional slash in the filename. Legacy receipt paths must continue to validate as `po/<fiscalYear>/<receiptId>/<file-name>` so existing objects can be cleaned safely.

- [ ] **Step 3: Keep the legacy receipt uploader compiling during the move.** Update
  `components/receipts/PoImageUploader.tsx` to import the neutral
  `components/po/PoFileDropzone` and `lib/po/file`/`lib/po/storage` modules. The
  receipt detail wrapper remains temporarily so the move is independently
  verifiable; Task 6 removes the wrapper after the receipt UI no longer uses it.

- [ ] **Step 4: Run the focused storage tests.**

Run: `npx tsx scripts/storage-policy.test.ts`

Expected: PR and legacy path/type assertions pass. The lifecycle test is not
expected to pass yet because the migration and PR action/card files do not
exist yet. If the test loader fails before reaching an assertion, fix the
test/module import boundary before continuing.

- [ ] **Step 5: Commit the neutral utility move.**

```bash
git add lib/po components/po components/receipts/PoImageUploader.tsx scripts/storage-policy.test.ts
git rm lib/receipts/storage.ts lib/receipts/po-file.ts components/receipts/PoFileDropzone.tsx
git commit -m "refactor: move PO file utilities out of receipts"
```

---

### Task 3: Add the forward migration and database source-of-truth rules

**Files:**

- Create: `supabase/migrations/20260823220000_purchase_request_po_file_lifecycle.sql`
- Modify: `scripts/po-file-lifecycle.test.ts`
- Modify: `scripts/receiving-schema.test.ts`
- Modify: `scripts/receiving-transaction.test.ts`

**Interfaces:**

The migration exposes these service-role RPC signatures:

```sql
public.set_purchase_request_po_file(
  p_pr_id uuid,
  p_actor_id uuid,
  p_po_file_path text,
  p_file_name text,
  p_file_mime_type text,
  p_file_size_bytes bigint,
  p_file_checksum text
) returns public.purchase_requests

public.clear_purchase_request_po_file(
  p_pr_id uuid,
  p_actor_id uuid,
  p_deletion_reason text,
  p_receipt_id uuid default null
) returns public.purchase_requests
```

- [ ] **Step 1: Extend the SQL contract tests before writing the migration.** Assert the migration contains `po_file_path`, `po_file_name`, `po_file_mime_type`, `po_file_size_bytes`, `po_file_checksum`, upload/delete actor and timestamp fields, a `closed_short` deletion reason, private bucket compatibility, and service-role-only grants for both RPCs.

- [ ] **Step 2: Add PR metadata columns and audit constraints.** Add nullable columns to `purchase_requests` with foreign keys to `profiles` and `goods_receipts` where appropriate. Keep the active path nullable after deletion, retain file metadata and deletion metadata, and enforce that the deletion reason is only `received` or `closed_short`.

- [ ] **Step 3: Add `set_purchase_request_po_file`.** The RPC must:

  - call `assert_stock_officer_actor(p_actor_id)` before any update;
  - lock the PR with `FOR UPDATE`;
  - allow upload/replacement only for `completed` or `partially_received` PRs with a non-empty `po_number`;
  - require a PR-scoped path matching `po/<fiscal_year>/<p_pr_id>/...`;
  - record file name, MIME, byte size, checksum, uploader, and upload time;
  - clear any stale deletion metadata before returning the updated row.

- [ ] **Step 4: Add `clear_purchase_request_po_file`.** The RPC must:

  - call `assert_stock_officer_actor(p_actor_id)` and lock the PR;
  - accept only `received` or `closed_short` as the current PR status;
  - be idempotent when the path is already null and deletion metadata exists;
  - set `po_file_path` to null, retain file metadata, and record deletion time,
    actor, reason, and triggering receipt ID;
  - clear legacy `goods_receipts.po_image_path` pointers for receipts linked to
    the PR after the storage cleanup has succeeded, so future retries cannot
    rediscover already-deleted legacy paths.

- [ ] **Step 5: Backfill existing receipt-owned pointers.** For each PR, choose the newest non-null linked `goods_receipts.po_image_path` by `received_date` then `created_at`, copy the path and basename into PR metadata, and preserve the original receipt objects and rows until terminal cleanup. Do not delete storage objects in the migration.

- [ ] **Step 6: Replace the current `create_goods_receipt` function in this new migration.** Keep the existing validation, row locks, department checks, quantity ceilings, and line inserts. Change only the receipt header contract:

```sql
if exists (
  select 1 from jsonb_object_keys(p_receipt) field_name
  where field_name not in (
    'purchaseRequestId', 'department', 'receivedDate', 'receiverName', 'note'
  )
) then
  raise exception using errcode = '22023', message = 'unexpected goods receipt field';
end if;
```

Set the inserted `po_number` to `locked_request.po_number` for a linked PR and
to `null` for an unlinked receipt. Do not read a client `poNumber` value.

- [ ] **Step 7: Run migration contract tests.**

Run: `npx tsx scripts/receiving-schema.test.ts`

Expected: PASS for the new PR metadata/RPC/terminal guards and existing receiving schema invariants.

- [ ] **Step 8: Commit the migration.**

```bash
git add supabase/migrations/20260823220000_purchase_request_po_file_lifecycle.sql scripts/po-file-lifecycle.test.ts scripts/receiving-schema.test.ts scripts/receiving-transaction.test.ts
git commit -m "feat: make PR the PO file source of truth"
```

---

### Task 4: Add PR PO-file actions and the detail-page card

**Files:**

- Create: `lib/pr/po-file-actions.ts`
- Create: `components/pr/PurchaseRequestPoFileCard.tsx`
- Modify: `lib/pr/types.ts`
- Modify: `lib/pr/queries.ts`
- Modify: `app/(protected)/purchase-requests/[id]/page.tsx`
- Modify: `app/globals.css`
- Modify: `scripts/pr-ui.test.ts`
- Modify: `scripts/po-file-lifecycle.test.ts`

**Interfaces:**

```ts
export interface PurchaseRequestPoFileRecord {
  path: string | null
  fileName: string | null
  mimeType: string | null
  sizeBytes: number | null
  checksum: string | null
  uploadedAt: string | null
  uploadedByName: string | null
  deletedAt: string | null
  deletedByName: string | null
  deletionReason: 'received' | 'closed_short' | null
  deletedReceiptId: string | null
}

export async function uploadPurchaseRequestPoFile(
  purchaseRequestId: string,
  formData: FormData,
): Promise<{ path: string }>

export async function getPurchaseRequestPoFileUrl(
  purchaseRequestId: string,
): Promise<string | null>

export async function retryPurchaseRequestPoFileCleanup(
  purchaseRequestId: string,
): Promise<void>

export function PurchaseRequestPoFileCard(props: {
  requestId: string
  poNumber: string | null
  file: PurchaseRequestPoFileRecord
  canEdit: boolean
  canRetryCleanup: boolean
}): JSX.Element
```

- [ ] **Step 1: Extend PR query/type tests first.** Require `po_file_path`, upload/delete metadata, uploader/deleter profile joins, `request.poFile`, and the PR card import. The test must fail before these fields/components exist.

- [ ] **Step 2: Extend `requestRowSchema`, `REQUEST_SELECT`, and `mapRequest`.** Parse numeric `po_file_size_bytes` through the same numeric helper used elsewhere. Map missing profile names to `null`; never stringify a missing relation into `[object Object]`.

- [ ] **Step 3: Implement `lib/pr/po-file-actions.ts`.** Use `'use server'`, resolve the actor, call `assertStockOperator`, validate the UUID and `FormData` file, enforce the four MIME types and 10 MB limit, read the locked PR (`id`, `fiscal_year`, `status`, `po_number`, `po_file_path`), reject terminal/no-PO uploads, compute a SHA-256 checksum, upload to the PR-scoped path, then call `set_purchase_request_po_file` via `supabaseAdmin.rpc`. If the RPC fails, remove only the newly uploaded object and surface the Thai error. `getPurchaseRequestPoFileUrl` must validate the stored PR path and return a 300-second signed URL; it must not sign a legacy path under another PR.

- [ ] **Step 4: Implement `PurchaseRequestPoFileCard`.** Reuse `PoFileDropzone`, `Button`, `useTransition`, and the existing native dialog preview. Render these text states:

  - no active file: `ยังไม่ได้แนบไฟล์ PO` and `แนบไฟล์ PO`;
  - active file: `แนบไฟล์ PO แล้ว` and `เปิดไฟล์ PO`;
  - deleted file: `ลบไฟล์แล้วหลังบันทึกเข้าคลัง` plus deletion date/reason and no link/button to a missing object;
  - terminal cleanup pending: `รอล้างไฟล์ PO` and a retry action that invokes the shared cleanup action, not a general manual delete.

  Keep the card disabled until a PO number exists, show the helper `กรุณาบันทึกเลขที่ใบสั่งซื้อ (PO) ก่อนแนบไฟล์`, and preserve 44px focusable controls. Use existing semantic tokens and no inline colors or emoji icons.

- [ ] **Step 5: Implement `retryPurchaseRequestPoFileCleanup`.** Resolve the
  authenticated stock actor, require a terminal PR status, derive the audit
  reason from `received`/`closed_short`, locate the latest posted receipt when
  available, and call `cleanupTerminalPurchaseRequestPoFile`. Revalidate the PR
  detail/list routes after a successful retry; do not expose a general delete
  action to the browser.

- [ ] **Step 6: Place the card immediately after the PR header and before method detail/lines.** Pass `request.poFile`, `request.poNumber`, `canReview`, and a terminal cleanup-pending predicate. Keep ordinary viewers able to open an active file but only stock operators/admins able to upload or retry cleanup.

- [ ] **Step 7: Add only the required CSS.** Reuse the existing `.po-uploader`, `.po-dropzone`, and `.file-preview-dialog` rhythm where possible. Add a compact audit row and pending-error state that stack below 800px, preserve `overflow-wrap:anywhere` for filenames, and keep the card readable at 375px without horizontal scroll.

- [ ] **Step 8: Run the PR tests.**

Run: `npx tsx scripts/po-file-lifecycle.test.ts`

Expected: PR type/query/action/card assertions PASS; receipt negative assertions and lifecycle wiring remain red until Tasks 5–6.

- [ ] **Step 9: Commit the PR-owned UI/action boundary.**

```bash
git add lib/pr/po-file-actions.ts lib/pr/types.ts lib/pr/queries.ts components/pr/PurchaseRequestPoFileCard.tsx app/'(protected)'/purchase-requests/'[id]'/page.tsx app/globals.css scripts/pr-ui.test.ts scripts/po-file-lifecycle.test.ts
git commit -m "feat: attach PO files from purchase request detail"
```

---

### Task 5: Make receipt creation derive and link the PR PO number

**Files:**

- Modify: `lib/receipts/schema.ts`
- Modify: `lib/receipts/types.ts`
- Modify: `components/receipts/ReceiptForm.tsx`
- Modify: `app/(protected)/receipts/new/page.tsx`
- Modify: `lib/receipts/queries.ts`
- Modify: `scripts/receiving-ui.test.ts`
- Modify: `scripts/receiving-schema.test.ts`

**Interfaces:**

The receipt input becomes:

```ts
{
  purchaseRequestId: string | null
  department: string
  receivedDate: string
  receiverName: string
  note: string | null
  items: ReceiptLineInput[]
}
```

`poNumber` must not be accepted by `goodsReceiptInputSchema` or sent in the
`p_receipt` JSON payload.

- [ ] **Step 1: Add failing assertions.** Require no `poNumber` property in `goodsReceiptInputSchema`, no `poFile`/`uploadPoImage`/`preparePoFile` in `ReceiptForm`, and a `next/link` target `/purchase-requests/${selectedRequest.id}` around the selected PR PO number.

- [ ] **Step 2: Remove `poNumber` from the zod schema and `ReceiptForm`.** Delete the PO state, dropzone state, upload-after-create block, `preparePoFile` import, and `uploadPoImage` import. Keep PR selection/department filtering and line behavior unchanged. Render a labeled read-only PO row:

```tsx
<div className="field-row">
  <span>เลขที่ใบสั่งซื้อ (PO)</span>
  {selectedRequest ? (
    <Link className="identifier text-link" href={`/purchase-requests/${selectedRequest.id}`}>
      {selectedRequest.poNumber ?? 'ยังไม่มีเลขที่ใบสั่งซื้อ (PO)'}
    </Link>
  ) : (
    <span className="receipt-pr-hint">เลือกใบ PR ที่เกี่ยวข้องเพื่อแสดงเลข PO</span>
  )}
</div>
```

Also remove the receipt-facing `goodsReceiptImageSchema`/`GoodsReceiptImageInput`,
`poImagePath` from `GoodsReceiptRecord`, and the `po_image_path` field from the
client receipt select/mapping. Legacy receipt paths remain queryable only by the
server-side terminal cleanup helper and migration compatibility code.

- [ ] **Step 3: Update form copy.** Change the new-receipt heading/subtitle/action-bar copy so it says the PO document is managed from the related PR, not attached after receipt draft creation.

- [ ] **Step 4: Update receipt read mapping.** Select the related PR's `id`, `document_number`, and `po_number` in `RECEIPT_SELECT`; map the linked PR PO number as the display `poNumber` for linked receipts, falling back to the legacy receipt snapshot only for old/unlinked history.

- [ ] **Step 5: Run targeted tests.**

Run: `npx tsx scripts/receiving-ui.test.ts`

Expected: receipt form has no PO upload/manual state, selected PO link assertions pass, and only lifecycle/action assertions remain pending.

- [ ] **Step 6: Commit receipt creation changes.**

```bash
git add lib/receipts/schema.ts lib/receipts/types.ts components/receipts/ReceiptForm.tsx app/'(protected)'/receipts/new/page.tsx lib/receipts/queries.ts scripts/receiving-ui.test.ts scripts/receiving-schema.test.ts
git commit -m "feat: derive receipt PO from purchase request"
```

---

### Task 6: Remove receipt PO evidence and wire terminal cleanup

**Files:**

- Create/modify: `lib/po/cleanup.ts`
- Modify: `lib/receipts/actions.ts`
- Modify: `lib/pr/actions.ts`
- Modify: `app/(protected)/receipts/[id]/page.tsx`
- Modify: `scripts/receiving-ui.test.ts`
- Modify: `scripts/receiving-transaction.test.ts`
- Modify: `scripts/po-file-lifecycle.test.ts`
- Delete: `components/receipts/PoImageUploader.tsx`

**Interfaces:**

```ts
export async function cleanupTerminalPurchaseRequestPoFile(
  purchaseRequestId: string,
  actorId: string,
  input: {
    reason: 'received' | 'closed_short'
    receiptId: string | null
  },
): Promise<void>

export async function cleanupPoFileAfterPostedReceipt(
  receiptId: string,
  actorId: string,
): Promise<void>
```

- [ ] **Step 1: Add failing lifecycle assertions.** Require `postGoodsReceipt` to call `cleanupPoFileAfterPostedReceipt`, `closePurchaseRequestRemaining` to call `cleanupTerminalPurchaseRequestPoFile` with `closed_short`, and the receipt detail to contain neither `PO EVIDENCE` nor `PoImageUploader` nor `poUpload=failed`.

- [ ] **Step 2: Implement `cleanupTerminalPurchaseRequestPoFile`.** Fetch the PR status/path and all linked legacy receipt paths with `supabaseAdmin`. Return without mutation for non-terminal statuses or an already-audited deletion. Validate every path against its own PR/receipt namespace. Remove the exact set of objects from `lab-stock-po`; then call `clear_purchase_request_po_file` with the terminal reason and triggering receipt ID. Treat an already-missing object as success; throw on other storage errors before recording the audit deletion. Revalidate `/purchase-requests/<id>`, `/purchase-requests`, `/receipts`, `/receipts/<receiptId>`, `/dashboard`, and `/inventory`.

- [ ] **Step 3: Implement retry-safe posting integration.** After `post_goods_receipt` returns, read the receipt's linked PR state. If the PR is now `received`, call cleanup with `{ reason: 'received', receiptId }`; if it is still `partially_received`, return normally and leave the file active. If cleanup fails after stock posting, preserve the posted result, surface `บันทึกรับเข้าคลังสำเร็จ แต่ล้างไฟล์ PO ไม่สำเร็จ กรุณาลองใหม่`, and let the PR card expose the cleanup retry path.

- [ ] **Step 4: Implement short-close integration.** After `close_purchase_request_remaining` returns `closed_short`, call cleanup with `{ reason: 'closed_short', receiptId: null }`. A cleanup failure must not roll back the audited short-close transition; it must be retryable from PR detail.

- [ ] **Step 5: Update receipt detail.** Remove search-param parsing, failed-upload alert, `PoImageUploader` import/render, and the entire `PO EVIDENCE` aside. Render the PO number in the heading as:

```tsx
{receipt.purchaseRequestId && receipt.poNumber ? (
  <Link className="identifier text-link" href={`/purchase-requests/${receipt.purchaseRequestId}`}>
    {receipt.poNumber}
  </Link>
) : (
  receipt.poNumber ?? 'ไม่ระบุเลขที่ใบสั่งซื้อ (PO)'
)}
```

Keep the PR context link/status, lot table, posting/cancellation panels, and
posted immutable-correction guidance unchanged.

- [ ] **Step 6: Run lifecycle tests.**

Run: `npx tsx scripts/po-file-lifecycle.test.ts`

Expected: all lifecycle/UI assertions PASS, including full receipt, partial-to-received, and `closed_short` cleanup boundaries.

- [ ] **Step 7: Commit terminal cleanup and receipt-detail changes.**

```bash
git add lib/po/cleanup.ts lib/receipts/actions.ts lib/pr/actions.ts app/'(protected)'/receipts/'[id]'/page.tsx scripts/receiving-ui.test.ts scripts/receiving-transaction.test.ts scripts/po-file-lifecycle.test.ts
git rm components/receipts/PoImageUploader.tsx
git commit -m "feat: clean PO files at receiving completion"
```

---

### Task 7: Update domain tests, package wiring, and remove stale ownership references

**Files:**

- Modify: `scripts/pr-ui.test.ts`
- Modify: `scripts/receiving-ui.test.ts`
- Modify: `scripts/receiving-schema.test.ts`
- Modify: `scripts/receiving-transaction.test.ts`
- Modify: `scripts/storage-policy.test.ts`
- Modify: `package.json`
- Modify: only the explicit application/test files identified by the stale-reference search; do not use a broad directory add that could stage unrelated work.

- [ ] **Step 1: Search for stale receipt ownership.**

Run: `rg -n "PoImageUploader|uploadPoImage|getPoImageUrl|PoFileDropzone|lib/receipts/storage|lib/receipts/po-file|PO EVIDENCE|poUpload=failed" app components lib scripts tests`

Expected: only intentional legacy SQL/backfill/cleanup references remain; no receipt UI or action imports the removed uploader.

- [ ] **Step 2: Add tests for exact deletion scope.** Assert a PR cleanup validates the PR path and every linked legacy receipt path against its own UUID, never calls a client delete policy, records one deletion audit, and treats a repeated cleanup as a no-op.

- [ ] **Step 3: Run the focused domain suites.**

Run: `npm run test:pr`

Expected: PR domain/schema/UI tests PASS.

Run: `npm run test:receiving`

Expected: receiving schema/storage/transaction/UI tests PASS.

- [ ] **Step 4: Commit test and reference cleanup.**

```bash
git add scripts/po-file-lifecycle.test.ts scripts/pr-ui.test.ts scripts/receiving-ui.test.ts scripts/receiving-schema.test.ts scripts/receiving-transaction.test.ts scripts/storage-policy.test.ts package.json
git commit -m "test: cover PR PO lifecycle boundaries"
```

If the stale-reference search identifies an additional application file that
was not committed by Tasks 2–6, add that exact path separately; never stage an
entire `app`, `components`, or `lib` directory.

---

### Task 8: Run full verification and perform the UX/UI quality pass

**Files:**

- Inspect only: all changed PR/receipt UI files, `app/globals.css`, and the final diff.

- [ ] **Step 1: Run static checks.**

Run: `npm run lint`

Expected: exit 0 with no new ESLint errors.

Run: `npm run typecheck`

Expected: exit 0 with no missing moved-module imports or nullable metadata errors.

- [ ] **Step 2: Build the production bundle.**

Run: `npm run build`

Expected: exit 0 and both purchase-request and receipt routes compile as App Router pages.

- [ ] **Step 3: Run the full project gate.**

Run: `npm run verify`

Expected: all configured suites pass; E2E may skip only when the documented fixture environment is absent.

- [ ] **Step 4: Inspect the rendered UI.** Open the PR detail and receipt creation/detail routes using the project’s normal production-server procedure. Check desktop and 375px mobile widths, keyboard navigation, dark mode, reduced motion, long filenames, missing PO number, active file, cleanup-pending file, and deleted-file audit state. Confirm no sticky action bar obscures the uploader or receipt link.

- [ ] **Step 5: Run Impeccable’s detector once over the changed UI targets.**

Run:

```bash
node C:\Users\User\.agents\skills\impeccable\scripts\detect.mjs --json app/(protected)/purchase-requests/[id]/page.tsx app/(protected)/receipts/new/page.tsx app/(protected)/receipts/[id]/page.tsx components/pr/PurchaseRequestPoFileCard.tsx components/receipts/ReceiptForm.tsx app/globals.css
```

Expected: no new high-severity accessibility, responsive, contrast, or interaction findings. Fix findings in one bounded pass, rerun the detector at most once, and keep the established Laboratory Control Bench direction.

- [ ] **Step 6: Review the final diff and status.**

Run: `git diff main^..HEAD --stat`

Run: `git status --short`

Expected: only the intended commits/files are changed; unrelated untracked files remain untouched. Report any cleanup retry limitation or skipped E2E environment explicitly before claiming completion.
