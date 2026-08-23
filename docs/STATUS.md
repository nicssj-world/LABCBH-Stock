# Status — 2026-08-01

Where the LABCBH Stock cutover stands, what is proven, and what is left.

Update this file when any line moves.

---

## Latest PR checklist schema remediation — 2026-08-24

- Staging (`stogulcfwsvunydmwrex`) was missing the three
  `purchase_requests.checklist_*` columns and five checklist tables required by
  the current PR query. The reviewed repository migration
  `20260824120000_purchase_request_checklist.sql` was applied without resetting
  the hosted database.
- The migration service recorded it as `20260823200005` with the name
  `purchase_request_checklist`. The live contract check
  `npm run test:staging-pr` now passes and covers both checklist columns and the
  existing `profiles` relationships.
- The remote migration ledger remains non-canonical. Keep the deliberate ledger
  reconciliation open; do not run an unreviewed linked `supabase db push`.

---

## Latest schema-drift remediation — 2026-08-23

- Read-only comparison found that Production and Staging diverged in both
  data and schema; Production was not simply a newer linear version.
- Staging (`stogulcfwsvunydmwrex`) received the existing stock-balance
  migrations `20260818100000` and `20260818103000`. It now exposes both
  `set_stock_balance` overloads and enforces lot expiry on
  `record_stock_adjustment`.
- Production (`fslagsuorkcckvvtrmyi`) was not modified. Local `.env.local`
  remains pointed at Staging.
- The remote migration ledger is still non-canonical because the migration
  service recorded generated apply-time versions. Do not run a normal
  `supabase db push` until the ledger is deliberately repaired and reviewed.
- Static drift, inventory, receiving, typecheck, and lint checks pass. The
  Staging advisor snapshot has no ERROR-level finding but retains broad
  pre-existing INFO/WARN findings from the legacy schema.

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

Five defects were found and fixed along the way, each of which would have
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
- **The Vercel CLI tried to upload the 121 MiB production logical dump.** Git's
  ignore was not enough for this project-specific local directory. A tested
  `.vercelignore` now excludes backups, credentials, imports, build output, test
  artifacts, worktrees, and local agent settings. The dry-run manifest fell
  from 127.4 MB to 1.48 MB before the first successful upload.

### Proven, not assumed

| Claim | How |
|---|---|
| Over-budget check survives concurrency | Two live sessions racing a 1,000 ceiling; one committed, one refused with the true remaining balance |
| Responsible-user grant lifecycle | Refused → granted → recorded → revoked → refused, each step against Postgres, audit rows written, audit table rejects `DELETE` |
| Mode guard both directions | Budget entry on a lease allowed, line item refused; reverse for a supply contract; preflight aborts on conflicting data |
| Rollback returns the schema to baseline | Rehearsed twice, most recently over all 13 migrations with budget data present; every new object removed, `contract_usage` rows preserved, all 13 re-apply |
| UI renders correctly | Screenshots of the budget panel, lease form, and dashboard against Staging |
| Whole suite green | `npm run verify` clean; fixture-backed E2E **7/7** against the immutable Preview on Staging |

### Cutover groundwork

- **Portal retirement commit** is on `lab-management-portal` `origin/main`:
  `/staff/contracts` redirects, writes answer 410, reads stay for reconciliation,
  the stale budget widget retires. Inert until `LABCBH_STOCK_URL` is set.
- **Production backup** taken 2026-07-30 13:01 — schema + data, row counts match
  live, SHA-256 recorded in `.backups/MANIFEST-20260730-130113.md` (gitignored).
- **Rollback script** at `supabase/rollback/`, rehearsed. Refuses to run while it
  would destroy rows created in the new system.
- **Staging** carries all 13 migrations.
- **Vercel environment separation** is configured. Preview contains only the
  three sensitive Supabase keys sourced from Staging; Production contains the
  same three key names sourced from Production. Fourteen stale E2E fixture
  variables were removed from Preview.
- **Validated Preview** — deployment
  `dpl_72Hhqiy7vrfHcnmUv9qFZV4uTkxF` at
  `https://labcbh-stock-pdtnc81su-nics-sj-s-projects.vercel.app`, source commit
  `db50db468b70517dc78097e9dac4c55feae24987`, verified 2026-08-01 20:19 ICT.
  `/login` returned 200, protected routes redirected to `/login`, the
  fixture-backed smoke suite passed 7/7 serially, and the runtime scan found no
  unexpected errors or secret-like values. The two logged errors were the
  deliberate losing requests in the PR and requisition concurrency tests.
