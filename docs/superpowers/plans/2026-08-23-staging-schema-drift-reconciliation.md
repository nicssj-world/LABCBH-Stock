# Staging Schema Drift Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reconcile the LABCBH Stock Staging schema with the reviewed repository baseline without changing Production data or using Production credentials for local development.

**Architecture:** Inspect both Supabase projects read-only through migration metadata and PostgreSQL catalogs, then derive a small, forward-only Staging remediation from the repository migrations. Apply only reviewed DDL to Staging, verify the resulting functions, columns, triggers, and read paths, and leave `.env.local` pointed at Staging.

**Tech Stack:** Supabase CLI 2.100.1, Supabase SQL/MCP read-only catalog queries, PostgreSQL 17, checked-in SQL migrations, Next.js 16.

## Global Constraints

- Never run DDL or data writes against Production `fslagsuorkcckvvtrmyi`.
- Keep local development on Staging `stogulcfwsvunydmwrex`.
- Do not reset either hosted project or copy real Production data into Staging.
- All schema changes must be forward-only and represented by a reviewed migration file.
- Do not run staging seed/password/E2E mutation scripts against Production.
- Preserve `public.contract_usage` rows and all existing operational data.

---

### Task 1: Capture the authoritative drift baseline

**Files:**
- Create: `docs/reports/2026-08-23-supabase-schema-drift.md`
- Read: `supabase/migrations/*.sql`, `supabase/config.toml`

**Interfaces:**
- Consumes: Supabase project refs `fslagsuorkcckvvtrmyi` and `stogulcfwsvunydmwrex`.
- Produces: A redacted report containing migration versions, expected objects from the current repository, and the observed Staging/Production differences. No credentials or row contents.

- [ ] Run `supabase migration list --linked` for the currently linked Production project and the read-only migration-list query for both project refs.
- [ ] Query `information_schema.columns`, `pg_proc`, and `pg_trigger` for every object introduced by migrations dated 2026-08-18 through 2026-08-23.
- [ ] Record the verified differences, including `set_stock_balance`, `inventory_lots.lot_number_key`, partial-receiving columns, pending-reservation triggers, and notification objects.
- [ ] Record row counts only for the operational tables needed to explain data drift; never export row contents.
- [ ] Confirm the baseline report contains no URL keys, service-role values, passwords, names, document numbers, or patient-adjacent data.

### Task 2: Derive the smallest Staging remediation

**Files:**
- Read: `supabase/migrations/20260818100000_set_stock_balance.sql`
- Read: `supabase/migrations/20260818103000_require_lot_expiry_on_stock_balance.sql`
- Test: `scripts/staging-schema-drift.test.ts`

**Interfaces:**
- Consumes: Task 1's verified catalog differences and existing migration SQL.
- Produces: A reviewed apply set using the two existing forward-only, idempotent repository migrations; it must not import data or alter Production.

- [ ] Compare the verified Staging catalog with the SQL bodies of the repository migrations, not with Production row contents.
- [ ] Reuse the existing `20260818100000` and `20260818103000` definitions for the missing stock-balance RPCs and expiry guard; do not rewrite business rules in a new ad-hoc migration.
- [ ] Abort the remediation design if an existing Staging object conflicts with the expected signature or function behavior; document the conflict instead of replacing it blindly.
- [ ] Add a static test that asserts both source migrations contain no `insert`, `update`, `delete`, `truncate`, `drop table`, or `alter table ... drop column` statements; project targeting is enforced by the apply command, never embedded in SQL.
- [ ] Run the static test before any remote apply.

### Task 3: Apply and verify Staging only

**Files:**
- Read: `docs/reports/2026-08-23-supabase-schema-drift.md`
- Read: `supabase/migrations/20260818100000_set_stock_balance.sql`
- Read: `supabase/migrations/20260818103000_require_lot_expiry_on_stock_balance.sql`

**Interfaces:**
- Consumes: The reviewed remediation migration and a clean read-only baseline.
- Produces: Verified Staging schema with no Production mutation.

- [ ] Confirm the target project ref in the operator command is exactly `stogulcfwsvunydmwrex`.
- [ ] Apply the two reviewed migrations to Staging in timestamp order using the Supabase migration workflow; do not use `db reset`, `db push` against an unreviewed history, or a Production-linked CLI session.
- [ ] Re-run the catalog checks and assert every expected object is present with the expected function signatures and trigger names.
- [ ] Run the repository static verification suites and a read-only application smoke check against local Staging.
- [ ] Keep `.env.local` on Staging and document the resulting migration/version state.

### Task 4: Close out with evidence

**Files:**
- Modify: `docs/STATUS.md`
- Modify: `docs/reports/2026-08-23-supabase-schema-drift.md`

**Interfaces:**
- Consumes: Task 3's apply output and verification output.
- Produces: A dated record of the exact migration, target ref, verification results, and any remaining divergence.

- [ ] Record the migration filename, target project ref, UTC/ICT timestamps, and command results without secrets.
- [ ] Record any unresolved migration-ledger mismatch separately from schema verification; do not claim the projects are synchronized if only the catalog check passed.
- [ ] Run `git diff --check` and review the final diff before handoff.
