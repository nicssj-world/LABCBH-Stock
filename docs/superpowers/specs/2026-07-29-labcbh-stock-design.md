# LABCBH Stock — Design Specification

## 1. Product and System Boundary

LABCBH Stock is the operational web application for reagent and scientific-material inventory, PR, receiving, requisition fulfillment, and executive visibility for the Medical Technology Department at Chonburi Hospital.

The application shares the existing Supabase project with `lab-management-portal`:

- Supabase Auth, `auth.users`, `profiles`, and existing role/permission data remain shared.
- LABCBH Stock becomes the sole owner of contract creation, editing, deletion/cancellation, stage changes, contract files, contract items, Dashboard, watchlists, and PR allocation.
- The existing contract module in `lab-management-portal` is retired after cutover: write APIs are disabled and the contract route redirects to the corresponding LABCBH Stock page.
- The two Google Sheets are migrated once. Supabase becomes the only writable source of truth; the Sheets remain historical references.

### Success criteria

- A manager can create a PR or requisition without retyping catalog, contract, price, stock, or monthly-usage information.
- A stock officer can acknowledge a PR, receive PO-linked lots, and fulfill a requisition with atomic, auditable stock changes.
- Contract-item committed quantity is reduced only when a stock officer confirms a PR; pending PRs reserve the available quantity so a later PR cannot overbook the line.
- Inventory on hand is derived from immutable movements and cannot become negative.
- Executives can see contract workflow, low balances, minimum-stock breaches, expiring lots, and operational queues in one Dashboard.
- Existing contract records remain usable throughout migration, and non-contract portal modules remain unaffected.

## 2. Architecture and Data Model

### Application stack

- Next.js 16 App Router, React 19, TypeScript strict mode, Tailwind CSS 4, and Server Components for initial reads.
- Supabase SSR for the shared authenticated session; publishable credentials in the browser and service-role credentials on the server only.
- Zod validation at every Server Action boundary.
- Recharts for accessible charts, with equivalent tables and visible numeric summaries.
- Supabase private Storage bucket `lab-stock-po` for PO images.
- Vercel Node.js runtime with Fluid Compute; no Edge runtime.

### Backward-compatible contract expansion

Extend the existing `contracts` table rather than replacing it:

- Add nullable `fiscal_year`, `contract_type`, `procurement_stage`, `display_name`, `portal_updated_at`, and lifecycle timestamps.
- Allow `contract_number` and `vendor` to remain null before the applicable workflow stage; update portal types and rendering to handle them.
- Preserve existing columns and identifiers so current portal queries and foreign keys continue to work.
- Backfill legacy contracts as `contract_type = 'equipment_lease'` and `procurement_stage = 'contract_started'`.
- Support these contract types: equipment lease, E-Bidding, annual specific procurement, specific procurement, off-plan, awaiting equipment lease, and Thai Red Cross.
- Support these ordered stages: sent to procurement, plan published, tender announced, result consideration, winner announced, contract started.
- Require a unique contract number only when moving to `contract_started`.

Add normalized children:

- `contract_items`: one row per contract line with line number, LS/catalog item, contracted quantity, unit, unit price, and source/import metadata.
- `contract_stage_history`: append-only from/to stage, effective date, actor, note, and source.
- `contract_item_allocations`: immutable confirmed PR commitments that reduce the available contract quantity; pending PR lines reserve quantity until confirmation or cancellation, and reversals reference the original allocation.
- Contract committed quantity and percentage are derived from active allocations; quantity available for a new PR also subtracts pending reservations.

### Inventory and procurement entities

- `inventory_items`: canonical LS code, canonical Thai/PO name, base unit, responsible department, active state, default price, minimum-stock months (default 1.5), and explicit minimum-stock override.
- `inventory_item_aliases`: historical names, units, and source coordinates used to resolve Sheet variants without corrupting canonical data.
- `purchase_requests`: fiscal-year number, requester, department, head-name snapshot, purchase method and method-specific references, status, PO number, acknowledgement actor/time, and audit timestamps.
- `purchase_request_items`: inventory item, optional contract item, monthly-usage snapshot, on-hand snapshot, requested quantity, unit, unit price, and calculated line total.
- `goods_receipts`: PO/PR reference, receiver, receiving date, PO image path, and status.
- `inventory_lots`: receipt line, item, lot number, expiry date, received date, original quantity, and storage location.
- `requisitions`: fiscal-year number, requester, department, requested fulfillment date, status, fulfillment actor/time, and printable-document metadata.
- `requisition_items`: requested item and quantity.
- `requisition_lot_allocations`: selected lots and fulfilled quantities; records FIFO overrides and their reason.
- `stock_movements`: append-only receive, issue, reverse, and adjustment ledger linked to the originating document and lot.
- `lab_stock_memberships`: app-specific access assignments without changing `profiles.role`.

