import { PurchaseRequestSummaryDialog } from '@/components/pr/PurchaseRequestSummaryDialog'
import { DetailIconLink } from '@/components/ui/DetailIconLink'
import { StatusChip } from '@/components/ui/StatusChip'
import { formatThaiDate } from '@/lib/inventory/presenter'
import {
  PURCHASE_METHOD_LABELS,
  PURCHASE_REQUEST_STATUS_LABELS,
  PURCHASE_REQUEST_STATUS_TONES,
  formatBaht,
  summarizePurchaseRequestReceiving,
} from '@/lib/pr/presenter'
import type { PurchaseRequestRecord } from '@/lib/pr/types'

/** A lease PR carries zero items, so request.total (summed from items) is
 *  always 0 — the ceiling entered on the contract draft is the real figure. */
function leaseCeilingLabel(request: PurchaseRequestRecord): string {
  const draft = request.methodDetails.contractDraft
  const total = draft && typeof draft === 'object' ? (draft as Record<string, unknown>).total : null
  return typeof total === 'number' ? formatBaht(total) : 'ไม่ระบุ'
}

export function PurchaseRequestTable({ requests }: { requests: PurchaseRequestRecord[] }) {
  if (requests.length === 0) {
    return <p className="empty-state">ไม่พบใบ PR ตามเงื่อนไขที่เลือก</p>
  }

  return (
    <>
      <div className="pr-table--desktop">
        <table className="data-table pr-register-table">
          <colgroup>
            <col className="pr-register-table__document" />
            <col className="pr-register-table__ephis" />
            <col className="pr-register-table__date" />
            <col className="pr-register-table__method" />
            <col className="pr-register-table__requester" />
            <col className="pr-register-table__value" />
            <col className="pr-register-table__receiving" />
            <col className="pr-register-table__status" />
            <col className="pr-register-table__action" />
          </colgroup>
          <thead>
            <tr>
              <th>เลขที่ใบ PR</th>
              <th>เลข PR (E-Phis)</th>
              <th>วันที่ขอ</th>
              <th>วิธีจัดซื้อ</th>
              <th>ผู้ขอ</th>
              <th className="numeric-cell">มูลค่า</th>
              <th>รับเข้า</th>
              <th>สถานะ</th>
              <th><span className="visually-hidden">เปิดรายละเอียด</span></th>
            </tr>
          </thead>
          <tbody>
            {requests.map((request) => {
              const receiving = summarizePurchaseRequestReceiving(request.items)
              return (
              <tr key={request.id}>
                <td>
                  <PurchaseRequestSummaryDialog request={request} />
                  <small>{request.poNumber ? `PO ${request.poNumber}` : 'ยังไม่มีเลขที่ใบสั่งซื้อ'}</small>
                </td>
                <td className="identifier">{request.ephisPrNumber ?? 'ยังไม่มี'}</td>
                <td>{formatThaiDate(request.requestedDate)}</td>
                <td>{PURCHASE_METHOD_LABELS[request.purchaseMethod]}</td>
                <td>
                  {request.requesterName ?? 'ไม่ระบุ'}
                  <small>{request.department}</small>
                </td>
                <td className="numeric-cell identifier">
                  {request.purchaseMethod === 'equipment_lease' ? leaseCeilingLabel(request) : formatBaht(request.total)}
                </td>
                <td>
                  {receiving.lineCount === 0 ? (
                    <span className="pr-receiving-summary__empty">—</span>
                  ) : (
                    <span
                      className="pr-receiving-summary"
                      aria-label={`รับแล้ว ${receiving.receivedLineCount} จาก ${receiving.lineCount} รายการ เหลือ ${receiving.remainingLineCount} รายการ`}
                    >
                      <strong>{receiving.receivedLineCount}/{receiving.lineCount}</strong>
                      <small>รับแล้ว · เหลือ {receiving.remainingLineCount} รายการ</small>
                    </span>
                  )}
                </td>
                <td>
                  <StatusChip tone={PURCHASE_REQUEST_STATUS_TONES[request.status]}>
                    {PURCHASE_REQUEST_STATUS_LABELS[request.status]}
                  </StatusChip>
                </td>
                <td>
                  <div className="detail-actions">
                    <DetailIconLink
                      href={`/purchase-requests/${request.id}`}
                      label={`ดูรายละเอียดใบ PR ${request.documentNumber}`}
                      title="ดูรายละเอียดใบ PR"
                    />
                  </div>
                </td>
              </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <ul className="pr-task-cards" aria-label="รายการใบ PR">
        {requests.map((request) => {
          const receiving = summarizePurchaseRequestReceiving(request.items)
          return (
          <li key={request.id}>
            <div className="task-card__topline">
              <StatusChip tone={PURCHASE_REQUEST_STATUS_TONES[request.status]}>
                {PURCHASE_REQUEST_STATUS_LABELS[request.status]}
              </StatusChip>
              <span className="identifier">
                {request.purchaseMethod === 'equipment_lease' ? leaseCeilingLabel(request) : formatBaht(request.total)}
              </span>
            </div>
            <h3 className="identifier"><PurchaseRequestSummaryDialog request={request} variant="card" /></h3>
            <p>
              {PURCHASE_METHOD_LABELS[request.purchaseMethod]} · {formatThaiDate(request.requestedDate)}
              {request.purchaseMethod !== 'equipment_lease' && ` · ${request.items.length} รายการ`}
            </p>
            {receiving.lineCount > 0 && (
              <p className="pr-receiving-summary pr-receiving-summary--card">
                รับแล้ว {receiving.receivedLineCount}/{receiving.lineCount} รายการ · เหลือ {receiving.remainingLineCount} รายการ
              </p>
            )}
            <div className="detail-actions task-card__action">
              <DetailIconLink
                href={`/purchase-requests/${request.id}`}
                label={`ดูรายละเอียดใบ PR ${request.documentNumber}`}
                title="ดูรายละเอียดใบ PR"
              />
            </div>
          </li>
          )
        })}
      </ul>
    </>
  )
}
