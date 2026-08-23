# Purchase Request PO File Lifecycle Design

## Request

Move purchase-order (PO) file attachment from the “สร้างใบรับเข้า” flow to
the purchase-request detail page. The purchase request becomes the owner and
source of truth for the PO number and PO document. Receipt creation reads the
PO number from the selected PR, and receipt detail links back to that PR
instead of rendering a separate PO evidence panel.

PO files are temporary operational documents. They may be PDF or an image and
must be hard-deleted from private storage once the receiving work for the PR
is finished, while the PR keeps a non-file audit trace.

## Scope

- Move PO upload, replacement, and viewing to purchase-request detail.
- Accept PDF, JPG, PNG, and WEBP files, with the existing 10 MB limit and
  client-side image preparation.
- Remove PO file selection and manual PO-number entry from new receipt
  creation.
- Derive a linked receipt's PO number from its purchase request in the
  database, so a stale or tampered client cannot submit a different number.
- Replace the receipt-detail `PO EVIDENCE` panel with a PO/PR link.
- Preserve existing PO objects during migration; remove them only through the
  terminal lifecycle cleanup described below.
- Keep an audit trace in the PR after the object is deleted.

Out of scope:

- Adding a second document type or a general document-management system.
- Changing receipt line, lot, stock-posting, or FIFO rules.
- Replacing the established LABCBH Stock visual language.
- Adding a user-facing manual-delete action.

## Confirmed lifecycle rules

The file remains available while receiving is still active:

1. A receipt that covers the full PR is posted. When that post changes the PR
   to `received`, the PO object is deleted immediately.
2. A partial receipt is posted. While the PR remains `partially_received`, the
   file remains available. The final posted receipt changes the PR to
   `received`, and cleanup then deletes the file.
3. A PR is closed with a shortfall. `closed_short` is terminal for receiving,
   so the close-remaining action also deletes the file.

The cleanup is not triggered merely because an individual receipt is `posted`
when the PR remains partially receivable. An unlinked receipt has no PR-owned
PO file to clean up.

## Design

### Source of truth and audit trace

Add PR-owned PO-file metadata to the purchase-request record. The active file
path is nullable and is cleared after physical deletion; the remaining
metadata provides the audit trace without leaving a broken link. The metadata
must retain at least:

- original file name, MIME type, byte size, and checksum;
- uploaded-at and uploaded-by;
- deleted-at and deleted-by;
- deletion reason (`received` or `closed_short`);
- the triggering receipt ID when deletion came from a posted receipt.

All metadata changes go through privileged Postgres RPCs. Application code
never writes the table directly.

Existing `goods_receipts.po_image_path` data is not deleted by the migration.
Where possible, existing PR-linked receipt paths are backfilled into the PR's
active metadata so existing documents remain reachable from the new PR page.
Legacy receipt paths remain valid for cleanup and rollback compatibility. A
terminal cleanup must remove the active PR object and any legacy PO objects
belonging to that PR, without touching objects for another PR.

### Storage and authorization

Keep the PO bucket private. New objects are namespaced by PR, for example
`po/<fiscal-year>/<purchase-request-id>/<unique-file-name>`. Server actions
validate the MIME type, size, and path before any storage write. They use the
existing image preparation flow: PDFs are preserved and supported images are
resized/recompressed before upload.

Stock operators and admins may upload or replace a PO file. Authorized signed-in
users may open an attached file through a short-lived signed URL. No client
storage delete policy is introduced; hard deletion is performed server-side
with the service-role storage client only after the database confirms a
terminal receiving state.

Cleanup must be idempotent and retry-safe. A missing object is treated as
already deleted, while a storage failure leaves the PR trace/path available
for a retry and surfaces a clear error. The successful cleanup RPC clears the
active path and records the deletion event only after the object removal is
known to have succeeded.

### Purchase-request detail UX

Place a compact “ไฟล์ PO” document card immediately beside or below the PO
number facts in the existing PR detail header/method area. It follows the
current Laboratory Control Bench conventions:

- Thai visible label and an English operational kicker only when useful;
- explicit states for not attached, uploading, attached, and deleted;
- a clearly labeled upload/replace control for stock operators;
- an “เปิดไฟล์ PO” control for an attached file, using the existing private
  preview pattern;
- after terminal cleanup, a non-clickable status such as “ลบไฟล์แล้วหลัง
  บันทึกเข้าคลัง” plus the retained metadata/date;
