# LABCBH Stock cutover runbook

Owner: release lead. Database operator, stock lead, portal owner, and incident lead must be named before the window begins.

This is an approval-gated production checklist. A preview deployment is not approval to promote, import, or change the portal. Record timestamps, operators, commit SHA, deployment URLs, SQL migration list, report hashes, and every approval in the release ticket.

## Preconditions

- [ ] Announce a change freeze for contract, PR, receipt, requisition, and stock edits in the legacy portal.
- [ ] Confirm a maintenance window, rollback owner, and business acceptance owner.
- [ ] Confirm the stock and portal branches have passed their full verification suites.
- [ ] Confirm production secrets exist in Vercel and are not present in Git or terminal output.
- [ ] Create and verify a restorable database backup. Record backup ID and restore rehearsal evidence.
- [ ] Export immutable pre-cutover reconciliation snapshots from the legacy contract and inventory sources.
- [ ] Confirm the source workbooks are final, read-only copies in `.secure-import/` and are excluded from Git.

## Database and import gate

- [ ] Capture `supabase migration list` for local and linked production projects; investigate every mismatch.
- [ ] Run Supabase security and performance advisors. Resolve security findings; document any accepted performance finding.
- [ ] Run a staging dry-run import and archive the reconciliation report.
- [ ] Have the stock lead compare contract totals, line counts, LS codes, duplicate warnings, and rejects against the source workbook.
- [ ] Record the approved hash of the exact dry-run report and exact source files. Do not continue if a byte changes.
- [ ] Apply reviewed migrations during the freeze using the standard forward migration command.
- [ ] Run the approved production import once, then prove idempotency by dry-running the same immutable inputs again.
- [ ] Import opening balances only from a separately reviewed physical count file; record its approved hash and approver.
- [ ] Reconcile imported contracts, items, allocations, lots, and stock movements to the approved reports.

## Preview and smoke gate

- [ ] Link the intended Vercel project and pull preview environment variables into an ignored local file.
- [ ] Deploy the exact stock commit to preview; record its immutable preview URL.
- [ ] Run `E2E_BASE_URL=<preview> E2E_REQUIRE_FIXTURES=1 E2E_ALLOW_MUTATIONS=1 npm run test:e2e` against isolated fixtures.
- [ ] Smoke login for admin, manager, and stock roles.
- [ ] Smoke contract creation and every stage transition; verify contract number is required only at start.
- [ ] Smoke PR confirmation and its concurrency guard.
- [ ] Smoke receipt posting, inventory balance, FIFO requisition fulfillment, and A4 print/signature layout.
- [ ] Smoke dashboard watchlist, access settings, audit records, and denied actions for each role.
- [ ] Confirm browser console, server logs, and Supabase logs contain no new errors or secret values.

## Production promotion and portal handoff

- [ ] Obtain explicit release lead and business owner approval to promote the validated stock preview.
- [ ] Promote the exact validated deployment; do not rebuild from a different commit.
- [ ] Run read-only production smoke checks first, then one approved traceable transaction per workflow.
- [ ] Set `LABCBH_STOCK_URL` on the legacy portal to the canonical stock origin.
- [ ] Deploy the reviewed portal cutover commit and verify legacy contract pages redirect while reconciliation GET routes remain available and all legacy writes return HTTP 410.
- [ ] Verify links, cookies, authentication, and redirects from a clean browser session.
- [ ] Announce completion, lift the change freeze, and begin the heightened monitoring window.

## Closeout evidence

- [ ] Archive backup ID, migration output, advisor output, import logs, approved hash values, reconciliation reports, deployment IDs, E2E report, production smoke evidence, and approvals.
- [ ] Record final counts and monetary totals from both source and destination.
- [ ] Schedule the post-cutover reconciliation and legacy read-route retirement review.
