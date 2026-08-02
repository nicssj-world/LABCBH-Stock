# Contract purchase sequence design

## Goal

Assign the next purchase sequence automatically for every contract purchase
request, without counting cancelled or reversed requests.

## Behavior

When a user chooses a contract, the form shows the next sequence for that
contract and does not allow manual editing. The preview is calculated from
non-cancelled, non-reversed purchase requests for the selected contract.

At submission, the database calculates the sequence again inside the existing
purchase-request transaction. It assigns one more than the highest valid
sequence for that contract. This authoritative calculation prevents duplicate
sequences when two users submit requests at the same time.

If all earlier requests for a contract are cancelled or reversed, the next
sequence is 1. A cancelled or reversed request does not reserve a sequence.

## Implementation boundaries

- Add a read query that returns the next preview sequence for each available
  contract, and pass it to the PR form.
- Change the PR method UI to display the suggested sequence as read-only.
- Update the existing `create_purchase_request` database function to ignore
  the browser-provided contract sequence and store the transaction-calculated
  value.
- Preserve the existing JSON `method_details` format and all non-contract
  purchase methods.

## Validation

Tests cover the preview calculation, exclusion of cancelled and reversed
requests, UI read-only behavior, and the database function's authoritative
calculation. Existing PR workflow tests and the production build must pass.
