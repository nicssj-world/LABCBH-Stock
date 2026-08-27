# LABCBH Stock

ระบบงานคลังน้ำยาและวัสดุวิทยาศาสตร์ กลุ่มงานเทคนิคการแพทย์ โรงพยาบาลชลบุรี

Contract-to-issue workflow for a hospital laboratory: procurement tracking,
purchase requests, goods receipt, FIFO issue, and equipment-lease budgets.

## Status

Live contract management runs in LABCBH Stock. The Lab Management Portal's
**บริหารสัญญา** entry opens the Stock dashboard, while the portal remains the
shared source of identity and profile images.

**[docs/STATUS.md](docs/STATUS.md)** preserves the cutover and recovery
evidence. Use [docs/runbooks/cutover.md](docs/runbooks/cutover.md) only for a
future migration or recovery exercise, not as a description of normal use.

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

`lab_stock_memberships` grants `admin`, `head` (shown as **หัวหน้างาน**),
`stock_officer`, or `viewer` (shown as **ผู้ดูข้อมูล**). The retired `reporter`
role must not be reintroduced. E-Phis `9495` always has admin authority, and a
portal profile with role `Manager` has head authority.

Existing active portal users are seeded into this application as viewers unless
an administrator has already assigned another membership. Admins manage these
grants at `/settings/access`; membership choices always take precedence over the
viewer default.

Recording a lease expense has a second path: anyone listed in that contract's
`responsible_user_ids` may record against **that contract only**, without
holding an editor role. The people doing this day to day are Medical
Technologists, so removing the path would take the job away from the people
doing it. Every grant and revocation is written to
`contract_responsible_audit`.

## Contract register and lease budgets

- The contract register opens on the latest five fiscal years. It hides ended
  contracts by default and provides explicit controls to reveal ended contracts
  or older fiscal years without losing the current filters.
- A contract that has started keeps its procurement history behind a disclosure
  control. Only admins can manually end a contract or remove a duplicate/
  incorrectly created record.
- Equipment leases show the amount used, remaining balance, a monthly spending
  bar chart, a collapsible expense-entry form, and CSV/Excel exports. The entry
  count shown in history is selectable.
- Contract files stay in private Storage. After upload, the compact eye control
  previews the file in an in-page dialog.

## Navigation

The desktop side menu can be collapsed to icon-only navigation from the header;
each icon retains an accessible label and hover title. On smaller screens it
remains a slide-in menu with an overlay and Escape-key close action.

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

## Adding modules safely

Use this checklist for every new module, Postgres function, migration, or
Realtime subscription:

1. Keep the database boundary authoritative. Application writes go through a
   Postgres RPC called with `supabaseAdmin`; do not write directly to tables.
2. In PL/pgSQL, prefix inputs with `p_` and locals with `v_` or a specific
   suffix such as `_value`. Never name a local variable `line`, `contract_id`,
   `product_id`, or another name that can also be a column. Qualify every
   column in a joined query with its table alias.
3. Add a new forward-only migration and commit it with the code. Do not edit
   an applied migration or patch Production with untracked SQL.
4. Run `npm run test:sql-safety` and `npm run verify`. When a migration creates
   or replaces PL/pgSQL, also run `scripts/plpgsql-production-audit.sql` as one
   transaction against the target database and review every reported error.
5. Apply and verify the migration in `LABCBH Stock Staging` first. Confirm the
   intended project ref, migration ledger, exact function definition and
   critical user flow before applying it to Production.
6. For Realtime, wait for an authenticated Supabase session, call
   `supabase.realtime.setAuth(accessToken)`, and only then subscribe. Test the
   initial unauthenticated-loading race as well as a restored session.
7. Keep the browser error safe, but log the server-side cause with a request or
   correlation ID. A generic Next.js Server Components error is not a root
   cause and must not be the only diagnostic signal.

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
