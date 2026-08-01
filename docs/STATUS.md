# Status — 2026-08-01

Where the LABCBH Stock cutover stands, what is proven, and what is left.

Update this file when any line moves.

---

## Done

### Equipment lease budget management

The portal's contract module now exists in LABCBH Stock. Twelve planned tasks,
all committed. Spec: [equipment-lease-budget-design](superpowers/specs/2026-07-30-equipment-lease-budget-design.md).
Plan: [equipment-lease-budget-implementation](superpowers/plans/2026-07-30-equipment-lease-budget-implementation.md).

| Capability | Where |
|---|---|
| Baht drawdown per month, reusing `contract_usage` | `lib/contracts/budget*.ts`, migration `20260730120500` |
| Contract documents in private Supabase Storage | `lib/contracts/file*.ts`, migration `20260730121500` |
| Responsible users, with an audit trail | `components/contracts/ResponsibleUserPicker.tsx` |
| Expiry and low-budget watchlist | `lib/dashboard/contracts.ts` |
| CSV and Excel export | `lib/contracts/export.ts` |
| Budget / line-item modes kept exclusive | trigger `guard_contract_tracking_mode` |

Four defects were found and fixed along the way, each of which would have
reached production:

- **A lease could not be created or edited at all.** The item requirement lived
  in four places, not the one the plan predicted.
- **The dashboard valued every lease at zero**, because it derived value from
  line items. With the portfolio being entirely leases, that reported roughly
  163 million baht as nothing.
- **The create form still offered line items on a lease**, so the default path
  through it failed outright.
- **The file-copy script would have copied nothing and reported success**, since
  it treated the portal's R2 keys as already-migrated Supabase paths.

### Proven, not assumed

| Claim | How |
|---|---|
| Over-budget check survives concurrency | Two live sessions racing a 1,000 ceiling; one committed, one refused with the true remaining balance |
| Responsible-user grant lifecycle | Refused → granted → recorded → revoked → refused, each step against Postgres, audit rows written, audit table rejects `DELETE` |
| Mode guard both directions | Budget entry on a lease allowed, line item refused; reverse for a supply contract; preflight aborts on conflicting data |
| Rollback returns the schema to baseline | Rehearsed twice, most recently over all 13 migrations with budget data present; every new object removed, `contract_usage` rows preserved, all 13 re-apply |
| UI renders correctly | Screenshots of the budget panel, lease form, and dashboard against Staging |
| Whole suite green | `npm run verify` clean; E2E **7/7** against Staging |

### Cutover groundwork

- **Portal retirement commit** is on `lab-management-portal` `origin/main`:
  `/staff/contracts` redirects, writes answer 410, reads stay for reconciliation,
  the stale budget widget retires. Inert until `LABCBH_STOCK_URL` is set.
- **Production backup** taken 2026-07-30 13:01 — schema + data, row counts match
  live, SHA-256 recorded in `.backups/MANIFEST-20260730-130113.md` (gitignored).
- **Rollback script** at `supabase/rollback/`, rehearsed. Refuses to run while it
  would destroy rows created in the new system.
- **Staging** carries all 13 migrations.
- **Runbooks** updated: cutover, rollback, rollback rehearsal, E2E on Staging.

---

## Blocked or outstanding

Ordered. Each depends on the one above it.

### 1. Enable PITR — **needs you, in the Supabase dashboard**

`supabase backups list` reports PITR off, earliest and latest both `0`. The CLI
has only `list` and `restore`; enabling it is a dashboard action and a paid
add-on. Until then the only rollback paths are the rehearsed script and an
unrehearsed 126 MB logical dump.

### 2. The production LABCBH Stock deployment is broken

`https://labcbh-stock.vercel.app` returns **500 on every route**, including the
public `/login`. That is a configuration failure rather than a data one —
most likely missing environment variables on Vercel. Nothing downstream can be
verified while this stands. Not yet diagnosed.

### 3. Deploy and smoke the stock app

Only once it serves traffic is there something for the portal to hand over to.

### 4. Apply the 13 migrations to production

**Do not run this before step 3.** The first migration drops the portal's
`contracts_auth_read` and `contracts_staff_write` policies. Right now that would
break contract management for 76 active users with no working replacement and no
PITR.

Note that `supabase db push` applies nothing while `[db.migrations] enabled` is
`false` in `supabase/config.toml`, which is how it ships.

### 5. Copy the nine contract documents

`node scripts/migrate-contract-files.mts --apply`, with the R2 credentials from
the portal environment. **Cannot run before step 4**: the destination bucket is
created by the migration. Dry run currently reports 9 to copy, 0 skipped,
0 failed, and is idempotent. Nothing is deleted from R2.

### 6. Point the portal at the stock system

Set `LABCBH_STOCK_URL` and deploy. This is what activates the redirect and the
410s. Verify legacy contract pages redirect, writes are refused, and
reconciliation reads still work.

### 7. Import contract line items

The 16 production contracts arrive with none. They come from the approved
workbook import, not from the portal database. Until then those contracts are
viewable but cannot be allocated against — which matters only for supply
contracts, and every current contract is a lease.

---

## Known gaps

- **The logical dump's restore has never been rehearsed.** `pg_dump` warned of
  circular foreign keys on `profiles`, `org_chart_nodes`, and
  `outlab_certificates`; a data-only restore needs `--disable-triggers`. The
  rollback script is the tested path, not this.
- **The rehearsal ran against a reconstructed base**, not a clone of production.
  It exercises every object the migrations touch, but a full-fidelity rehearsal
  would restore the actual dump into a scratch project.
- **Three portal capabilities have no equivalent and are not planned**: nothing
  reads the 180 historical `contract_usage` rows into a report, the portal's own
  contract list view is not reproduced, and `contract_usage` rows written before
  cutover carry `recorded_by` as a display name rather than a user id.
- **A second cutover branch exists** on the portal, `feat/labcbh-stock-cutover`,
  from a parallel session. It was left intact rather than deleted. It removes
  the write handlers outright instead of gating them, so it cannot ship ahead of
  the migration and cannot be switched off without a redeploy. Decide whether to
  delete it or fold its cleanup in once the cutover is stable.
