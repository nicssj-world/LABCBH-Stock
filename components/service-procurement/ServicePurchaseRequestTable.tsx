import Link from 'next/link'
import { formatBaht, serviceMethodLabel, servicePoStatusLabel, serviceStatusLabel } from '@/lib/service-procurement/presenter'
import type { ServicePurchaseRequestRecord } from '@/lib/service-procurement/types'

export function ServicePurchaseRequestTable({ requests }: { requests: ServicePurchaseRequestRecord[] }) {
  return (
    <div className="service-pr-table-wrap">
      <table className="data-table service-pr-table">
        <thead><tr><th>เลข PR</th><th>หน่วยงาน / ผู้ขอ</th><th>วิธีจัดซื้อ</th><th>แผน</th><th>วงเงิน</th><th>สถานะ</th><th>PO</th></tr></thead>
        <tbody>
          {requests.map((request) => (
            <tr key={request.id}>
              <td><Link className="text-link identifier" href={`/service-procurement/purchase-requests/${request.id}`}>{request.documentNumber}</Link><small>{request.requestedDate}</small></td>
              <td>{request.department}<small>{request.requesterName}</small></td>
              <td>{serviceMethodLabel(request.purchaseMethod)}<small>{request.fulfillment === 'complete' ? 'รับครบ' : request.fulfillment === 'partial' ? 'รับบางส่วน' : 'ยังไม่ใช้'}</small></td>
              <td>{request.planName ?? 'นอกแผน'}</td>
              <td className="identifier">{formatBaht(request.requestedAmount)}<small>ใช้จริง {formatBaht(request.actualAmount)}</small></td>
              <td><span className={`status-chip status-chip--${request.status}`}>{serviceStatusLabel(request.status)}</span></td>
              <td>{request.poNumber ?? '—'}<small>{servicePoStatusLabel(request.poStatus)}</small>{request.status === 'confirmed' && request.poNumber && <Link className="text-link" href={`/service-procurement/purchase-requests/${request.id}#service-pr-usage`}>{request.purchaseMethod === 'annual_items' ? 'บันทึกการใช้' : 'บันทึกค่าใช้จ่าย'}</Link>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
