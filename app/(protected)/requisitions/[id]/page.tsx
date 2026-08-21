import Link from 'next/link'
import { notFound } from 'next/navigation'
import { FulfillmentPanel } from '@/components/requisitions/FulfillmentPanel'
import { RequisitionLifecycleControls } from '@/components/requisitions/RequisitionLifecycleControls'
import { RequisitionSignaturePanel } from '@/components/requisitions/RequisitionSignaturePanel'
import { StatusChip } from '@/components/ui/StatusChip'
import { canOperateStock } from '@/lib/auth/access'
import { requireActor } from '@/lib/auth/actor'
import { bangkokToday, listOnHand } from '@/lib/inventory/queries'
import { formatQuantity, formatThaiDate, formatThaiDateTime } from '@/lib/inventory/presenter'
import { canManageRequisition } from '@/lib/requisitions/authorization'
import { getRequisition, listSelectableLots } from '@/lib/requisitions/queries'
import type { SelectableLot } from '@/lib/requisitions/types'

interface RequisitionDetailPageProps {
  params: Promise<{ id: string }>
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const STATUS_LABELS = {
  waiting: 'รอจ่าย',
  fulfilled: 'จ่ายสำเร็จ',
  cancelled: 'ยกเลิก',
} as const

const STATUS_TONES = {
  waiting: 'attention',
  fulfilled: 'success',
  cancelled: 'danger',
} as const

export default async function RequisitionDetailPage({ params }: RequisitionDetailPageProps) {
  const actor = await requireActor()
  const { id } = await params
  if (!UUID_PATTERN.test(id)) notFound()

  const requisition = await getRequisition(id)
  if (!requisition) notFound()

  const canFulfil = canOperateStock(actor) && requisition.status === 'waiting'
  // Nothing has left the store while a requisition is waiting, so correcting or
  // withdrawing one moves no stock. Once it is dispensed the ledger is
  // append-only and the record closes.
  const canManage = canManageRequisition(actor, requisition.requesterId) && requisition.status === 'waiting'
  const itemIds = requisition.items.map((item) => item.inventoryItemId)
  const lotsByItem: Record<string, SelectableLot[]> = {}

  // Both reads are answered by the same list of item ids, so the lot picker no
  // longer makes the on-hand figures wait a second round trip behind it.
  const [lots, onHandByItem] = await Promise.all([
    canFulfil ? listSelectableLots(itemIds) : null,
    listOnHand(itemIds),
  ])

  if (lots) {
    for (const [itemId, itemLots] of lots) lotsByItem[itemId] = itemLots
  }

  const totalRequested = requisition.items.reduce((sum, item) => sum + item.requestedQuantity, 0)

  return (
    <div className="route-stack">
      <header className="contract-detail-heading">
        <div className="contract-detail-heading__top">
          <Link className="contract-detail-back" href="/requisitions">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path d="m14 6-6 6 6 6M8 12h10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>ใบเบิกน้ำยา</span>
          </Link>
          <div className="contract-detail-heading__status">
            <StatusChip tone={STATUS_TONES[requisition.status]}>
              {STATUS_LABELS[requisition.status]}
            </StatusChip>
            <span>{requisition.department}</span>
            {canManage && (
              <RequisitionLifecycleControls
                requisitionId={requisition.id}
                documentNumber={requisition.documentNumber}
              />
            )}
            {requisition.status === 'fulfilled' && (
              <Link className="lab-link-button lab-link-button--secondary" href={`/requisitions/${requisition.id}/print`}>
                พิมพ์ใบเบิก
              </Link>
            )}
          </div>
        </div>

        <div className="contract-detail-heading__body">
          <div className="contract-detail-heading__identity">
            <h1 className="identifier">{requisition.documentNumber}</h1>
            <p>ผู้ขอเบิก {requisition.requesterName} · ต้องการรับ {formatThaiDate(requisition.desiredDate)}</p>
          </div>
          <dl className="contract-detail-heading__value">
            <dt>รวมที่ขอ</dt>
            <dd>{formatQuantity(totalRequested)}</dd>
          </dl>
        </div>

        <dl className="contract-facts contract-facts--split-with-value" aria-label="ข้อมูลสรุปใบเบิก">
          <div><dt>ผู้ขอเบิก</dt><dd>{requisition.requesterName}</dd></div>
          <div><dt>หน่วยงาน</dt><dd>{requisition.department}</dd></div>
          <div><dt>จำนวนรายการ</dt><dd className="identifier">{requisition.items.length}</dd></div>
          <div>
            <dt>การจ่ายของ</dt>
            <dd>
              {requisition.status === 'fulfilled'
                ? `${formatThaiDateTime(requisition.fulfilledAt)} · ${requisition.fulfilledByName ?? 'เจ้าหน้าที่คลัง'}`
                : 'ยังไม่จ่าย'}
            </dd>
          </div>
        </dl>
      </header>

      <section className="bench-panel" aria-labelledby="requisition-detail-lines-title">
        <div className="bench-panel__header">
          <div>
            <p className="section-kicker">REQUEST LINES</p>
            <h2 id="requisition-detail-lines-title">รายการที่ขอเบิก</h2>
          </div>
          <p>{requisition.items.length} รายการ</p>
        </div>
        <div className="detail-items-table">
          <table className="data-table">
            <thead>
              <tr>
                <th>รหัสพัสดุ</th>
                <th>ชื่อน้ำยา</th>
                <th className="numeric-cell">ขอเบิก</th>
                <th className="numeric-cell">คงเหลือในคลัง</th>
                <th className="numeric-cell">จ่ายแล้ว</th>
                <th>ล็อตที่จ่าย</th>
              </tr>
            </thead>
            <tbody>
              {requisition.items.map((item) => (
                <tr key={item.id}>
                  <td className="identifier">{item.lsCode}</td>
                  <td>
                    <strong>{item.name}</strong>
                    {item.note && <small>{item.note}</small>}
                  </td>
                  <td className="numeric-cell identifier">{formatQuantity(item.requestedQuantity, item.unit)}</td>
                  <td className="numeric-cell identifier">
                    {formatQuantity(onHandByItem[item.inventoryItemId] ?? 0, item.unit)}
                  </td>
                  <td className="numeric-cell identifier">
                    {item.fulfilledQuantity === null ? '—' : formatQuantity(item.fulfilledQuantity, item.unit)}
                  </td>
                  <td>
                    {item.allocations.length === 0 ? '—' : (
                      <ul className="allocation-list">
                        {item.allocations.map((allocation) => (
                          <li key={allocation.id}>
                            <span className="identifier">{allocation.lotNumber}</span>
                            <span>{formatQuantity(allocation.quantity, item.unit)}</span>
                            {allocation.isFifoOverride && (
                              <small className="allocation-list__override">
                                ข้ามลำดับ FIFO: {allocation.overrideReason}
                              </small>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {canFulfil && (
        <section className="bench-panel bench-panel--decision" aria-labelledby="fulfillment-title">
          <div className="bench-panel__header">
            <div>
              <p className="section-kicker">STOCK OFFICER</p>
              <h2 id="fulfillment-title">เลือกล็อตเพื่อจ่ายของ</h2>
            </div>
            <p>ล็อตเรียงตามลำดับที่ควรจ่ายก่อน</p>
          </div>
          <FulfillmentPanel
            requisitionId={requisition.id}
            items={requisition.items}
            lotsByItem={lotsByItem}
            today={bangkokToday()}
          />
        </section>
      )}

      {requisition.status === 'fulfilled' && (
        <p className="inline-alert" role="status">
          จ่ายของเมื่อ {formatThaiDateTime(requisition.fulfilledAt ?? null)} โดย{' '}
          {requisition.fulfilledByName ?? 'เจ้าหน้าที่คลัง'} · บัญชีเคลื่อนไหวบันทึกแล้วและแก้ย้อนหลังไม่ได้
        </p>
      )}

      {canOperateStock(actor) && requisition.status === 'fulfilled' && !requisition.signedAt && (
        <section className="bench-panel bench-panel--decision" aria-labelledby="signature-title">
          <div className="bench-panel__header">
            <div>
              <p className="section-kicker">STOCK OFFICER</p>
              <h2 id="signature-title">เซ็นต์รับของ</h2>
            </div>
            <p>ให้ผู้รับของเซ็นต์ยืนยันการรับของก่อนปิดใบเบิก</p>
          </div>
          <RequisitionSignaturePanel requisitionId={requisition.id} defaultReceiverName={requisition.requesterName} />
        </section>
      )}

      {requisition.signedAt && (
        <section className="bench-panel" aria-labelledby="signature-evidence-title">
          <div className="bench-panel__header">
            <div>
              <p className="section-kicker">PROOF OF RECEIPT</p>
              <h2 id="signature-evidence-title">หลักฐานการรับของ</h2>
            </div>
          </div>
          <dl className="contract-facts">
            <div><dt>ผู้รับของ</dt><dd>{requisition.receivedByName}</dd></div>
            <div><dt>เซ็นต์รับเมื่อ</dt><dd className="identifier">{formatThaiDateTime(requisition.signedAt)}</dd></div>
          </dl>
          {requisition.signature && (
            // eslint-disable-next-line @next/next/no-img-element -- a data URI signature has no Next.js Image loader to optimize through
            <img className="requisition-signature__evidence" src={requisition.signature} alt="ลายเซ็นต์ผู้รับของ" />
          )}
        </section>
      )}
    </div>
  )
}
