import Link from 'next/link'
import { StatusChip } from '@/components/ui/StatusChip'
import {
  STOCK_LEVEL_LABELS,
  STOCK_LEVEL_TONES,
  formatQuantity,
} from '@/lib/inventory/presenter'
import type { InventoryItemRecord } from '@/lib/inventory/types'

/** At or below the resolved minimum the officer's next move is to raise a PR. */
function needsPurchaseRequest(item: InventoryItemRecord) {
  return item.stockLevel !== 'healthy'
}

export function InventoryTable({ items }: { items: InventoryItemRecord[] }) {
  if (items.length === 0) {
    return <p className="empty-state">ไม่พบรายการน้ำยาตามเงื่อนไขที่เลือก</p>
  }

  return (
    <>
      <div className="inventory-table--desktop">
        <table className="data-table">
          <thead>
            <tr>
              <th>รหัสพัสดุ / ชื่อน้ำยา</th>
              <th>หน่วยงาน</th>
              <th className="numeric-cell">คงเหลือ</th>
              <th className="numeric-cell">ขั้นต่ำ</th>
              <th>สถานะ</th>
              <th><span className="visually-hidden">เปิดรายละเอียด</span></th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>
                  <strong>{item.name}</strong>
                  <small className="identifier">{item.lsCode}</small>
                </td>
                <td>{item.responsibleDepartment ?? 'ไม่ระบุ'}</td>
                <td className="numeric-cell identifier">{formatQuantity(item.onHand, item.baseUnit)}</td>
                <td className="numeric-cell identifier">
                  {formatQuantity(item.minimumStock, item.baseUnit)}
                  {item.minimumStockOverride === null ? <small>ค่าที่ระบบแนะนำ</small> : <small>กำหนดเอง</small>}
                </td>
                <td>
                  <StatusChip tone={STOCK_LEVEL_TONES[item.stockLevel]}>
                    {STOCK_LEVEL_LABELS[item.stockLevel]}
                  </StatusChip>
                  {needsPurchaseRequest(item) && <small className="cell-callout">ต้องทำ PR</small>}
                </td>
                <td><Link className="text-link" href={`/inventory/${item.id}`}>ดูรายละเอียด</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="inventory-task-cards" aria-label="รายการน้ำยาในคลัง">
        {items.map((item) => (
          <li key={item.id}>
            <div className="task-card__topline">
              <StatusChip tone={STOCK_LEVEL_TONES[item.stockLevel]}>
                {STOCK_LEVEL_LABELS[item.stockLevel]}
              </StatusChip>
              <span className="identifier">{item.lsCode}</span>
            </div>
            <h3>{item.name}</h3>
            <p>
              คงเหลือ {formatQuantity(item.onHand, item.baseUnit)} · ขั้นต่ำ{' '}
              {formatQuantity(item.minimumStock, item.baseUnit)}
            </p>
            {needsPurchaseRequest(item) && <p className="task-card__callout">ต้องทำ PR</p>}
            <Link className="text-link task-card__action" href={`/inventory/${item.id}`}>
              ดูรายละเอียดน้ำยา
            </Link>
          </li>
        ))}
      </ul>
    </>
  )
}