- a helper message when no PO number exists: record the PO number first;
- visible focus states, keyboard access, 44px minimum targets, and errors near
  the file control;
- mobile stacking that keeps the card readable without horizontal scrolling.

Do not introduce new colors, gradients, emoji icons, or a separate component
style. Reuse existing `bench-panel`, `identifier`, semantic tokens, Button,
dialog, and file-dropzone patterns.

### New receipt UX

The related-PR selector remains the only way to associate a PR. Once a PR is
selected:

- show its PO number as read-only text and an internal `next/link` to the PR
  detail;
- show a clear “ยังไม่มีเลขที่ใบสั่งซื้อ (PO)” state when the selected PR has
  no PO number;
- remove the editable PO input, PO file dropzone, file preparation call, and
  post-create upload retry path;
- submit no client-provided PO number. The server derives it from the locked
  PR row. A receipt without a related PR has no PO number.

The page copy must no longer promise that a receipt draft can carry a PO
attachment. It should explain that the PO document is managed from the PR.

### Receipt detail UX

The receipt heading displays the PO number, when available, as an internal link
to `/purchase-requests/<id>`. The linked PR number remains visible as context.
Remove:

- the `PO EVIDENCE` kicker and panel;
- `PoImageUploader` from receipt detail;
- the `poUpload=failed` query-state and retry message;
- any receipt-detail upload/preview controls.

Receipt line links, posting/cancellation audit, and the immutable posted-state
guidance remain unchanged.

### Database and mutation flow

The forward migration must:

- add the PR PO-file metadata and audit fields;
- add or replace the PR upload/replace and deletion RPCs with actor checks,
  terminal-state guards, and path validation assumptions;
- update the current `create_goods_receipt` RPC so a linked receipt derives
  `po_number` from the locked PR and rejects unexpected client PO input;
- update the current posting and short-close mutation boundary so the app can
  run terminal PO cleanup after `received` or `closed_short` is committed;
- preserve existing RLS/read grants and keep all app writes behind
  `supabaseAdmin.rpc(...)`.

The server action sequence is:

1. Commit the receipt post or short-close state through its authoritative RPC.
2. Read the linked PR's current terminal status and active PO path.
3. If the status is `received` or `closed_short`, remove only the PR-owned and
   legacy PO objects associated with that PR.
4. Record the deletion metadata through an RPC and revalidate the PR, receipt,
   register, dashboard, and inventory surfaces.

The stock mutation remains authoritative even if storage cleanup needs a
retry; cleanup failures must be visible and must never fabricate a successful
audit deletion.

## Testing and verification

Follow test-first development for each behavior change:

- Add failing path/type tests for PR-scoped PO paths, allowed MIME types, and
  terminal cleanup scope.
- Add failing PR UI tests for the uploader states and audit status.
- Update receiving UI tests to prove there is no receipt PO uploader/evidence
  panel, the PO field is read-only/linked, and the receipt action no longer
  uploads a file.
- Add migration/RPC contract tests for PR metadata, PO derivation, terminal
  guards, actor checks, idempotent cleanup, and legacy-path safety.
- Cover the three lifecycle cases: full single receipt, partial then final
  receipt, and `closed_short`.
- Preserve existing tests for receipt posting, cancellation, quantity guards,
  storage privacy, and PR reversal rules.

Verification before handoff:

- `npm run lint`
- `npm run typecheck`
- targeted PR and receiving suites
- `npm run build`
- `npm run verify` when the environment allows the full gate
- inspect the changed PR and receipt routes at desktop and 375px mobile
  widths, including keyboard focus, dark mode, and reduced motion
- run Impeccable's detector once against the changed UI targets

## Acceptance criteria

- A stock officer can attach a PDF or supported image from PR detail and open
  it while the PR is still receiving.
- Selecting a PR in new receipt creation displays the PR's PO number as a
  read-only internal link; no manual PO number or PO file entry remains.
- A linked receipt cannot store a PO number different from its PR.
- Receipt detail has no `PO EVIDENCE` panel and links its PO/PR context back to
  the PR detail.
- The file survives partial receiving and is deleted only when the PR reaches
  `received` or `closed_short`.
- After deletion, the PR shows an audit trace without a broken file link.
- A cleanup retry cannot delete another PR's file or duplicate the audit event.
- Existing storage remains private and all application writes still use RPCs.
