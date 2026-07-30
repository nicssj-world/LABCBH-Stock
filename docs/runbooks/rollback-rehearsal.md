# Rollback rehearsal — 2026-07-30

Evidence for the cutover runbook's "restore rehearsal" gate. Rehearsed in a
throwaway `postgres:17` container, so neither production nor Staging was touched.

## Why a rollback script rather than a restore

`supabase backups list` reports PITR **disabled** on the production project
(`fslagsuorkcckvvtrmyi`), earliest and latest timestamps both `0`. There is no
point-in-time window to fall back to. The logical dump in `.backups/` is a real
safety net but restoring it is a whole-database operation with a known caveat:
`pg_dump` warned of circular foreign keys on `profiles`, `org_chart_nodes`, and
`outlab_certificates`, so a data-only restore needs `--disable-triggers`.

The forward migration is overwhelmingly additive — new tables, new columns, new
functions — so undoing it precisely is faster, safer, and far less disruptive
than restoring 126 MB over a live database.

## What the script had to get right

The forward migration drops two policies it never recreates:

```sql
contracts_auth_read    -- SELECT, auth.role() <> 'anon'
contracts_staff_write  -- ALL,    get_my_role() in ('staff','admin')
```

Both are portal-owned. A naive "drop the new tables" rollback would leave
`public.contracts` with no read policy and no write policy, readable by nobody —
the portal would still be broken after a "successful" rollback. The definitions
restored by the script were read from the production schema dump, not from
`scripts/*.sql` in the portal repo: two conflicting versions of
`contracts_staff_write` exist there, and the live one is the `get_my_role()`
variant, not the `('Admin','Manager')` variant in `update-rls-policies.sql`.

The migration also relaxes `contracts.vendor` to nullable and narrows grants
from `GRANT ALL` on `anon`/`authenticated` down to `SELECT` for `authenticated`
only. Both are restored.

## Procedure rehearsed

| Step | Result |
|---|---|
| Portal base schema (from the production dump) + representative rows | applied |
| All 9 migrations, in order | 9/9 OK |
| Rollback with stock rows present, no acknowledgement | **refused**, transaction atomic, nothing dropped |
| Rollback with `labcbh.confirm_data_loss = 'yes'` | completed |
| Schema compared against pre-migration baseline | **identical** |
| All 9 migrations re-applied | 9/9 OK, state identical to first run, membership seed re-created |

The comparison covers tables, views, functions, `contracts` columns and
nullability, constraints, indexes, triggers, policies including their `qual`
expressions, grants per role, and row counts.

## Limits — read before relying on this

- It is a **schema** rollback. Rows created through LABCBH Stock live only in
  tables the migration creates, so rolling back destroys them. The guard refuses
  to run when such rows exist until the operator sets
  `labcbh.confirm_data_loss = 'yes'`. Legacy `contracts`, `contract_usage`, and
  `profiles` rows are never touched.
- Restoring `vendor NOT NULL` aborts if any contract has a null vendor, which is
  correct: the portal schema cannot represent a row the stock system staged
  without a vendor. Resolve those rows first.
- The `lab-stock-po` storage bucket is left in place; deleting it would orphan
  uploaded PO scans. Its three policies are removed.
- Rehearsed against a reconstructed base, not a clone of production. It exercises
  every object the migration touches, but a full-fidelity rehearsal would restore
  the actual dump into a scratch project.

## Running it

```bash
psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/rollback/20260730_rollback_lab_stock.sql
```

Never via `supabase db push` — the script is kept outside `supabase/migrations`
precisely so it cannot be applied as a forward migration.
