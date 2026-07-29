import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PrReviewPanel } from '@/components/pr/PrReviewPanel'
import { StatusChip } from '@/components/ui/StatusChip'
import { canOperateStock } from '@/lib/auth/access'
import { requireActor } from '@/lib/auth/actor'
import { formatQuantity, formatThaiDate } from '@/lib/inventory/presenter'
import {
  PURCHASE_METHOD_LABELS,
  PURCHASE_REQUEST_STATUS_LABELS,
  PURCHASE_REQUEST_STATUS_TONES,
  formatBaht,
} from '@/lib/pr/presenter'
import { getPurchaseRequest } from '@/lib/pr/queries'

interface PurchaseRequestDetailPageProps {
  params: Promise<{ id: string }>
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const METHOD_DETAIL_LABELS: Record<string, string> = {
  fiscalYear: 'ปีงบประมาณของแผน',
  planSequence: 'ลำดับในแผนจัดซื้อ',
  contractId: 'สัญญาเลขที่ระบบ',
  purchaseSequence: 'ครั้งที่ซื้อ',
  reference: 'เอกสารอ้างอิง',
}

export default async function PurchaseRequestDetailPage({ params }: PurchaseRequestDetailPageProps) {
  const actor = await requireActor()
  const { id } = await params
  if (!UUID_PATTERN.test(id)) notFound()

  const request = await getPurchaseRequest(id)
  if (!request) notFound()

  const canReview = canOperateStock(actor)
  const methodDetails = Object.entries(request.methodDetails).filter(([, value]) => value !== null)

  return (
    <div className="route-stack">
      <header className="contract-detail-heading">
        <div>
          <Link className="back-link" href="/purchase-requests">← ใบขอซื้อ</Link>
          <div className="contract-detail-heading__status">
            <StatusChip tone={PURCHASE_REQUEST_STATUS_TONES[request.status]}>
              {PURCHASE_REQUEST_STATUS_LABELS[request.status]}
            </StatusChip>
            <span>{PURCHASE_METHOD_LABELS[request.purchaseMethod]}</span>
          </div>
          <h1 className="identifier">{request.documentNumber}</h1>
          <p>{request.poNumber ? `ใบสั่งซื้อเลขที่ ${request.poNumber}` : 'ยังไม่มีเลขที่ใบสั่งซื้อ'}</p>
        </div>
      </header>

      <section className="contract-facts" aria-label="ข้อมูลสรุปใบ PR">
        <dl>
          <div><dt>ผู้ขอ</dt><dd>{request.requesterName ?? 'ไม่ระบุ'}</dd></div>
          <div><dt>หน่วยงาน</dt><dd>{request.department}</dd></div>
          <div><dt>วันที่ขอ</dt><dd>{formatThaiDate(request.requestedDate)}</dd></div>
          <div><dt>มูลค่ารวม</dt><dd className="identifier">{formatBaht(request.total)}</dd></div>
        </dl>
      </section>

      {(methodDetails.length > 0 || request.acknowledgedAt) && (
        <section className="bench-panel" aria-labelledby="pr-method-detail-title">
          <div className="bench-panel__header">
            <div>
              <p className="section-kicker">METHOD DETAIL</p>
              <h2 id="pr-method-detail-title">รายละเอียดวิธีจัดซื้อ</h2>
            </div>
          </div>
          <dl className="issue-history">
            {methodDetails.map(([key, value]) => (
              <div key={key}>
                <dt>{METHOD_DETAIL_LABELS[key] ?? key}</dt>
                <dd className="identifier">{String(value)}</dd>
              </div>
            ))}
            {request.acknowledgedAt && (
              <div>
                <dt>ยืนยันโดย</dt>
                <dd>{request.acknowledgedByName ?? 'เจ้าหน้าที่คลัง'}</dd>
              </div>
            )}
          </dl>
        </section>
      )}

      <section className="bench-panel" aria-labelledby="pr-detail-lines-title">
        <div className="bench-panel__header">
          <div>
            <p className="section-kicker">REQUEST LINES</p>
            <h2 id="pr-detail-lines-title">รายการที่ขอซื้อ</h2>
          </div>
          <p>{request.items.length} รายการ · {formatBaht(request.total)}</p>
        </div>
        <div className="detail-items-table">
          <table className="data-table">
            <thead>
              <tr>
                <th>รหัส LS</th>
                <th>ชื่อน้ำยา</th>
                <th className="numeric-cell">ขอซื้อ</th>
                <th className="numeric-cell">คงเหลือขณะยื่น</th>
                <th className="numeric-cell">เบิกเฉลี่ย/เดือน</th>
                <th className="numeric-cell">ราคาต่อหน่วย</th>
                <th className="numeric-cell">รวม</th>
              </tr>
            </thead>
            <tbody>
              {request.items.map((item) => (
                <tr key={item.id}>
                  <td className="identifier">{item.lsCode}</td>
                  <td>
                    <strong>{item.name}</strong>
                    <small>{item.contractDisplayName ?? 'ไม่ตัดยอดสัญญา'}</small>
                  </td>
                  <td className="numeric-cell identifier">{formatQuantity(item.requestedQuantity, item.unit)}</td>
                  <td className="numeric-cell identifier">{formatQuantity(item.onHandSnapshot, item.unit)}</td>
                  <td className="numeric-cell identifier">{formatQuantity(item.monthlyUsageSnapshot, item.unit)}</td>
                  <td className="numeric-cell identifier">{formatBaht(item.unitPrice)}</td>
                  <td className="numeric-cell identifier"><strong>{formatBaht(item.lineTotal)}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {canReview && (
        <section className="bench-panel" aria-labelledby="pr-review-title">
          <div className="bench-panel__header">
            <div>
              <p className="section-kicker">STOCK OFFICER</p>
              <h2 id="pr-review-title">การดำเนินการของเจ้าหน้าที่คลัง</h2>
            </div>
          </div>
          <PrReviewPanel request={request} />
        </section>
      )}
    </div>
  )
}
