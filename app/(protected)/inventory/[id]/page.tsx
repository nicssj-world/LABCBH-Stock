import Link from 'next/link'
import { notFound } from 'next/navigation'
import { InventoryItemActiveControl } from '@/components/inventory/InventoryItemActiveControl'
import { LayersIcon, PriceTagIcon, StockBoxIcon, ThresholdIcon, TrendIcon } from '@/components/inventory/InventoryDetailIcons'
import { LotTable } from '@/components/inventory/LotTable'
import { StockAdjustmentDialog } from '@/components/inventory/StockAdjustmentDialog'
import { StatusChip } from '@/components/ui/StatusChip'
import { canOperateStock } from '@/lib/auth/access'
import { requireActor } from '@/lib/auth/actor'
import {
  MOVEMENT_TYPE_LABELS,
  STOCK_LEVEL_LABELS,
  STOCK_LEVEL_TONES,
  formatBaht,
  formatQuantity,
  formatThaiDate,
} from '@/lib/inventory/presenter'
import { completedMonthKeys, bangkokToday, getInventoryItem } from '@/lib/inventory/queries'

interface InventoryDetailPageProps {
  params: Promise<{ id: string }>
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const monthLabel = (isoMonth: string) => {
  const [year, month] = isoMonth.split('-').map(Number)
  return new Intl.DateTimeFormat('th-TH-u-ca-buddhist', { month: 'short', year: 'numeric' }).format(
    new Date(Date.UTC(year, month - 1, 1)),
  )
}

export default async function InventoryDetailPage({ params }: InventoryDetailPageProps) {
  const { id } = await params
  if (!UUID_PATTERN.test(id)) notFound()

  const actor = await requireActor()
  const canEdit = canOperateStock(actor)

  const item = await getInventoryItem(id)
  if (!item) notFound()

  const monthKeys = completedMonthKeys(bangkokToday())
  const usableLots = item.lots.filter((lot) => lot.expiryStatus !== 'expired' && lot.balance > 0)

  return (
    <div className="route-stack">
      <header className="page-heading page-heading--actions inventory-detail__heading">
        <div>
          <Link className="back-link" href="/inventory">← คลังน้ำยา</Link>
          <p className="inventory-detail__code">
            <StatusChip tone="info">{item.lsCode}</StatusChip>
          </p>
          <h1>{item.name}</h1>
          <p>{item.responsibleDepartment ?? 'ไม่ระบุหน่วยงานที่รับผิดชอบ'}</p>
          <div className="inventory-detail__note" role="note">
            <strong>หมายเหตุ</strong>
            <span>{item.note?.trim() || 'ไม่มีหมายเหตุ'}</span>
          </div>
        </div>
        <div className="page-heading__cluster">
          <StatusChip tone={STOCK_LEVEL_TONES[item.stockLevel]}>
            {STOCK_LEVEL_LABELS[item.stockLevel]}
          </StatusChip>
          {!item.isActive && <StatusChip tone="danger">ปิดใช้งานแล้ว</StatusChip>}
          {canEdit && (
            <>
              <StockAdjustmentDialog
                itemId={item.id}
                itemName={item.name}
                unit={item.baseUnit}
                lots={item.lots}
              />
              <Link className="lab-link-button lab-link-button--secondary" href={`/inventory/${item.id}/edit`}>
                แก้ไขข้อมูล
              </Link>
              <InventoryItemActiveControl itemId={item.id} isActive={item.isActive} />
            </>
          )}
        </div>
      </header>

      <section className="executive-strip executive-strip--even-5" aria-label="ยอดคงเหลือ จุดสั่งซื้อ และราคาต่อหน่วย">
        <div className={`executive-strip__card${item.stockLevel !== 'healthy' ? ' executive-strip__cell--risk' : ''}`}>
          <div className="executive-strip__head">
            <span>คงเหลือทั้งหมด</span>
            <span className="executive-strip__icon" aria-hidden="true"><StockBoxIcon /></span>
          </div>
          <strong>{formatQuantity(item.onHand, item.baseUnit)}</strong>
          <small>รวมทุกล็อตจากบัญชีเคลื่อนไหว</small>
        </div>
        <div className="executive-strip__card">
          <div className="executive-strip__head">
            <span>จุดสั่งซื้อ</span>
            <span className="executive-strip__icon" aria-hidden="true"><ThresholdIcon /></span>
          </div>
          <strong>{formatQuantity(item.minimumStock, item.baseUnit)}</strong>
          <small>ถึงจุดนี้หรือต่ำกว่า ควรทำ PR</small>
        </div>
        <div className="executive-strip__card">
          <div className="executive-strip__head">
            <span>ล็อตที่ใช้งานได้</span>
            <span className="executive-strip__icon" aria-hidden="true"><LayersIcon /></span>
          </div>
          <strong>{usableLots.length.toLocaleString('th-TH')}</strong>
          <small>จากทั้งหมด {item.lots.length.toLocaleString('th-TH')} ล็อต</small>
        </div>
        <div className="executive-strip__card">
          <div className="executive-strip__head">
            <span>เบิกเฉลี่ยต่อเดือน</span>
            <span className="executive-strip__icon" aria-hidden="true"><TrendIcon /></span>
          </div>
          <strong>
            {formatQuantity(
              item.monthlyIssues.reduce((sum, value) => sum + value, 0) /
                Math.max(item.monthlyIssues.length, 1),
              item.baseUnit,
            )}
          </strong>
          <small>ค่าเฉลี่ย 3 เดือนที่ผ่านมา</small>
        </div>
        <div className="executive-strip__card">
          <div className="executive-strip__head">
            <span>ราคาต่อหน่วย</span>
            <span className="executive-strip__icon" aria-hidden="true"><PriceTagIcon /></span>
          </div>
          <strong>{formatBaht(item.defaultUnitPrice)}</strong>
          <small>ราคาอ้างอิงล่าสุดที่บันทึกไว้</small>
        </div>
      </section>

      {item.stockLevel !== 'healthy' && (
        <p className="inline-alert" role="status">
          ยอดคงเหลืออยู่ที่หรือต่ำกว่าจุดสั่งซื้อแล้ว ต้องทำ PR เพื่อเติมสต๊อก
        </p>
      )}

      <section className="bench-panel" aria-labelledby="lot-title">
        <div className="bench-panel__header">
          <div>
            <p className="section-kicker">LOTS · FIFO ORDER</p>
            <h2 id="lot-title">ล็อตคงเหลือ</h2>
          </div>
          <p>เรียงตามลำดับที่ควรเบิกก่อน</p>
        </div>
        <LotTable lots={item.lots} unit={item.baseUnit} />
      </section>

      <section className="bench-panel" aria-labelledby="issue-history-title">
        <div className="bench-panel__header">
          <div>
            <p className="section-kicker">ISSUE HISTORY</p>
            <h2 id="issue-history-title">ปริมาณการเบิกรายเดือน</h2>
          </div>
          <p>ใช้คำนวณค่าขั้นต่ำที่ระบบแนะนำ</p>
        </div>
        <dl className="issue-history">
          {monthKeys.map((month, index) => (
            <div key={month}>
              <dt>{monthLabel(month)}</dt>
              <dd className="identifier">{formatQuantity(item.monthlyIssues[index] ?? 0, item.baseUnit)}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="bench-panel" aria-labelledby="movement-title">
        <div className="bench-panel__header">
          <div>
            <p className="section-kicker">LEDGER</p>
            <h2 id="movement-title">ความเคลื่อนไหวล่าสุด</h2>
          </div>
          <p>บัญชีนี้แก้ไขย้อนหลังไม่ได้ ต้องบันทึกรายการกลับรายการแทน</p>
        </div>
        {item.recentMovements.length === 0 ? (
          <p className="empty-state">ยังไม่มีความเคลื่อนไหวของน้ำยารายการนี้</p>
        ) : (
          <div className="detail-items-table">
            <table className="data-table">
              <thead>
                <tr>
                  <th>วันที่</th>
                  <th>ประเภท</th>
                  <th>ล็อต</th>
                  <th className="numeric-cell">จำนวน</th>
                  <th>หมายเหตุ</th>
                </tr>
              </thead>
              <tbody>
                {item.recentMovements.map((movement) => (
                  <tr key={movement.id}>
                    <td>{formatThaiDate(movement.occurredOn)}</td>
                    <td>{MOVEMENT_TYPE_LABELS[movement.movementType]}</td>
                    <td className="identifier">{movement.lotNumber ?? '—'}</td>
                    <td className="numeric-cell identifier">
                      {formatQuantity(movement.quantity, item.baseUnit)}
                    </td>
                    <td>{movement.note ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
