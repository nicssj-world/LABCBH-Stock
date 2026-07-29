import Link from 'next/link'
import { StatusChip } from '@/components/ui/StatusChip'
import { formatThaiDate } from '@/lib/inventory/presenter'
import {
  PURCHASE_METHOD_LABELS,
  PURCHASE_REQUEST_STATUS_LABELS,
  PURCHASE_REQUEST_STATUS_TONES,
  formatBaht,
} from '@/lib/pr/presenter'
import type { PurchaseRequestRecord } from '@/lib/pr/types'

export function PurchaseRequestTable({ requests }: { requests: PurchaseRequestRecord[] }) {
  if (requests.length === 0) {
    return <p className="empty-state">ไม่พบใบ PR ตามเงื่อนไขที่เลือก</p>
  }

  return (
    <>
      <div className="pr-table--desktop">
        <table className="data-table">
          <thead>
            <tr>
              <th>เลขที่ใบ PR</th>
              <th>วันที่ขอ</th>
              <th>วิธีจัดซื้อ</th>
              <th>ผู้ขอ</th>
              <th className="numeric-cell">มูลค่า</th>
              <th>สถานะ</th>
              <th><span className="visually-hidden">เปิดรายละเอียด</span></th>
            </tr>
          </thead>
          <tbody>
            {requests.map((request) => (
              <tr key={request.id}>
                <td>
                  <strong className="identifier">{request.documentNumber}</strong>
                  <small>{request.poNumber ? `PO ${request.poNumber}` : 'ยังไม่มีเลขที่ใบสั่งซื้อ'}</small>
                </td>
                <td>{formatThaiDate(request.requestedDate)}</td>
                <td>{PURCHASE_METHOD_LABELS[request.purchaseMethod]}</td>
                <td>
                  {request.requesterName ?? 'ไม่ระบุ'}
                  <small>{request.department}</small>
                </td>
                <td className="numeric-cell identifier">{formatBaht(request.total)}</td>
                <td>
                  <StatusChip tone={PURCHASE_REQUEST_STATUS_TONES[request.status]}>
                    {PURCHASE_REQUEST_STATUS_LABELS[request.status]}
                  </StatusChip>
                </td>
                <td>
                  <Link className="text-link" href={`/purchase-requests/${request.id}`}>ดูรายละเอียด</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="pr-task-cards" aria-label="รายการใบ PR">
        {requests.map((request) => (
          <li key={request.id}>
            <div className="task-card__topline">
              <StatusChip tone={PURCHASE_REQUEST_STATUS_TONES[request.status]}>
                {PURCHASE_REQUEST_STATUS_LABELS[request.status]}
              </StatusChip>
              <span className="identifier">{formatBaht(request.total)}</span>
            </div>
            <h3 className="identifier">{request.documentNumber}</h3>
            <p>
              {PURCHASE_METHOD_LABELS[request.purchaseMethod]} · {formatThaiDate(request.requestedDate)} ·{' '}
              {request.items.length} รายการ
            </p>
            <Link className="text-link task-card__action" href={`/purchase-requests/${request.id}`}>
              ดูรายละเอียดใบ PR
            </Link>
          </li>
        ))}
      </ul>
    </>
  )
}
