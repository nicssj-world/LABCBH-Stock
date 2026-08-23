# Running the E2E smoke suite against Staging

The six Playwright `@smoke` spec files (seven smoke tests) skip silently unless fixtures are supplied. This
is how to make them actually run. Target the **LABCBH Stock Staging** project
(`stogulcfwsvunydmwrex`) — never the production Lab_management Project.

## One-time setup

Point `.env.local` at Staging, then give the four fixture accounts a known password:

```bash
npm run e2e:staging-passwords
```

This seeds `9495` (admin), `99001` (manager/head), `14812` and `11050`
(stock officers) with password `123456`. The script refuses to run against any
project other than Staging.

## Before every run

The receiving spec **posts** the draft receipt, consuming it. Seed a fresh one:

```bash
npm run e2e:staging-seed-receipt   # prints /receipts/<uuid>
npm run e2e:staging-seed-lease     # prints /contracts/<id>
```

The lease spec records against the contract's budget and reassigns its
responsible users, so it needs a contract of its own rather than a shared one.

Also pick an unused `pending` purchase request and a `waiting` requisition —
both specs consume the record they act on.

## Running

Serve a production build, not `next dev`. On a cold dev server the login form
can submit natively before React hydrates, which sends the password as a query
parameter and fails the login.

```bash
npm run build && npm start
```

Then, from Git Bash, with `MSYS_NO_PATHCONV=1` so leading-slash paths are not
rewritten into Windows paths, and absolute fixture URLs:

```bash
MSYS_NO_PATHCONV=1 \
E2E_BASE_URL=http://127.0.0.1:3000 \
E2E_REQUIRE_FIXTURES=1 E2E_ALLOW_MUTATIONS=1 \
E2E_ADMIN_IDENTIFIER=9495 E2E_ADMIN_PASSWORD=123456 \
E2E_MANAGER_IDENTIFIER=99001 E2E_MANAGER_PASSWORD=123456 \
E2E_STOCK_IDENTIFIER=14812 E2E_STOCK_PASSWORD=123456 \
E2E_STOCK_ALT_IDENTIFIER=11050 E2E_STOCK_ALT_PASSWORD=123456 \
E2E_PR_READY_URL=http://127.0.0.1:3000/purchase-requests/<pending-id> \
E2E_RECEIPT_DRAFT_URL=http://127.0.0.1:3000/receipts/<seeded-id> \
E2E_REQUISITION_WAITING_URL=http://127.0.0.1:3000/requisitions/<waiting-id> \
E2E_LEASE_CONTRACT_URL=http://127.0.0.1:3000/contracts/<seeded-lease-id> \
npx playwright test --workers=1
```

For the release-style run, use the guarded command below after exporting the
same variables. It refuses to start when fixture credentials, isolated URLs,
or explicit mutation consent are missing; the ordinary `npm run test:e2e`
command remains useful for local UI checks because unavailable fixtures skip.

```bash
npm run test:e2e:strict
```

`--workers=1` is required. In parallel the receiving spec posts the same draft
receipt the dashboard spec expects to still be a draft, and dashboard fails.
Serial order puts `dashboard` before `receiving`, which is why CI pins one worker.

## Applying migrations to Staging

Before applying anything, verify `[db.migrations] enabled = true` in
`supabase/config.toml`. When this flag is false, `supabase db push` reports
success while applying nothing. Change only that one setting if it is disabled:
a blanket find-and-replace on `enabled = false` also switches on
`[auth.sms.twilio]`, and the push then fails validation on its empty
`account_sid`.

This repository's hosted migration ledgers are currently non-canonical: a
remote migration version is not sufficient evidence that the SQL effect exists,
and a normal linked `supabase db push` is unsafe until the ledger is deliberately
reconciled. Apply reviewed migrations through the approved forward migration
runner/operator workflow in filename order. Record both the repository filename
and the version recorded by the environment. Do not reset a hosted database or
paste SQL into the SQL editor as the normal deployment path.

Before deploying the application version that consumes the schema, run the live
PR contract check while `.env.local` points at Staging:

```powershell
npm run test:staging-pr
```

The check requires the Staging service-role key and verifies the exact PR list
select, including checklist columns and `profiles` relationships. A failing
check blocks the application deployment until the reviewed migration is applied.
