import { purchaseMethodPurpose } from '@/lib/pr/schema'
import type { PurchaseMethodKind } from '@/lib/pr/schema'

/**
 * A receipt can be counted as purchase spend either when it belongs to an
 * ordinary purchase-order method that does not consume a contract line, or
 * when its contract relation resolves to a non-lease contract.
 *
 * `contract` is deliberately excluded from the first branch: that method is
 * the one purchase-order method whose PR lines must carry a contract item.
 */
export function canClassifyExecutivePurchaseReceipt(
  purchaseMethod: PurchaseMethodKind | null | undefined,
  contractId: number | null | undefined,
  contractType: string | null | undefined,
): boolean {
  if (
    purchaseMethod &&
    purchaseMethod !== 'contract' &&
    purchaseMethodPurpose(purchaseMethod) === 'purchase_order' &&
    contractId == null
  ) {
    return true
  }

  return contractId != null && contractType != null && contractType !== 'equipment_lease'
}
