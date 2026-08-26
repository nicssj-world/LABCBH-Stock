import { InventoryLotActiveControl } from '@/components/inventory/InventoryLotActiveControl'
import { StatusChip } from '@/components/ui/StatusChip'
import { StickyScroll } from '@/components/ui/StickyScroll'
import {
  INACTIVE_STATUS_TONE,
  LOT_EXPIRY_LABELS,
  LOT_EXPIRY_TONES,
  formatQuantity,
  formatThaiDate,
} from '@/lib/inventory/presenter'
import type { InventoryLotRecord } from '@/lib/inventory/types'

export function LotTable({
  lots,
  unit,
  inventoryItemId,
  canEdit = false,
}: {
  lots: InventoryLotRecord[]
  unit: string
  inventoryItemId?: string
  canEdit?: boolean
}) {
  if (lots.length === 0) {
    return <p className="empty-state">ยังไม่มีล็อตที่รับเข้าสำหรับน้ำยารายการนี้</p>
  }

  return (
    <StickyScroll className="lot-table" ariaLabel="ตารางล็อตน้ำยา เลื่อนในแนวนอนเพื่อดูคอลัมน์เพิ่มเติม">
      <table className="data-table">
        <caption className="visually-hidden">
          ล็อตเรียงตามลำดับการเบิกจ่ายแบบ FIFO คือหมดอายุก่อนและรับเข้าก่อน
        </caption>
        <thead>
          <tr>
            <th>รับเข้าเมื่อ</th>
            <th>เลขที่ล็อต</th>
            <th>วันหมดอายุ</th>
            <th className="numeric-cell">คงเหลือ</th>
            <th>สถานะ</th>
            {canEdit && inventoryItemId && <th>จัดการ</th>}
          </tr>
        </thead>
        <tbody>
          {lots.map((lot) => (
            <tr key={lot.id}>
              <td>{formatThaiDate(lot.receivedDate)}</td>
              <td className="identifier">{lot.lotNumber}</td>
              <td>{formatThaiDate(lot.expiryDate)}</td>
              <td className="numeric-cell identifier">
                {formatQuantity(lot.balance, unit)}
                <small>รับเข้า {formatQuantity(lot.originalQuantity, unit)}</small>
              </td>
              <td>
                <div className="lot-table__statuses">
                  {!lot.isActive ? (
                    <StatusChip tone={INACTIVE_STATUS_TONE}>ปิดใช้งาน</StatusChip>
                  ) : (
                    <StatusChip tone={LOT_EXPIRY_TONES[lot.expiryStatus]}>
                      {LOT_EXPIRY_LABELS[lot.expiryStatus]}
                    </StatusChip>
                  )}
                </div>
              </td>
              {canEdit && inventoryItemId && (
                <td>
                  <InventoryLotActiveControl
                    lotId={lot.id}
                    inventoryItemId={inventoryItemId}
                    lotNumber={lot.lotNumber}
                    isActive={lot.isActive}
                  />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </StickyScroll>
  )
}
