'use client'

import { useMemo, useState } from 'react'
import { formatQuantity } from '@/lib/inventory/presenter'
import { MINIMUM_STOCK_WARNING, formatBaht } from '@/lib/pr/presenter'

const RESULT_LIMIT = 20

export interface PickerOption {
  inventoryItemId: string
  contractItemId: string | null
  lsCode: string
  name: string
  unit: string
  unitPrice: number
  /** Null when the purchase does not draw down a contract. */
  contractRemaining: number | null
  /** The line's original contracted quantity, for gauging how low contractRemaining is. Null alongside contractRemaining. */
  contractedQuantity: number | null
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
 * on-hand, and rolling usage — is shown at the point of choosing. The list is
 * gated behind a search box rather than dumped in full: some purchase methods
 * make every catalog item eligible, which can run into the hundreds.
 */
export function ContractItemPicker({ options, selectedIds, onAdd }: ContractItemPickerProps) {
  const [query, setQuery] = useState('')
  const normalizedQuery = query.trim().toLocaleLowerCase('th')
  const matches = useMemo(() => {
    if (!normalizedQuery) return []
    return options.filter((option) =>
      `${option.lsCode} ${option.name}`.toLocaleLowerCase('th').includes(normalizedQuery),
    )
  }, [normalizedQuery, options])

  if (options.length === 0) {
    return <p className="empty-state">ยังไม่มีรายการให้เลือกสำหรับวิธีจัดซื้อที่เลือกไว้</p>
  }

  return (
    <div className="item-picker-search">
      <label className="field-row">
        ค้นหารายการ
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="พิมพ์รหัสพัสดุ หรือชื่อน้ำยา…"
          autoComplete="off"
          aria-controls="pr-item-picker-results"
        />
      </label>

      {!normalizedQuery && (
        <p className="empty-state">พิมพ์รหัสพัสดุ หรือชื่อน้ำยาเพื่อค้นหาจาก {options.length} รายการ</p>
      )}

      {normalizedQuery && matches.length === 0 && (
        <p className="empty-state">ไม่พบรายการที่ตรงกับ “{query.trim()}”</p>
      )}

      {matches.length > 0 && (
        <>
          <ul className="item-picker" id="pr-item-picker-results" aria-label="รายการน้ำยาที่เลือกได้">
            {matches.slice(0, RESULT_LIMIT).map((option) => {
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
                    className={alreadyAdded ? 'lab-button lab-button--secondary item-picker__added' : 'lab-button lab-button--secondary'}
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
          {matches.length > RESULT_LIMIT && (
            <p className="item-picker__truncated">
              แสดง {RESULT_LIMIT} จาก {matches.length} รายการที่ตรงกัน พิมพ์ให้เจาะจงขึ้นเพื่อจำกัดผลลัพธ์
            </p>
          )}
        </>
      )}
    </div>
  )
}
