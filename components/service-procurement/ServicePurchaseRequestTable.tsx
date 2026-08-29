import Link from 'next/link'
import { DetailIconLink } from '@/components/ui/DetailIconLink'
import { ServicePurchaseRequestSummaryDialog } from '@/components/service-procurement/ServicePurchaseRequestSummaryDialog'
import { formatBaht, serviceMethodLabel, serviceRequestDisplayStatus, serviceRequestDisplayStatusLabel, serviceRequestDisplayStatusTone } from '@/lib/service-procurement/presenter'
import type { ServicePurchaseRequestRecord } from '@/lib/service-procurement/types'

export function ServicePurchaseRequestTable({ requests }: { requests: ServicePurchaseRequestRecord[] }) {
  return (
    <>
      <div className="service-pr-table-wrap">
        <table className="data-table service-pr-table">
          <thead><tr><th>เลข PR</th><th>หน่วยงาน / ผู้ขอ</th><th className="service-pr-table__plan-heading">แผน</th><th>วงเงิน</th><th>สถานะ</th><th>PO</th><th className="service-pr-table__action-heading">การทำงาน</th></tr></thead>
          <tbody>
            {requests.map((request) => {
              return <tr key={request.id}>
                <td><ServicePurchaseRequestSummaryDialog request={request} /><small>{request.requestedDate}</small></td>
                <td>{request.department}<small>{request.requesterName}</small></td>
                <td className="service-pr-table__plan-cell">{request.planName ?? 'ไม่พบแผน'}</td>
                <td className="identifier">{formatBaht(request.requestedAmount)}<small>ใช้จริง {formatBaht(request.actualAmount)}</small></td>
                <td>{(() => { const status = serviceRequestDisplayStatus(request); return <span className={`status-chip status-chip--${serviceRequestDisplayStatusTone(status)}`}>{serviceRequestDisplayStatusLabel(status)}</span> })()}</td>
                <td className="service-pr-table__po-cell"><strong className="identifier">{request.poNumber ?? '—'}</strong></td>
                <td className="service-pr-table__action-cell">
                  <div className="service-pr-table__actions" role="group" aria-label={`การทำงานสำหรับใบ PR ${request.documentNumber}`}>
                    <DetailIconLink href={`/service-procurement/purchase-requests/${request.id}`} label={`เปิดรายละเอียดเต็มใบ PR ${request.documentNumber}`} title="เปิดรายละเอียดเต็มใบ PR" />
                  </div>
                </td>
              </tr>
            })}
          </tbody>
        </table>
      </div>
      <ul className="service-pr-cards" aria-label="รายการใบ PR งานจ้าง">
        {requests.map((request) => {
          const status = serviceRequestDisplayStatus(request)
          return (
            <li className="bench-panel service-pr-card" key={request.id}>
              <div className="service-pr-card__topline">
                <div className="service-pr-card__identity">
                  <div className="service-pr-card__number"><ServicePurchaseRequestSummaryDialog request={request} variant="card" /></div>
                  <h3><Link className="text-link" href={`/service-procurement/purchase-requests/${request.id}`}>{request.planName ?? 'ไม่พบแผน'}</Link></h3>
                  <p>{request.department} · {request.requesterName}</p>
                </div>
                <span className={`status-chip status-chip--${serviceRequestDisplayStatusTone(status)}`}>{serviceRequestDisplayStatusLabel(status)}</span>
              </div>
              <dl className="service-pr-card__facts">
                <div><dt>ประเภทงาน</dt><dd>{serviceMethodLabel(request.purchaseMethod)}</dd></div>
                <div><dt>วงเงิน</dt><dd className="identifier">{formatBaht(request.requestedAmount)}<small>ใช้จริง {formatBaht(request.actualAmount)}</small></dd></div>
                <div><dt>ช่วงใช้ PO</dt><dd className="identifier">{request.usageStartDate} – {request.usageEndDate}</dd></div>
                <div><dt>PO</dt><dd className="identifier">{request.poNumber ?? 'ยังไม่มี'}</dd></div>
              </dl>
              <div className="service-pr-card__actions">
                <DetailIconLink href={`/service-procurement/purchase-requests/${request.id}`} label={`เปิดรายละเอียดเต็มใบ PR ${request.documentNumber}`} title="เปิดรายละเอียดเต็มใบ PR" />
              </div>
            </li>
          )
        })}
      </ul>
    </>
  )
}
