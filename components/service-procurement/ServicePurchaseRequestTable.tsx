import Link from 'next/link'
import { formatBaht, serviceMethodLabel, servicePoStatusLabel, serviceRequestDisplayStatus, serviceRequestDisplayStatusLabel, serviceRequestDisplayStatusTone } from '@/lib/service-procurement/presenter'
import type { ServicePurchaseRequestRecord } from '@/lib/service-procurement/types'

export function ServicePurchaseRequestTable({ requests }: { requests: ServicePurchaseRequestRecord[] }) {
  return (
    <div className="service-pr-table-wrap">
      <table className="data-table service-pr-table">
        <thead><tr><th>เลข PR</th><th>หน่วยงาน / ผู้ขอ</th><th>ประเภทงาน</th><th>แผน</th><th>วงเงิน</th><th>สถานะ</th><th>PO</th></tr></thead>
        <tbody>
          {requests.map((request) => (
            <tr key={request.id}>
              <td><Link className="text-link identifier" href={`/service-procurement/purchase-requests/${request.id}`}>{request.documentNumber}</Link><small>{request.requestedDate}</small></td>
              <td>{request.department}<small>{request.requesterName}</small></td>
              <td>{serviceMethodLabel(request.purchaseMethod)}<small>{request.usageStartDate} – {request.usageEndDate}</small></td>
              <td>{request.planName ?? 'ไม่พบแผน'}</td>
              <td className="identifier">{formatBaht(request.requestedAmount)}<small>ใช้จริง {formatBaht(request.actualAmount)}</small></td>
              <td>{(() => { const status = serviceRequestDisplayStatus(request); return <span className={`status-chip status-chip--${serviceRequestDisplayStatusTone(status)}`}>{serviceRequestDisplayStatusLabel(status)}</span> })()}</td>
              <td>{request.poNumber ?? '—'}<small>{servicePoStatusLabel(request.poStatus)}</small>{request.status === 'confirmed' && (request.poNumber || request.poFileName) && <Link className="text-link" href={`/service-procurement/purchase-requests/${request.id}#service-pr-usage`}>บันทึกค่าใช้จ่าย</Link>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
