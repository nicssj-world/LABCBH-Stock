# LABCBH Stock rollback runbook

Rollback authority belongs to the incident lead and database operator. Keep an evidence trail; never hide or delete transactions to make totals appear correct.

## Triggers

Initiate rollback assessment when any trigger is met: authentication is broadly unavailable, a role can perform an unauthorized mutation, financial or quantity reconciliation differs from the approved source, duplicate inventory movements occur, the application cannot complete a critical workflow, or error rates remain above the release threshold.

## Stabilize

- [ ] Re-enter the change freeze in both systems and announce the incident channel and owner.
- [ ] Capture the time, deployment IDs, logs, affected record IDs, last known good transaction, and current reconciliation totals.
- [ ] Disable only the failing workflow if a narrow reversible control exists; otherwise route users to the maintenance notice.
- [ ] Preserve database and storage evidence. Do not delete receipts, movements, allocations, or audit events.

## Application rollback

- [ ] Roll the portal back to its previous deployment so legacy navigation no longer redirects to an unhealthy stock deployment.
- [ ] Roll LABCBH Stock back to the previous deployment with Vercel rollback, or promote the last verified deployment if the rollback command is unsuitable.
- [ ] Verify the exact deployment IDs and environment aliases after rollback.
- [ ] Run read-only login, dashboard, contract, inventory, and reconciliation checks before restoring user traffic.

## Database recovery

- [ ] Treat schema migrations as forward-only: ship a reviewed corrective migration instead of down-migrating or editing migration history.
- [ ] If imported business rows are wrong, identify them through import batch IDs and audit records, then use an approved compensating procedure that preserves history.
- [ ] Never reverse posted receipt or requisition movements with direct deletes; use audited adjustments or a purpose-built compensating migration.
- [ ] Restore the backup only for a declared data-loss disaster after the database operator proves the recovery point and business owner accepts transactions that would be lost.

## Reconciliation and reopen

- [ ] Repeat source-to-destination reconciliation for contract totals, line counts, PR allocations, lot balances, and stock movements.
- [ ] Confirm all partial transactions are classified as committed, rejected, or compensated.
- [ ] Record the root cause, fix owner, new verification evidence, and explicit reopen approval.
- [ ] Lift the freeze only after application smoke checks and reconciliation both pass.
