'use client'

import { StatusChip } from '@/components/ui/StatusChip'
import { QuantityInput } from '@/components/ui/QuantityInput'
import { formatQuantity, formatThaiDate } from '@/lib/inventory/presenter'
import type { SelectableLot } from '@/lib/requisitions/types'

export interface LotSelection {
  inventoryLotId: string
  quantity: number | ''
}

export interface LotPickerProps {
  lots: SelectableLot[]
  selections: LotSelection[]
  onToggle: (lot: SelectableLot) => void
  onQuantityChange: (lotId: string, quantity: number | '') => void
}

/**
 * Lots arrive already ranked for FIFO. Rank 1 is what the officer should take
 * first; anything else is allowed but has to be justified above.
 */
export function LotPicker({ lots, selections, onToggle, onQuantityChange }: LotPickerProps) {
  if (lots.length === 0) {
    return <p className="empty-state">ยังไม่มีล็อตของน้ำยารายการนี้ในคลัง</p>
  }

  const selectionOf = (lotId: string) => selections.find((item) => item.inventoryLotId === lotId)

  return (
    <ul className="lot-picker" aria-label="ล็อตที่เลือกจ่ายได้">
      {lots.map((lot, index) => {
        const selection = selectionOf(lot.id)
        const disabledReason = !lot.selectable
          ? lot.balance <= 0
            ? 'ไม่มีคงเหลือ'
            : 'หมดอายุแล้ว'
          : null

        return (
          <li key={lot.id} className={lot.selectable ? undefined : 'lot-picker__row--disabled'}>
            <label className="lot-picker__choice">
              <input
                type="checkbox"
                checked={Boolean(selection)}
                disabled={!lot.selectable}
                onChange={() => onToggle(lot)}
              />
              <span className="lot-picker__rank" aria-hidden="true">{index + 1}</span>
              <span>
                <strong className="identifier">{lot.lotNumber}</strong>
                <small>
                  รับเข้า {formatThaiDate(lot.receivedAt)} · หมดอายุ {formatThaiDate(lot.expiryDate)}
                  {lot.storageLocation ? ` · ${lot.storageLocation}` : ''}
                </small>
              </span>
            </label>

            <span className="identifier lot-picker__balance">คงเหลือ {formatQuantity(lot.balance)}</span>

            {disabledReason ? (
              <StatusChip tone="danger">{disabledReason}</StatusChip>
            ) : (
              <label className="field-row lot-picker__quantity">
                จ่ายจากล็อตนี้
                <QuantityInput
                  min="0.001"
                  max={lot.balance}
                  step="0.001"
                  disabled={!selection}
                  value={selection?.quantity ?? ''}
                  onValueChange={(value) => onQuantityChange(lot.id, value === '' ? '' : Number(value))}
                />
              </label>
            )}
          </li>
        )
      })}
    </ul>
  )
}
