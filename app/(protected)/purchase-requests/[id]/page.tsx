import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PurchaseRequestLifecycleControls } from '@/components/pr/PurchaseRequestLifecycleControls'
import { PrReviewPanel } from '@/components/pr/PrReviewPanel'
import { PurchaseRequestPoFileOpenButton } from '@/components/pr/PurchaseRequestPoFileOpenButton'
import { DocumentOpenIcon } from '@/components/ui/DocumentOpenIcon'
import { StatusChip } from '@/components/ui/StatusChip'
import { canOperateStock } from '@/lib/auth/access'
import { requireActor } from '@/lib/auth/actor'
import { formatQuantity, formatThaiDate } from '@/lib/inventory/presenter'
import {
  GOODS_RECEIPT_STATUS_LABELS,
  GOODS_RECEIPT_STATUS_TONES,
} from '@/lib/receipts/presenter'
import {
  PURCHASE_METHOD_LABELS,
  PURCHASE_REQUEST_STATUS_LABELS,
  PURCHASE_REQUEST_STATUS_TONES,
  formatBaht,
} from '@/lib/pr/presenter'
import { canManagePurchaseRequest } from '@/lib/pr/authorization'
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
  // Superseded by contractId on awaiting_contract — kept so a PR submitted
  // before that change still renders its stored reference text correctly.
  reference: 'เอกสารอ้างอิง',
}

const CONTRACT_DRAFT_LABELS: Record<string, string> = {
  fiscalYear: 'ปีงบประมาณ',
  displayName: 'ชื่อสัญญา',
  vendor: 'คู่สัญญา',
  sentToStockOfficerDate: 'วันที่ส่งเจ้าหน้าที่คลัง',
}

