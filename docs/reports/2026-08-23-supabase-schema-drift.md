# Supabase schema drift — 2026-08-23

This report began with a read-only comparison of the LABCBH Stock Production
and Staging projects. After the comparison, two reviewed schema migrations
were applied to Staging only; no reset, seed, or Production data/schema
mutation was performed.

## Targets

| Environment | Project ref | Local role |
|---|---|---|
| Production | `fslagsuorkcckvvtrmyi` | live Lab Management / Stock data |
| Staging | `stogulcfwsvunydmwrex` | development and E2E |

`.env.local` remains pointed at Staging.

## Finding

The environments are not in a simple "Production ahead of Staging" sequence.
They have both data drift and schema drift:

- Production has the populated operational dataset; Staging is a fixture/test
  dataset.
- Production has the newer `set_stock_balance` RPC overloads, while Staging
  does not expose that RPC.
- Staging has `public.inventory_lots.lot_number_key`, while Production does
  not expose that column.
- Both projects expose the inspected partial-receiving and pending-reservation
  columns, functions, and triggers.
- Both projects expose the notification objects inspected here.

The Production `post_goods_receipt` function metadata references
`lot_number_key` even though the Production catalog check did not find that
column. This is a schema consistency red flag and must be reconciled through a
reviewed migration before relying on Production receipt posting. No posting
was attempted.

## Direct SQL row-count snapshot after remediation

These are current counts captured with read-only SQL after the Staging
remediation. They are not a before/after proof because the earlier compact
table metadata was not a reliable baseline and fixture activity may occur
while Staging is online. No row values were exported.

| Object | Production | Staging |
|---|---:|---:|
| `profiles` | 79 | 4 |
| `lab_stock_memberships` | 149 | 8 |
| `contracts` | 33 | 40 |
| `contract_usage` | 187 | 6 |
| `inventory_items` | 231 | 208 |
| `inventory_lots` | 118 | 29 |
| `stock_movements` | 139 | 49 |
| `purchase_requests` | 7 | 32 |
| `goods_receipts` | 2 | 24 |
| `requisitions` | 7 | 26 |
| `lab_stock_notifications` | 20 | 9 |

The counts explain why Production appears ahead during normal browsing, but
they do not justify copying Production data into Staging.

## Schema checks

| Object/check | Production | Staging |
|---|---:|---:|
| `purchase_request_items.received_quantity` | present | present |
| `purchase_request_items.remaining_quantity` | present | present |
| `purchase_requests.closed_short_*` | present | present |
| `goods_receipts.cancelled_*` | present | present |
| `inventory_lots.lot_number_key` | missing | present |
| `lab_stock_notifications.dismissed_at` | present | present |
| `set_stock_balance` | present, two overloads | present, two overloads after remediation |
| `close_purchase_request_remaining` | present | present |
| `validate_purchase_request_item_contract_reservation` | present | present |
| `guard_contract_item_pending_quantity` | present | present |
| pending-reservation triggers | present | present |
| receipt-reversal trigger | present | present |

## Repository/migration observations

- The repository contains 66 migration files through
  `20260823100000_pr_pending_reservations.sql`.
- The remote migration ledgers do not match the repository file set or one
  another. The ledger is therefore not sufficient evidence that a migration's
  SQL effect is present.
- The relevant repository definitions for the missing Staging RPC are
  `20260818100000_set_stock_balance.sql` and
  `20260818103000_require_lot_expiry_on_stock_balance.sql`.
- The Staging `lot_number_key` effect is already present, so replaying every
  repository migration with an unreviewed `supabase db push` is unsafe.

## Remediation applied

The following existing repository migrations were applied to Staging in
timestamp order:

- `20260818100000_set_stock_balance.sql`
- `20260818103000_require_lot_expiry_on_stock_balance.sql`

The migration service recorded them on Staging under generated apply-time
versions `20260823153609` and `20260823153616`, with the original filenames as
their names. The remote migration ledger therefore still needs a deliberate
repair/reconciliation before anyone runs a normal `supabase db push` from this
checkout. No Production DDL or data write was performed.

Post-apply checks confirmed on Staging:

- both `set_stock_balance` overloads exist;
- the eight-argument overload accepts lot number and expiry date;
- `record_stock_adjustment` enforces a lot expiry date;
- `inventory_lots.lot_number_key` remains present;
- the static drift test, inventory tests, receiving tests, typecheck, and lint
  all pass.

The current Staging advisor snapshot contains no ERROR-level finding, but it
does contain broad pre-existing INFO/WARN findings across the legacy schema;
those were not changed or remediated by this operation.

## Decision

Do not point local development at Production. The identified stock-balance
schema gap is repaired on Staging using the two reviewed migration definitions.
The migration-ledger mismatch remains explicitly open; do not reset either
hosted database, run an unreviewed `db push`, or copy Production rows.