### Database invariants and transactions

- Confirming a PR atomically validates status, locks affected contract items, rejects over-allocation, creates allocations, and changes the PR to completed.
- Adding a PO number after PR completion updates the document but does not create another allocation.
- Receiving atomically creates/updates lots and positive movements.
- Fulfilling a requisition locks selected lots, rejects expired lots or insufficient balance, creates negative movements, and marks the requisition completed.
- Editing a completed financial or stock transaction creates a reversal and replacement; historical rows are never overwritten.
- Database constraints prevent negative quantities, zero-quantity lines, duplicate document numbers, duplicate active PR allocations, and duplicate active fulfillment.
- Service-only transaction functions use `security invoker`, are executable only by `service_role`, and are called after server-side session and permission checks.

## 3. Roles, Workflows, and Interface

### Access model

- E-Phis `9495`: full LABCBH Stock administration.
- Existing `Manager` role: head-of-section capabilities, including PR and requisition submission.
- E-Phis `14812` and `11050`: initial stock-officer memberships.
- Admin can assign or remove stock officer, head, viewer, and report permissions from settings.
- Contract editing uses LABCBH Stock permissions; the portal no longer offers contract mutations after cutover.
- Every exposed table has RLS. Reads are limited by authenticated membership and department where appropriate; all writes are re-authorized server-side.

### Contract workflow in LABCBH Stock

- LABCBH Stock contract forms support fiscal year, seven contract types, nullable number/vendor, multi-line contract items, and current procurement stage.
- Each stage transition requires an effective date and appends history.
- The contract number field becomes required at “contract started.”
- Delete remains restricted and confirmed; records referenced by PR or history are archived/cancelled instead of physically deleted.
- LABCBH Stock contract list filters by fiscal year, type, stage, department, low balance, and expiry, with create/edit/stage-history actions for authorized users.
- During transition the portal contract page displays a cutover notice; after verification it redirects to the matching LABCBH Stock route and all legacy contract write endpoints return a migration response without mutating data.

### PR workflow

- A Manager searches LS code or name and selects a catalog item.
- The form prefills canonical name, rolling three-completed-month usage, current on-hand, unit, price, and matching active contract items.
- The manager enters requested quantity and selects exactly one purchase method, with conditional fields for annual plan, contract and purchase sequence, awaiting contract, off-plan, specific contract, or E-Bidding.
- Saving a confirmed submission creates status `pending` (“รอดำเนินการ”).
- A stock officer reviews the calculation and contract match, then acknowledges it. Successful confirmation creates the allocation and changes status to `completed` (“จัดทำแล้ว”).
- The PO number can be attached later. Cancelling a completed PR requires an audited reversal.

### Receiving workflow

- Stock officers search by PO, PR, LS code, or name.
- Each receiving line records Lot No., expiry date, quantity, unit, responsible department, receiver, receiving date, and storage location.
- The PO image is uploaded to the private bucket and accessed through an authorized signed URL.
- Duplicate PO/Lot/item combinations warn the user and require explicit confirmation; receiving the same lot again adds a separate movement rather than rewriting history.

### Requisition and fulfillment workflow

- A Manager creates a requisition with desired fulfillment date, item, quantity, department, and requester.
- Search results show available lots ordered by received date (FIFO), expiry date, and current balance. Expired or empty lots are disabled.
- Submitting creates `waiting` (“รอจ่าย”).
- A stock officer selects one or more lots. Choosing a later lot while an older usable lot exists requires an override reason.
- Completion creates stock movements and changes status to `fulfilled` (“จ่ายสำเร็จ”).
- The A4 print view includes document number/date, department, requester, line items, fulfilled lots, quantities, fulfillment date, and signature blocks for issuer and receiving head.

### Minimum stock and alerts

- Suggested minimum stock equals rolling average monthly issue quantity multiplied by 1.5.
- Admin/stock officers may set an explicit item minimum; an explicit value takes precedence and its changes are audited.
- PR and requisition forms show a warning when current or projected post-issue on-hand is at/below minimum stock.
- The warning recommends creating a PR but does not block an urgent requisition.
- In-app Dashboard alerts cover contract items below 30%, minimum-stock breaches, expired/near-expiry lots, overdue PRs/requisitions, and contract workflow delays. No email/SMS notification is included.

