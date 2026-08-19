import Link from 'next/link'
import { EditIcon } from '@/components/inventory/InventoryDetailIcons'
import { InventoryItemActiveControl } from '@/components/inventory/InventoryItemActiveControl'
import { MinimumStockEditor } from '@/components/inventory/MinimumStockEditor'
import { StatusChip } from '@/components/ui/StatusChip'
import {
  STOCK_LEVEL_LABELS,
  STOCK_LEVEL_TONES,
  formatBaht,
  formatQuantity,
} from '@/lib/inventory/presenter'
import type { InventoryItemRecord } from '@/lib/inventory/types'

/** At or below the resolved minimum the officer's next move is to raise a PR. */
function needsPurchaseRequest(item: InventoryItemRecord) {
  return item.stockLevel !== 'healthy'
}

export function InventoryTable({ items, canEdit = false }: { items: InventoryItemRecord[]; canEdit?: boolean }) {
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
              <th className="numeric-cell">ราคาต่อหน่วย</th>
              <th>สถานะ</th>
              <th>หมายเหตุ</th>
              <th><span className="visually-hidden">เปิดรายละเอียด / แก้ไข</span></th>
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
                  <small>{item.minimumStockOverride === null ? 'ค่าที่ระบบแนะนำ' : 'กำหนดเอง'}</small>
                  {canEdit && (
                    <MinimumStockEditor
                      itemId={item.id}
                      itemName={item.name}
                      unit={item.baseUnit}
                      suggestedMinimum={item.suggestedMinimum}
                      minimumStockOverride={item.minimumStockOverride}
                    />
                  )}
                </td>
                <td className="numeric-cell identifier">{formatBaht(item.defaultUnitPrice)}</td>
                <td>
                  <StatusChip tone={STOCK_LEVEL_TONES[item.stockLevel]}>
                    {STOCK_LEVEL_LABELS[item.stockLevel]}
                  </StatusChip>
                  {!item.isActive && <StatusChip tone="danger">ปิดใช้งาน</StatusChip>}
                  {needsPurchaseRequest(item) && <small className="cell-callout">ต้องทำ PR</small>}
                </td>
                <td className="inventory-note-cell">{item.note ?? '—'}</td>
                <td>
                  <Link className="text-link" href={`/inventory/${item.id}`}>ดูรายละเอียด</Link>
                  {canEdit && (
                    <>
                      <Link
                        className="inventory-action-icon"
                        href={`/inventory/${item.id}/edit`}
                        aria-label={`แก้ไขข้อมูล ${item.name}`}
                        title="แก้ไขข้อมูลน้ำยา"
                      >
                        <EditIcon />
                      </Link>
                      <InventoryItemActiveControl itemId={item.id} isActive={item.isActive} compact />
                    </>
                  )}
                </td>
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
              {formatQuantity(item.minimumStock, item.baseUnit)} · ราคาต่อหน่วย {formatBaht(item.defaultUnitPrice)}
            </p>
            <p className="inventory-note-cell"><strong>หมายเหตุ:</strong> {item.note ?? '—'}</p>
            {!item.isActive && <p className="task-card__callout">ปิดใช้งาน</p>}
            {needsPurchaseRequest(item) && <p className="task-card__callout">ต้องทำ PR</p>}
            {canEdit && (
              <MinimumStockEditor
                itemId={item.id}
                itemName={item.name}
                unit={item.baseUnit}
                suggestedMinimum={item.suggestedMinimum}
                minimumStockOverride={item.minimumStockOverride}
              />
            )}
            <Link className="text-link task-card__action" href={`/inventory/${item.id}`}>
              ดูรายละเอียดน้ำยา
            </Link>
            {canEdit && (
              <>
                <Link
                  className="inventory-action-icon task-card__action"
                  href={`/inventory/${item.id}/edit`}
                  aria-label={`แก้ไขข้อมูล ${item.name}`}
                  title="แก้ไขข้อมูลน้ำยา"
                >
                  <EditIcon />
                </Link>
                <InventoryItemActiveControl itemId={item.id} isActive={item.isActive} />
              </>
            )}
          </li>
        ))}
      </ul>
    </>
  )
}
