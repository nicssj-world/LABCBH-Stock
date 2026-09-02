import Link from 'next/link'
import type { PurchaseRequestRecord } from '@/lib/pr/types'

export function PurchaseRequestInvoiceSummaryLink({ request }: { request: Pick<PurchaseRequestRecord, 'id' | 'purchaseMethod'> }) {
  if (request.purchaseMethod !== 'red_cross') return null

  return (
    <Link
      className="lab-link-button lab-link-button--secondary purchase-invoice-summary-link"
      href={`/api/purchase-requests/${request.id}/invoice-summary`}
      target="_blank"
      rel="noreferrer"
    >
      สรุปใบแจ้งหนี้ (PDF)
    </Link>
  )
}