### Dashboard — approved composition

Use the selected Laboratory Control Bench visual world with Composition C plus the watchlist from Composition B:

- Top: contract workflow ribbon with counts and overdue items for all six stages.
- Middle: PR queue, requisition queue, stock/lot alerts, and contract-balance bullet summaries.
- Lower: prioritized watchlist combining contract items below 30%, projected minimum-stock breaches, expiring lots, and overdue work.
- Bottom: recent audit activity and compact trend summaries.
- Filters: fiscal year (Thai Buddhist year), department, contract type, severity, and date range.
- Desktop is dense and table-first; mobile shows the next action and exception cards before charts.
- Color never stands alone; all states include text, values, and accessible icons.

## 4. Migration, Failure Handling, and Verification

### One-time Sheet migration

1. Export immutable workbook snapshots and record spreadsheet ID, tab, row, and cell provenance.
2. Load into staging tables without altering production data.
3. Match the 74 observed contract numbers against existing portal contracts using normalized contract number plus identity fields; present collisions for manual review.
4. Split summary-value rows from LS item rows. Import contract lines from the observed 289 item rows and canonicalize the 185 LS codes.
5. Preserve all name/unit variants in aliases. The observed duplicate codes, 63 name-variant groups, and 27 unit-variant groups require a review report before final import.
6. Convert horizontal purchase-sequence columns into legacy allocation rows carrying sequence number and source coordinates. When dates are absent, keep the date null and label the row as imported legacy history.
7. Import inventory catalog metadata from the 141 stock rows, but do not trust their on-hand values because every observed remaining-percentage formula contains `#REF!`.
8. Establish opening on-hand by a physical-count import approved by a stock officer; create auditable opening-adjustment movements.
9. Run an idempotent dry run showing inserts, updates, skips, conflicts, totals, and remaining-percent comparisons before applying.
10. Keep the original Sheets read-only after cutover.

### Failure and concurrency behavior

- Forms retain entered values and focus the first invalid field after validation failure.
- Async buttons disable while saving and show success/error feedback.
- Stale contract or lot balances return a conflict message, refresh affected values, and require review before retry.
- Network failures never mark a document completed unless the database transaction committed.
- Storage-upload failure leaves the receipt draft intact and does not create stock.
- Destructive actions require confirmation; completed transactions use reversal workflows.
- All mutations write audit actor, timestamp, source document, and before/after details.

### Test and acceptance coverage

- Schema and migration tests: constraints, indexes, RLS, explicit grants, legacy backfill, idempotent imports, and Supabase advisors.
- Domain tests: Thai fiscal years, seven contract types, stage order, contract-number requirement, totals, 30% threshold, 1.5-month minimum, FIFO choice, expiry, reversals, and non-negative stock.
- Permission tests for Admin 9495, Manager, stock officers 14812/11050, configurable memberships, department reads, and unauthorized writes.
- Transaction tests for double-submit, concurrent PR allocation, concurrent lot fulfillment, partial multi-lot fulfillment, cancellation, and PO updates.
- Import reconciliation against both Sheets, including duplicate LS/name/unit reports and summary-vs-item separation.
- UI tests for keyboard navigation, visible labels, focus management, responsive tables/cards, loading/error/empty states, and WCAG AA contrast.
- Print tests for A4 pagination, Thai font embedding, totals, lot details, and signature blocks.
- End-to-end tests: login, contract read/deep link, PR submit/confirm/PO, receive with image, requisition/FIFO/fulfill/print, Dashboard filters, and audit visibility.

## 5. Delivery and Cutover

- Phase 1: backward-compatible database migration and LABCBH Stock contract management.
- Phase 2: LABCBH Stock shell, shared auth, permissions, Dashboard, and portal contract-module retirement.
- Phase 3: PR and contract allocation.
- Phase 4: receiving, lots, requisitions, stock ledger, and printing.
- Phase 5: Sheet dry-run import, alias review, physical opening count, reconciliation, and production cutover.
- Phase 6: Vercel deployment, environment sync, smoke tests, and operational handoff.

Install Vercel CLI with `npm i -g vercel` before environment linking and deployment. Link LABCBH Stock to its own Vercel project while pointing it to the same Supabase project as the portal.
