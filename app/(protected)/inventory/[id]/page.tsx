import Link from 'next/link'
import { notFound } from 'next/navigation'
import { LotTable } from '@/components/inventory/LotTable'
import { MinimumStockEditor } from '@/components/inventory/MinimumStockEditor'
import { StatusChip } from '@/components/ui/StatusChip'
import { canOperateStock } from '@/lib/auth/access'
import { requireActor } from '@/lib/auth/actor'
import {
  MOVEMENT_TYPE_LABELS,
  STOCK_LEVEL_LABELS,
  STOCK_LEVEL_TONES,
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
  const actor = await requireActor()
  const { id } = await params
  if (!UUID_PATTERN.test(id)) notFound()

  const item = await getInventoryItem(id)
  if (!item) notFound()

  const canEdit = canOperateStock(actor)
  const monthKeys = completedMonthKeys(bangkokToday())
  const usableLots = item.lots.filter((lot) => lot.expiryStatus !== 'expired' && lot.balance > 0)

  return (
    <div className="route-stack">
      <header className="page-heading page-heading--actions">
        <div>
          <Link className="back-link" href="/inventory">← คลังน้ำยา</Link>
          <p className="identifier">{item.lsCode}</p>
          <h1>{item.name}</h1>
          <p>{item.responsibleDepartment ?? 'ไม่ระบุหน่วยงานที่รับผิดชอบ'}</p>
        </div>
        <StatusChip tone={STOCK_LEVEL_TONES[item.stockLevel]}>
          {STOCK_LEVEL_LABELS[item.stockLevel]}
        </StatusChip>
      </header>

      <section className="executive-strip" aria-label="ยอดคงเหลือและเกณฑ์ขั้นต่ำ">
        <div>
          <span>คงเหลือทั้งหมด</span>
          <strong>{formatQuantity(item.onHand, item.baseUnit)}</strong>
          <small>รวมทุกล็อตจากบัญชีเคลื่อนไหว</small>
        </div>
        <div>
          <span>ขั้นต่ำที่ใช้จริง</span>
          <strong>{formatQuantity(item.minimumStock, item.baseUnit)}</strong>
          <small>{item.minimumStockOverride === null ? 'ค่าที่ระบบแนะนำ' : 'ผู้ดูแลกำหนดเอง'}</small>
        </div>
        <div>
          <span>ล็อตที่ใช้งานได้</span>
          <strong>{usableLots.length.toLocaleString('th-TH')}</strong>
          <small>จากทั้งหมด {item.lots.length.toLocaleString('th-TH')} ล็อต</small>
        </div>
        <div>
          <span>เบิกเฉลี่ยต่อเดือน</span>
          <strong>
            {formatQuantity(
              item.monthlyIssues.reduce((sum, value) => sum + value, 0) /
                Math.max(item.monthlyIssues.length, 1),
              item.baseUnit,
            )}
          </strong>
          <small>ค่าเฉลี่ย 3 เดือนที่ผ่านมา</small>
        </div>
      </section>

      {item.stockLevel !== 'healthy' && (
        <p className="inline-alert" role="status">
          ยอดคงเหลืออยู่ที่หรือต่ำกว่าเกณฑ์ขั้นต่ำแล้ว ต้องทำ PR เพื่อเติมสต๊อก
        </p>
      )}

      <div className="inventory-detail-grid">
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

        {canEdit && (
          <aside className="bench-panel" aria-labelledby="minimum-title">
            <div className="bench-panel__header">
              <div>
                <p className="section-kicker">MINIMUM STOCK</p>
                <h2 id="minimum-title">ตั้งค่าขั้นต่ำ</h2>
              </div>
            </div>
            <MinimumStockEditor
              itemId={item.id}
              unit={item.baseUnit}
              suggestedMinimum={item.suggestedMinimum}
              minimumStockOverride={item.minimumStockOverride}
              minimumStockMonths={item.minimumStockMonths}
            />
          </aside>
        )}
      </div>

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

      <section className="bench-panel" aria-labelledby="aliases-title">
        <div className="bench-panel__header">
          <div>
            <p className="section-kicker">RECONCILIATION</p>
            <h2 id="aliases-title">ชื่อเรียกอื่นที่พบในข้อมูลเดิม</h2>
          </div>
          <p>เก็บไว้เพื่อจับคู่กับ Google Sheet เดิมโดยไม่แก้ข้อมูลหลัก</p>
        </div>
        {item.aliases.length === 0 ? (
          <p className="empty-state">ยังไม่พบชื่อเรียกอื่นสำหรับรายการนี้</p>
        ) : (
          <ul className="alias-list">
            {item.aliases.map((alias) => (
              <li key={alias.id}>
                <span className="identifier">{alias.aliasKind}</span>
                <strong>{alias.aliasValue}</strong>
                <small>{alias.source}</small>
              </li>
            ))}
          </ul>
        )}
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
