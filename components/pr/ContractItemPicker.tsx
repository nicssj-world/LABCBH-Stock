'use client'

import { formatQuantity } from '@/lib/inventory/presenter'
import { MINIMUM_STOCK_WARNING, formatBaht } from '@/lib/pr/presenter'

export interface PickerOption {
  inventoryItemId: string
  contractItemId: string | null
  lsCode: string
  name: string
  unit: string
  unitPrice: number
  /** Null when the purchase does not draw down a contract. */
  contractRemaining: number | null
  onHand: number
  averageMonthlyUsage: number
  belowMinimum: boolean
}

export interface ContractItemPickerProps {
  options: PickerOption[]
  selectedIds: string[]
  onAdd: (option: PickerOption) => void
}

/**
 * Everything the requester would otherwise retype — contracted balance, current
 * on-hand, and rolling usage — is shown at the point of choosing.
 */
export function ContractItemPicker({ options, selectedIds, onAdd }: ContractItemPickerProps) {
  if (options.length === 0) {
    return <p className="empty-state">ยังไม่มีรายการให้เลือกสำหรับวิธีจัดซื้อที่เลือกไว้</p>
  }

  return (
    <ul className="item-picker" aria-label="รายการน้ำยาที่เลือกได้">
      {options.map((option) => {
        const key = option.contractItemId ?? option.inventoryItemId
        const alreadyAdded = selectedIds.includes(key)

        return (
          <li key={key}>
            <div className="item-picker__identity">
              <span className="identifier">{option.lsCode}</span>
              <div>
                <strong>{option.name}</strong>
                {option.belowMinimum && <small className="item-picker__warning">{MINIMUM_STOCK_WARNING}</small>}
              </div>
            </div>

            <dl className="item-picker__facts">
              <div>
                <dt>ยอดคงเหลือในคลัง</dt>
                <dd className="identifier">{formatQuantity(option.onHand, option.unit)}</dd>
              </div>
              <div>
                <dt>เบิกเฉลี่ยต่อเดือน</dt>
                <dd className="identifier">{formatQuantity(option.averageMonthlyUsage, option.unit)}</dd>
              </div>
              <div>
                <dt>คงเหลือในสัญญา</dt>
                <dd className="identifier">
                  {option.contractRemaining === null
                    ? 'ไม่ตัดยอดสัญญา'
                    : formatQuantity(option.contractRemaining, option.unit)}
                </dd>
              </div>
              <div>
                <dt>ราคาต่อหน่วย</dt>
                <dd className="identifier">{formatBaht(option.unitPrice)}</dd>
              </div>
            </dl>

            <button
              className="lab-button lab-button--secondary"
              type="button"
              disabled={alreadyAdded}
              onClick={() => onAdd(option)}
            >
              {alreadyAdded ? 'เพิ่มแล้ว' : 'เพิ่มลงใบ PR'}
            </button>
          </li>
        )
      })}
    </ul>
  )
}
