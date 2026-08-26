import Link from 'next/link'
import { InventoryItemActiveControl } from '@/components/inventory/InventoryItemActiveControl'
import { InventoryItemEditDialog } from '@/components/inventory/InventoryItemEditDialog'
import { InventoryItemSummaryDialog } from '@/components/inventory/InventoryItemSummaryDialog'
import { DocumentOpenIcon } from '@/components/ui/DocumentOpenIcon'
import { StatusChip } from '@/components/ui/StatusChip'
import { StickyScroll } from '@/components/ui/StickyScroll'
import {
  INACTIVE_STATUS_TONE,
  STOCK_LEVEL_LABELS,
  STOCK_LEVEL_TONES,
  formatBaht,
  formatQuantity,
} from '@/lib/inventory/presenter'
import type { InventoryItemRecord } from '@/lib/inventory/types'

export function InventoryTable({
  items,
  canEdit = false,
  departments,
}: {
  items: InventoryItemRecord[]
  canEdit?: boolean
  departments: readonly string[]
}) {
  if (items.length === 0) {
    return <p className="empty-state">ไม่พบรายการน้ำยาตามเงื่อนไขที่เลือก</p>
  }

  return (
    <>
      <StickyScroll className="inventory-table--desktop" ariaLabel="ตารางน้ำยาในคลัง เลื่อนในแนวนอนเพื่อดูคอลัมน์เพิ่มเติม">
        <table className="data-table">
          <thead>
            <tr>
              <th>รหัสพัสดุ / ชื่อน้ำยา</th>
              <th>หน่วยงาน</th>
              <th className="numeric-cell">คงเหลือ</th>
              <th className="numeric-cell">ขั้นต่ำ</th>
              <th className="numeric-cell">ราคาต่อหน่วย</th>
              <th>สถานะ</th>
              <th>หมายเหตุ</th>
              <th><span className="visually-hidden">การดำเนินการ</span></th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>
                  <InventoryItemSummaryDialog item={item} />
                  <small className="identifier">{item.lsCode}</small>
                </td>
                <td>{item.responsibleDepartment ?? 'ไม่ระบุ'}</td>
                <td className="numeric-cell identifier">{formatQuantity(item.onHand, item.baseUnit)}</td>
                <td className="numeric-cell identifier">
                  {formatQuantity(item.minimumStock, item.baseUnit)}
                </td>
                <td className="numeric-cell identifier">{formatBaht(item.defaultUnitPrice)}</td>
                <td>
                  {!item.isActive ? (
                    <StatusChip tone={INACTIVE_STATUS_TONE}>ปิดใช้งาน</StatusChip>
                  ) : (
                    <StatusChip tone={STOCK_LEVEL_TONES[item.stockLevel]}>
                      {STOCK_LEVEL_LABELS[item.stockLevel]}
                    </StatusChip>
                  )}
                </td>
                <td className="inventory-note-cell">{item.note ?? '—'}</td>
                <td>
                  <div className="inventory-actions">
                    <Link
                      className="inventory-action-icon"
                      href={`/inventory/${item.id}`}
                      aria-label={`เปิดรายละเอียดเต็ม ${item.name}`}
                      title="เปิดรายละเอียดน้ำยาเต็ม"
                    >
                      <DocumentOpenIcon />
                    </Link>
                    {canEdit && (
                      <>
                        <InventoryItemEditDialog item={item} departments={departments} />
                        <InventoryItemActiveControl itemId={item.id} isActive={item.isActive} compact />
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </StickyScroll>

      <ul className="inventory-task-cards" aria-label="รายการน้ำยาในคลัง">
        {items.map((item) => (
          <li key={item.id}>
            <div className="task-card__topline">
              {!item.isActive ? (
                <StatusChip tone={INACTIVE_STATUS_TONE}>ปิดใช้งาน</StatusChip>
              ) : (
                <StatusChip tone={STOCK_LEVEL_TONES[item.stockLevel]}>
                  {STOCK_LEVEL_LABELS[item.stockLevel]}
                </StatusChip>
              )}
              <span className="identifier">{item.lsCode}</span>
            </div>
            <h3><InventoryItemSummaryDialog item={item} variant="card" /></h3>
            <p>
              คงเหลือ {formatQuantity(item.onHand, item.baseUnit)} · ขั้นต่ำ{' '}
              {formatQuantity(item.minimumStock, item.baseUnit)} · ราคาต่อหน่วย {formatBaht(item.defaultUnitPrice)}
            </p>
            <p className="inventory-note-cell"><strong>หมายเหตุ:</strong> {item.note ?? '—'}</p>
            <div className="inventory-actions task-card__action">
              <Link
                className="inventory-action-icon"
                href={`/inventory/${item.id}`}
                aria-label={`เปิดรายละเอียดเต็ม ${item.name}`}
                title="เปิดรายละเอียดน้ำยาเต็ม"
              >
                <DocumentOpenIcon />
              </Link>
              {canEdit && (
                <>
                  <InventoryItemEditDialog item={item} departments={departments} />
                  <InventoryItemActiveControl itemId={item.id} isActive={item.isActive} compact />
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
    </>
  )
}