- **Runbooks** updated: cutover, rollback, rollback rehearsal, E2E on Staging.
- **Free-plan recovery package** refreshed at
  `.backups/20260801-204123/` (gitignored): roles, schema, public and managed
  data, 212 Storage objects / 104,751,548 bytes, inventories, and SHA-256
  hashes. The public application data restored into isolated PostgreSQL 17.6;
  rollback refused an operational probe row, then succeeded after its removal,
  preserving all 180 legacy usage rows; the migrations reapplied cleanly.
- **Production database cutover completed** during the confirmed freeze. The 13
  stock migrations, KPI `security_invoker` correction, and the contract-file
  bucket size correction are recorded as 15 forward migrations. Production has
  78 profiles, 16 contracts, 180 `contract_usage` rows, 20 expected stock
  tables, 3 active seed memberships, and zero mixed budget/item contracts.
- **Security blocker resolved.** Advisor output changed from 1 ERROR / 41 WARN
  to 0 ERROR / 42 WARN. The one new warning is the intentional authenticated
  `SECURITY DEFINER` RLS helper `is_current_lab_stock_admin()`; authenticated
  execution is required by the non-recursive membership policy.
- **Contract documents copied** from R2 without deleting the originals. All 9
  are present and readable from private Supabase Storage (55,071,823 bytes).
  The first pass exposed one 18,219,021-byte PDF above the old 10 MiB limit;
  forward migration `20260801142323` raises only the contract bucket to 25 MiB.
- **Production-targeted candidate is READY**, built from commit
  `860a9afaaf8fda8283fc0a449af87e4c002618c2` as deployment
  `dpl_39JnrxGzybiLsyREMsyZziXD7EeA` at
  `https://labcbh-stock-b5wd5kmf3-nics-sj-s-projects.vercel.app`. `/login`
  returns 200, `/dashboard` redirects to `/login`, and its error log scan is
  clean. `--skip-domain` kept canonical `https://labcbh-stock.vercel.app` on
  the prior deployment.

---

## Blocked or outstanding

Ordered. Each depends on the one above it.

### 1. Approve and promote the Production candidate

This is the deliberate final approval gate. Promote exactly deployment
`dpl_39JnrxGzybiLsyREMsyZziXD7EeA`; do not rebuild it. The database and files
are ready, but canonical user traffic has not moved.

### 2. Point the portal at the stock system

Set `LABCBH_STOCK_URL` and deploy. This is what activates the redirect and the
410s. Verify legacy contract pages redirect, writes are refused, and
reconciliation reads still work.

### 3. Import contract line items

The 16 production contracts arrive with none. They come from the approved
workbook import, not from the portal database. Until then those contracts are
viewable but cannot be allocated against — which matters only for supply
contracts, and every current contract is a lease.

---

## Known gaps

- **Free plan still has no PITR.** Recovery returns to the frozen manual
  snapshot, not an arbitrary second after it. The application-owned schema and
  actual public data were restored and migrated in an isolated PG17.6 harness;
  managed Auth data cannot be loaded directly into the bare image because its
  Auth schema revision differs from the live managed service. Separate managed
  dumps and the complete Storage mirror remain in the recovery package.
- **Authenticated business smoke on the Production candidate is still an
  approval activity.** The artifact has passed build, HTTP login/redirect, data,
  Storage, and log checks, but no production user workflow has been submitted.
- **Three portal capabilities have no equivalent and are not planned**: nothing
  reads the 180 historical `contract_usage` rows into a report, the portal's own
  contract list view is not reproduced, and `contract_usage` rows written before
  cutover carry `recorded_by` as a display name rather than a user id.
- **A second cutover branch exists** on the portal, `feat/labcbh-stock-cutover`,
  from a parallel session. It was left intact rather than deleted. It removes
  the write handlers outright instead of gating them, so it cannot ship ahead of
  the migration and cannot be switched off without a redeploy. Decide whether to
  delete it or fold its cleanup in once the cutover is stable.
