# Equipment lease budget management — design

Bring the portal's contract-management module into LABCBH Stock so equipment
lease contracts are managed by baht budget, not stock deduction.

## Why

The cutover analysis found the stock system's contract model does not serve the
data it is about to inherit. Every one of the 16 production contracts is an
equipment lease — `เช่าเครื่อง...` — totalling roughly 163 million baht. Not one
is a supply contract. The itemised `contract_items` + quantity-allocation model
built for reagents with LS codes has no legacy contract to attach to.

Meanwhile the workflow that *is* live has no home in the new system:

| Signal | Measurement |
|---|---|
| `contract_usage` rows | 180, across 13 of 16 contracts |
| History span | 2024-07 → 2026-06, 24 months |
| Most recent entry | 2026-07-08, three weeks before cutover |
| People recording | 4 |
| Contracts with an attached file | 9 of 16 |
| Contracts naming responsible users | 6 of 16 |

Cutting over without this would silently end a monthly financial process in
active use.

## Scope

In: budget consumption, contract file attachment, responsible users, the
expiry / low-budget watchlist, CSV and Excel export.

Out: line items, purchase requests, receiving, inventory — untouched. Files are
copied out of R2, never deleted from it. No other portal module is affected.

## Architecture

Every contract runs the existing six-stage procurement lifecycle unchanged.
Behaviour forks only once a contract reaches `contract_started`, and the fork is
decided by `contract_type`:

- `equipment_lease` → **budget mode**. Consumption is recorded in baht per month
  against the contract total. No line items.
- every other type → **supply mode**. The existing `contract_items` and
  `contract_item_allocations` path, unchanged.

The two modes are mutually exclusive per contract, enforced in the database
rather than by convention: a trigger rejects `contract_items` on an
`equipment_lease` contract, and rejects `contract_usage` on any other type.
Without that guard a contract could accumulate both a budget balance and an
allocation balance, and neither number would mean anything.

The fork is evaluated in one place — a single `contractMode(contract)` helper —
so the UI, the RPCs, and the tests all agree on what a contract is.

## Data model

Approach A: reuse `public.contract_usage` exactly as it stands. The 180 rows are
real financial history spanning two years; moving them buys a tidier table name
and nothing else, at the cost of a data migration inside the cutover window and
a more complicated rollback.

Changes, all additive:

| Object | Change | Reason |
|---|---|---|
| `contract_usage.recorded_by_id` | new `uuid references profiles(id)` | `recorded_by` holds a display name, not an identity. New entries get a real foreign key; the text column is preserved so existing history keeps its attribution. |
| `contract_responsible_audit` | new table | Being listed on a contract confers the right to spend against it. That grant is currently editable with no record. |
| `lab-stock-contracts` | new private storage bucket | Contract documents, separate from the `lab-stock-po` receiving evidence. |
| `contracts.file_url` | repointed | Existing column, rewritten from an R2 key to a Supabase Storage path. |
| `contracts.responsible_user_ids` | reused as-is | Already present and populated. |

`contract_responsible_audit` mirrors `lab_stock_membership_audit`:
`contract_id`, `profile_id`, `actor_id`, `previous_assigned`, `next_assigned`,
`note`, `created_at`. Append-only, same trigger as the other audit tables.

## Permissions

Two paths, both preserved from the portal because both are in use:

1. **Contract editors** — the existing `assert_contract_editor_actor`: ephis
   `9495`, `profiles.role = 'Manager'`, or an active `admin`/`head` membership.
2. **Responsible users** — anyone listed in that contract's
   `responsible_user_ids`, for that contract only.

The second path is not decorative. เบญจวรรณ ใจเย็น is a Medical Technologist,
holds no editor role, is a responsible user, and has recorded budget entries.
All four responsible users are Medical Technologists. Dropping this path would
take the ability to record spending away from the people doing it.

A new `assert_contract_expense_actor(p_actor_id, p_contract_id)` expresses the
union. Every write goes through a `SECURITY`-checked RPC called with the service
role, matching the rest of the stock system.

Both grants are revocable, and after this change both leave a trail:
memberships in `lab_stock_membership_audit`, responsible users in
`contract_responsible_audit`.

## Budget rules

Ported from the portal, and now enforced in the database rather than only in the
client:

- `usage_month` normalises to the first day of the month.
- An entry may not push total consumption above `contracts.total`. Checked under
  a row lock on the contract so two concurrent entries cannot both pass.
- Month options are bounded by the contract's `start_date` and `end_date`.
- **Expiring**: months remaining until `end_date` is at most 6 for a contract
  over 10,000,000 baht, otherwise at most 3. A contract with no `end_date` never
  counts as expiring. Months are whole 30-day periods, floored, matching the
  portal so the same contracts light up.
- **Low budget**: remaining is under 30% of `total`. A contract with no `total`
  is never low — it is unknown, which the UI states rather than implying zero.

The over-budget check is the one rule the portal enforced only in an API handler,
where two simultaneous requests could each see enough remaining budget. Moving it
into the RPC under a lock closes that.

## Files

A one-time script copies the nine existing documents from R2 into
`lab-stock-contracts` and rewrites `contracts.file_url`. R2 originals stay where
they are, so rolling back restores a working portal without touching storage.

Upload, download, and delete run through RPCs with storage policies modelled on
the existing `lab-stock-po` rules: private bucket, no public URLs, access
governed by the same two permission paths.

## Interface

`/contracts/[id]` gains a budget panel, shown only in budget mode: a remaining
gauge, monthly history, an add-expense form, CSV and Excel export, and the file
attachment. The contract edit form gains the responsible-user picker. The
dashboard watchlist gains expiring and low-budget contracts.

Written against the stock system's existing components. The portal's version is
1,500 lines of inline styles and would not survive contact with this codebase's
design system or its dark mode.

## Testing

- **Domain**: remaining-budget arithmetic, month normalisation, expiry and
  low-budget thresholds, contract-number sorting.
- **Schema**: the new column, audit table, bucket, and storage policies exist
  with the intended grants.
- **Transaction**: an entry that would exceed the total is rejected; two
  concurrent entries cannot both consume the same remaining balance; the mode
  guard rejects line items on a lease and budget entries on a supply contract.
- **E2E**: a responsible user who is not an editor can record an expense; an
  editor can attach and download a document; a viewer can do neither.

## Risks

- The mode guard will reject data that mixes both models. Production has no such
  contract today — all 16 are leases with zero line items — but the migration
  must verify that before the constraint is enforced.
- Copying files depends on R2 credentials being available to the migration
  script. They live in the portal's environment, not the stock system's, and are
  needed once rather than at runtime.
- `contracts.total` is nullable. A lease with no total has no budget to measure
  against; the UI must present that as unknown rather than as zero remaining.
