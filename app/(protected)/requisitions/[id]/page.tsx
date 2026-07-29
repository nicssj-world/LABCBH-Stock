import Link from 'next/link'
import { notFound } from 'next/navigation'
import { FulfillmentPanel } from '@/components/requisitions/FulfillmentPanel'
import { StatusChip } from '@/components/ui/StatusChip'
import { canOperateStock } from '@/lib/auth/access'
import { requireActor } from '@/lib/auth/actor'
import { bangkokToday } from '@/lib/inventory/queries'
import { formatQuantity, formatThaiDate } from '@/lib/inventory/presenter'
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
  const lotsByItem: Record<string, SelectableLot[]> = {}

  if (canFulfil) {
    const lots = await listSelectableLots(requisition.items.map((item) => item.inventoryItemId))
    for (const [itemId, itemLots] of lots) lotsByItem[itemId] = itemLots
  }

  return (
    <div className="route-stack">
      <header className="contract-detail-heading">
        <div>
          <Link className="back-link" href="/requisitions">← ใบเบิกน้ำยา</Link>
          <div className="contract-detail-heading__status">
            <StatusChip tone={STATUS_TONES[requisition.status]}>
              {STATUS_LABELS[requisition.status]}
            </StatusChip>
            <span>{requisition.department}</span>
          </div>
          <h1 className="identifier">{requisition.documentNumber}</h1>
          <p>ผู้ขอเบิก {requisition.requesterName} · ต้องการรับ {formatThaiDate(requisition.desiredDate)}</p>
        </div>
        {requisition.status === 'fulfilled' && (
          <Link className="lab-link-button lab-link-button--secondary" href={`/requisitions/${requisition.id}/print`}>
            พิมพ์ใบเบิก
          </Link>
        )}
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
                <th>รหัส LS</th>
                <th>ชื่อน้ำยา</th>
                <th className="numeric-cell">ขอเบิก</th>
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
        <section className="bench-panel" aria-labelledby="fulfillment-title">
          <div className="bench-panel__header">
            <div>
              <p className="section-kicker">FIFO FULFILMENT</p>
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
          จ่ายของเมื่อ {formatThaiDate(requisition.fulfilledAt?.slice(0, 10) ?? null)} โดย{' '}
          {requisition.fulfilledByName ?? 'เจ้าหน้าที่คลัง'} · บัญชีเคลื่อนไหวบันทึกแล้วและแก้ย้อนหลังไม่ได้
        </p>
      )}
    </div>
  )
}
