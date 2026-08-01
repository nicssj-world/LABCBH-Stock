# LABCBH Stock

ระบบงานคลังน้ำยาและวัสดุวิทยาศาสตร์ กลุ่มงานเทคนิคการแพทย์ โรงพยาบาลชลบุรี

Contract-to-issue workflow for a hospital laboratory: procurement tracking,
purchase requests, goods receipt, FIFO issue, and equipment-lease budgets.

## Status

Pre-cutover. The system runs against a Staging Supabase project; production
still holds the legacy data and has not been migrated. See
[docs/runbooks/cutover.md](docs/runbooks/cutover.md).

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Supabase (Postgres, Auth,
Storage) · zod · Playwright. Node 22+.

## Getting started

```bash
npm install
cp .env.example .env.local     # fill in the Supabase project you intend to use
npm run dev
```

Sign in with an E-Phis ID. The app resolves `<ephis-id>@cbh.go.th` against
Supabase Auth, then reads `public.profiles` and `public.lab_stock_memberships`
to decide what the account may do.

## The two contract modes

This is the single most important thing to understand about the domain.

Every contract runs the same six-stage procurement lifecycle. Once it reaches
`contract_started`, behaviour forks on `contract_type`:

| | Equipment lease | Everything else |
|---|---|---|
| `contract_type` | `equipment_lease` | `e_bidding`, `specific`, … |
| Tracked by | **Baht drawn down per month** | **Quantity of line items** |
| Tables | `contract_usage` | `contract_items`, `contract_item_allocations` |
| Consumed by | A monthly expense entry | A confirmed purchase request |

The two are mutually exclusive per contract and the database enforces it: a
trigger rejects line items on a lease and budget entries on anything else. A
contract holding both would have a budget balance and an allocation balance that
disagree, with no way to say which is true.

Every contract in production today is an equipment lease.

## Roles

`lab_stock_memberships` grants `admin`, `head`, `stock_officer`, `viewer`, or
`reporter`. Two legacy identities also carry authority: ephis `9495`, and any
profile whose portal `role` is `Manager`.

Recording a lease expense has a second path: anyone listed in that contract's
`responsible_user_ids` may record against **that contract only**, without
holding an editor role. The people doing this day to day are Medical
Technologists, so removing the path would take the job away from the people
doing it. Every grant and revocation is written to
`contract_responsible_audit`.

## Layout

```
app/(auth)/           login, access-denied
app/(protected)/      dashboard, contracts, purchase-requests,
                      receipts, requisitions, inventory, settings/access
lib/<domain>/         schema.ts (zod) · types.ts · authorization.ts
                      queries.ts (read) · actions.ts (server actions) · presenter.ts
components/<domain>/  UI, matching the lib domains
supabase/migrations/  forward-only, applied in filename order
supabase/rollback/    hand-run rollback, deliberately NOT a migration
scripts/*.test.ts     test suites, run with tsx
tests/e2e/            Playwright
docs/runbooks/        cutover, rollback, rollback rehearsal, E2E on Staging
docs/superpowers/     design specs and implementation plans
```

## Commands

```bash
npm run dev            # Next dev server
npm run build          # production build
npm run lint
npm run typecheck
npm run verify         # lint, typecheck, every suite, e2e, build
npm run test:contracts        # per-domain suites, see package.json
npm run test:contract-budget
```

`npm run verify` is the gate. E2E skips inside it unless fixture environment
variables are present; see [docs/runbooks/e2e-staging.md](docs/runbooks/e2e-staging.md)
for how to run it for real.

## Data safety

All writes go through Postgres functions invoked with the service role, never
direct table writes from application code. The functions hold the rules that
must not be bypassed — the over-budget check, the FIFO allocation guard, the
idempotent receipt post — under row locks, in the same transaction as the write.

Migrations are forward-only. `supabase/rollback/` holds a hand-run script for
undoing the LABCBH Stock schema during a failed cutover; it refuses to run while
rows created in the new system would be destroyed, and it never touches
`public.contract_usage`, which belongs to the legacy portal and holds two years
of financial history.
