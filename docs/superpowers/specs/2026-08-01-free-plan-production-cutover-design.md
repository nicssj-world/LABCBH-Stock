# Free-Plan Production Cutover Design

## Goal

Complete the LABCBH Stock production cutover while the Supabase organization
remains on the Free plan, replacing the unavailable PITR gate with a verified
manual recovery package and preserving the existing approval gates for
production promotion and portal handoff.

The change freeze began on 2026-08-01 after the operator confirmed that edits to
contracts, purchase requests, receipts, requisitions, and stock in the legacy
system had stopped.

## Constraints and accepted risk

- Supabase Production remains project `fslagsuorkcckvvtrmyi` on the Free plan.
- Free plan has no automatic backups or Point-in-Time Recovery. Recovery can
  return only to the exact manual snapshot, not to an arbitrary later second.
- The business accepts downtime for a manual restore and the loss of any
  transactions performed after the snapshot. The change freeze prevents those
  transactions during cutover.
- Every database write remains forward-only. Applied migrations are never
  edited or removed from migration history.
- `public.contract_usage` rows must never be changed by the migration or
  rollback process.
- Contract documents are copied from Cloudflare R2; nothing is deleted from R2.
- Backup files, source workbooks, credentials, and reports containing production
  data remain gitignored and excluded from Vercel uploads.
- The current branch is `main`, as explicitly requested by the user. No push or
  production promotion is implied by approval of this design.

## Options considered

### 1. Complete manual recovery package — selected

Create fresh roles, schema, and data dumps; mirror every Supabase Storage object;
hash and inventory the outputs; and rehearse a restore before applying any
migration. This takes longer but provides the strongest recovery path available
on Free plan.

### 2. Database-only snapshot

Dump schema and data but rely on Cloudflare R2 and existing files for Storage
recovery. This is faster but cannot account for all 212 current Supabase Storage
objects, so it was rejected.

### 3. Reuse the 2026-07-30 dump

The existing dump predates the active freeze and may omit intervening changes.
It remains useful evidence but is not accepted as the cutover recovery point.

## Phase 1: Freeze evidence and recovery package

Create one timestamped directory under `.backups/` containing:

- a role dump;
- a schema dump;
- a data dump using `COPY`;
- a complete mirror of all Production Storage buckets and objects;
- a machine-readable inventory with database row counts, Storage bucket/object
  counts, and byte totals;
- a manifest containing project ref, UTC and ICT timestamps, source commit SHA,
  tool versions, exact commands with secrets omitted, file sizes, and SHA-256
  hashes.

The Supabase CLI excludes managed schemas from its normal schema dump. The
manifest must state this explicitly. Storage payloads are protected by the
separate object mirror, while the database dump remains the recovery source for
application-owned tables. The existing legacy portal and R2 originals remain
available throughout rollback.

No migration may begin if a dump command fails, an output is empty, a Storage
object cannot be downloaded, counts differ from the frozen source, or a hash
cannot be reproduced.

## Phase 2: Restore rehearsal

Restore the new schema and data dumps into a disposable PostgreSQL 17 harness
using the same Supabase-compatible role, `auth`, and `storage` stubs used by the
existing rollback rehearsal. Verify:

- all dump files parse and restore without an unclassified error;
- the 16 contracts and 180 `contract_usage` rows are present;
- key frozen row counts match the Production inventory;
- the 13 LABCBH Stock migrations apply in filename order;
- the rollback script returns the application-owned schema to its baseline and
  preserves every `contract_usage` row;
- the 13 migrations can be reapplied after rollback.

The Storage mirror is verified by object key, byte count, and SHA-256 hash. It
does not need to be uploaded into the disposable database harness.

## Phase 3: Existing security blocker

Production currently has one ERROR-level advisor finding unrelated to LABCBH
Stock: `public.vw_kpi_dashboard` is owned by `postgres`, runs with definer
semantics, and is selectable by `anon`. Its three source tables have RLS policies
intended to deny anonymous reads, so the view currently defeats that boundary.

Add one forward migration after the existing 13 stock migration files that:

- sets `public.vw_kpi_dashboard` to `security_invoker = true`;
- revokes all view privileges from `anon`;
- grants only `SELECT` to `authenticated` and `service_role`;
- leaves the view definition and source data unchanged.

Add a static migration contract test and validate the behavior against a real
database. The migration must be idempotent enough for the rehearsed apply path
and must not modify unrelated KPI policies in this cutover.

## Phase 4: Production database cutover

After the recovery package and rehearsal pass:

1. Capture the Production migration history and pre-migration advisor baseline.
2. Apply the 13 reviewed LABCBH Stock migrations in filename order.
3. Apply the timestamped KPI corrective migration as migration 14.
4. Verify the equipment-lease mode guard and all expected schema objects.
5. Confirm the 16 legacy contracts were backfilled without changing the 180
   `contract_usage` rows.
6. Run security and performance advisors. The KPI ERROR must be gone and the
   stock migrations must introduce no new ERROR-level finding.
7. Record the applied migration versions and post-migration counts in the
   cutover evidence.

Any unexpected failure stops the cutover and triggers rollback assessment. Do
not retry a partially understood migration or repair migration history merely
to make the list appear complete.

## Phase 5: Documents and Production candidate

Run the contract-document migration in dry-run mode first. It must report nine
documents to copy, zero failed, and no unexpected key mapping. Apply the copy,
leaving R2 untouched, then verify each copied document can be read through the
stock application's authorized path.

Build a Production-targeted Vercel deployment from the exact reviewed commit
without assigning the canonical production domain. Record its deployment ID and
immutable URL. Run read-only smoke tests first, followed by only the explicitly
approved traceable mutation fixtures. Scan browser, Vercel, and Supabase logs for
new errors or secret-like values.

## Phase 6: Promotion and portal handoff

Production promotion remains a separate approval gate. Require explicit release
lead and business-owner approval for the exact validated deployment ID before:

- promoting that deployment to the canonical LABCBH Stock domain;
- setting `LABCBH_STOCK_URL` on the legacy portal;
- deploying the portal cutover commit;
- running approved production transaction smoke tests;
- lifting the change freeze.

If approval is absent, keep the frozen legacy system and validated candidate in
place and report the blocker. Do not infer promotion authority from approval of
the Free-plan recovery design.

## Verification and evidence

The cutover is complete only when all of the following are archived:

- backup manifest, hashes, inventories, and restore-rehearsal output;
- migration list before and after;
- advisor summaries before and after;
- database and Storage reconciliation counts;
- document-copy dry-run and apply reports;
- application verification and E2E reports;
- Vercel deployment ID, URL, commit SHA, HTTP smoke, and log scan;
- promotion and portal-handoff approvals;
- final counts and monetary totals;
- rollback owner and incident lead.

After cutover, create a new manual database and Storage backup immediately and
schedule recurring off-site backups for as long as Production remains on the
Free plan.