export default async function PurchaseRequestDetailPage({ params }: PurchaseRequestDetailPageProps) {
  const actor = await requireActor()
  const { id } = await params
  if (!UUID_PATTERN.test(id)) notFound()

  const request = await getPurchaseRequest(id)
  if (!request) notFound()

  const canReview = canOperateStock(actor)
  const canEdit = canManagePurchaseRequest(actor, request.requesterId) && request.status === 'pending'
  // contractDraft is a nested object with its own rendering below; the flat
  // key/value list here would otherwise print it as "[object Object]".
  const methodDetails = Object.entries(request.methodDetails).filter(
    ([key, value]) => value !== null && key !== 'contractDraft',
  )
  const contractDraft = request.methodDetails.contractDraft
  const contractDraftEntries =
    contractDraft && typeof contractDraft === 'object'
      ? Object.entries(contractDraft as Record<string, unknown>).filter(([, value]) => value !== null)
      : []

  return (
    <div className="route-stack">
      <header className="contract-detail-heading">
        <div className="contract-detail-heading__top">
          <Link className="contract-detail-back" href="/purchase-requests">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path d="m14 6-6 6 6 6M8 12h10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>ใบขอซื้อ</span>
          </Link>
          <div className="contract-detail-heading__status">
            <StatusChip tone={PURCHASE_REQUEST_STATUS_TONES[request.status]}>
              {PURCHASE_REQUEST_STATUS_LABELS[request.status]}
            </StatusChip>
            <StatusChip tone="neutral">{PURCHASE_METHOD_LABELS[request.purchaseMethod]}</StatusChip>
            {canEdit && (
              <PurchaseRequestLifecycleControls
                requestId={request.id}
                documentNumber={request.documentNumber}
              />
            )}
            {canReview && request.status === 'partially_received' && (
              <Link
                className="lab-link-button lab-link-button--primary"
                href={`/receipts/new?purchaseRequestId=${encodeURIComponent(request.id)}&department=${encodeURIComponent(request.department)}`}
              >
                รับเข้าต่อ
              </Link>
            )}
          </div>
        </div>

        <div className="contract-detail-heading__body">
          <div className="contract-detail-heading__identity">
            <h1 className="identifier">{request.documentNumber}</h1>
            <p>{request.poNumber ? `เลขที่ใบสั่งซื้อ (PO) ${request.poNumber}` : 'ยังไม่มีเลขที่ใบสั่งซื้อ (PO)'}</p>
          </div>
          <dl className="contract-detail-heading__value">
            <dt>มูลค่ารวม</dt>
            <dd>{formatBaht(request.total)}</dd>
          </dl>
        </div>

        <dl className="contract-facts contract-facts--split-with-value" aria-label="ข้อมูลสรุปใบ PR">
          <div><dt>ผู้ขอ</dt><dd>{request.requesterName ?? 'ไม่ระบุ'}</dd></div>
          <div><dt>หน่วยงาน</dt><dd>{request.department}</dd></div>
          <div><dt>วันที่ขอ</dt><dd>{formatThaiDate(request.requestedDate)}</dd></div>
          <div className="contract-facts__po">
            <dt>เลขที่ใบสั่งซื้อ (PO)</dt>
            <dd className="identifier contract-facts__po-value">
              <span>{request.poNumber ?? 'ยังไม่มี'}</span>
              {request.poFile.path && !request.poFile.deletedAt && (
                <PurchaseRequestPoFileOpenButton requestId={request.id} />
              )}
            </dd>
          </div>
        </dl>
      </header>

      {(methodDetails.length > 0 || contractDraftEntries.length > 0) && (
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
            {contractDraftEntries.map(([key, value]) => (
              <div key={key}>
                <dt>{CONTRACT_DRAFT_LABELS[key] ?? key}</dt>
                <dd className="identifier">
                  {key === 'sentToStockOfficerDate' ? formatThaiDate(String(value)) : String(value)}
                </dd>
              </div>
            ))}
            {request.createdContractId && (
              <div>
                <dt>สัญญาที่สร้าง</dt>
                <dd>
                  <Link
                    className="lab-button lab-button--secondary document-open-button"
                    href={`/contracts/${request.createdContractId}`}
                  >
                    <DocumentOpenIcon className="document-open-button__icon" />
                    เปิดสัญญา
                  </Link>
                </dd>
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
                <th>รหัสพัสดุ</th>
                <th>ชื่อน้ำยา</th>
                <th className="numeric-cell">ขอซื้อ</th>
                <th className="numeric-cell">รับสะสม</th>
                <th className="numeric-cell">คงเหลือรับเข้า</th>
                <th className="numeric-cell">คงเหลือในสัญญา</th>
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
                  <td className="numeric-cell identifier">{formatQuantity(item.receivedQuantity, item.unit)}</td>
                  <td className="numeric-cell identifier"><strong>{formatQuantity(item.remainingQuantity, item.unit)}</strong></td>
                  <td className="numeric-cell identifier">
                    {item.contractRemaining === null
                      ? 'ไม่ตัดยอดสัญญา'
                      : formatQuantity(item.contractRemaining, item.unit)}
                  </td>
                  <td className="numeric-cell identifier">{formatQuantity(item.monthlyUsageSnapshot, item.unit)}</td>
                  <td className="numeric-cell identifier">{formatBaht(item.unitPrice)}</td>
                  <td className="numeric-cell identifier"><strong>{formatBaht(item.lineTotal)}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="bench-panel" aria-labelledby="pr-receipt-history-title">
        <div className="bench-panel__header">
          <div>
            <p className="section-kicker">RECEIVING HISTORY</p>
            <h2 id="pr-receipt-history-title">ประวัติรับเข้า</h2>
          </div>
          <p>{request.receiptHistory.length} ใบ</p>
        </div>
        {request.receiptHistory.length === 0 ? (
          <p className="empty-state">ยังไม่มีใบรับเข้าที่อ้างอิง PR นี้</p>
        ) : (
          <div className="detail-items-table">
            <table className="data-table">
              <thead>
                <tr>
                  <th>วันที่รับ</th>
                  <th>เลขที่ PO</th>
                  <th>รายการ / LOT / จำนวน</th>
                  <th className="numeric-cell">จำนวนในใบรับ</th>
                  <th>สถานะ</th>
                  <th><span className="visually-hidden">เปิดใบรับเข้า</span></th>
                </tr>
              </thead>
              <tbody>
                {request.receiptHistory.map((receipt) => (
                  <tr key={receipt.id}>
                    <td>{formatThaiDate(receipt.receivedDate)}</td>
                    <td className="identifier">{receipt.poNumber ?? 'ไม่ระบุ'}</td>
                    <td>
                      <div className="pr-receipt-history__items">
                        {receipt.items.length === 0 ? (
                          <span className="pr-receipt-history__empty">ไม่พบรายการรับเข้า</span>
                        ) : (
                          receipt.items.map((item) => (
                            <div key={item.id} className="pr-receipt-history__item">
                              <div className="pr-receipt-history__item-identity">
                                <strong>{item.name}</strong>
                                <small>
                                  {item.lsCode} · LOT {item.lotNumber}
                                  {item.expiryDate ? ` · หมดอายุ ${formatThaiDate(item.expiryDate)}` : ''}
                                </small>
                              </div>
                              <strong className="pr-receipt-history__item-quantity">
                                {formatQuantity(item.quantity, item.unit)}
                              </strong>
                            </div>
                          ))
                        )}
                      </div>
                    </td>
                    <td className="numeric-cell identifier">{formatQuantity(receipt.totalQuantity)}</td>
                    <td>
                      <StatusChip tone={GOODS_RECEIPT_STATUS_TONES[receipt.status]}>
                        {GOODS_RECEIPT_STATUS_LABELS[receipt.status]}
                      </StatusChip>
                      {receipt.cancellationNote && <small>หมายเหตุ: {receipt.cancellationNote}</small>}
                    </td>
                    <td>
                      <Link className="text-link" href={`/receipts/${receipt.id}`}>เปิดใบรับเข้า →</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {canReview && (
        <section
          className={request.status === 'pending' ? 'bench-panel bench-panel--decision' : 'bench-panel'}
          aria-labelledby="pr-review-title"
        >
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
