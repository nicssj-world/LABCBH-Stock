'use client'

import { useMemo, useState } from 'react'
import { MoneyInput } from '@/components/ui/MoneyInput'
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

export interface ManualItemInput {
  lsCode: string
  name: string
  unit: string
  unitPrice?: string
}

export interface ContractItemPickerProps {
  options: PickerOption[]
  selectedIds: string[]
  onAdd: (option: PickerOption) => void
  /** New catalogue rows are available for PR methods that do not draw down a contract. */
  onAddManual?: (input: ManualItemInput) => string | null
  /** Service procurement shares the picker interaction but does not need inventory/contract facts. */
  variant?: 'inventory' | 'service'
  /** Service manual lines may capture a starting price before entering the request-line editor. */
  manualUnitPrice?: boolean
}

/**
 * Everything the requester would otherwise retype — contracted balance, current
 * on-hand, and rolling usage — is shown at the point of choosing. The list is
 * gated behind a search box rather than dumped in full: some purchase methods
 * make every catalog item eligible, which can run into the hundreds.
 */
export function ContractItemPicker({
  options,
  selectedIds,
  onAdd,
  onAddManual,
  variant = 'inventory',
  manualUnitPrice = false,
}: ContractItemPickerProps) {
  const [query, setQuery] = useState('')
  const [manualItem, setManualItem] = useState<ManualItemInput>({ lsCode: '', name: '', unit: '' })
  const [manualError, setManualError] = useState<string | null>(null)
  const isService = variant === 'service'
  const itemCodeLabel = isService ? 'รหัส LS' : 'รหัสน้ำยา (LS)'
  const itemNameLabel = isService ? 'ชื่อรายการ' : 'ชื่อน้ำยา'
  const itemUnitLabel = isService ? 'หน่วย' : 'หน่วยนับ'
  const normalizedQuery = query.trim().toLocaleLowerCase('th')
  const matches = useMemo(() => {
    if (!normalizedQuery) return []
    return options.filter((option) =>
      `${option.lsCode} ${option.name}`.toLocaleLowerCase('th').includes(normalizedQuery),
    )
  }, [normalizedQuery, options])

  if (options.length === 0 && !onAddManual) {
    return <p className="empty-state">ยังไม่มีรายการให้เลือกสำหรับวิธีจัดซื้อที่เลือกไว้</p>
  }

  const addManualItem = () => {
    if (!onAddManual) return

    const input = {
      lsCode: manualItem.lsCode.trim(),
      name: manualItem.name.trim(),
      unit: manualItem.unit.trim(),
      ...(manualUnitPrice ? { unitPrice: manualItem.unitPrice?.trim() ?? '' } : {}),
    }
    const missing = [
      !input.lsCode && `กรุณาระบุ${itemCodeLabel}`,
      !input.name && `กรุณาระบุ${itemNameLabel}`,
      !input.unit && `กรุณาระบุ${itemUnitLabel}`,
    ].find((message): message is string => Boolean(message))
    if (missing) {
      setManualError(missing)
      return
    }

    const error = onAddManual(input)
    if (error) {
      setManualError(error)
      return
    }

    setManualItem({ lsCode: '', name: '', unit: '' })
    setManualError(null)
  }

  return (
    <div className={variant === 'service' ? 'item-picker-search item-picker-search--service' : 'item-picker-search'}>
      {options.length > 0 && (
        <>
          <label className="field-row">
            ค้นหารายการ
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={isService ? 'พิมพ์รหัส LS หรือชื่อรายการ…' : 'พิมพ์รหัสน้ำยา (LS) หรือชื่อน้ำยา…'}
              autoComplete="off"
              aria-controls="pr-item-picker-results"
            />
          </label>

          {!normalizedQuery && (
            <p className="empty-state">{isService ? 'พิมพ์รหัส LS หรือชื่อรายการ' : 'พิมพ์รหัสน้ำยา (LS) หรือชื่อน้ำยา'}เพื่อค้นหาจาก {options.length} รายการ</p>
          )}

          {normalizedQuery && matches.length === 0 && (
            <p className="empty-state">ไม่พบรายการที่ตรงกับ “{query.trim()}”</p>
          )}

          {matches.length > 0 && (
            <>
              <ul className="item-picker" id="pr-item-picker-results" aria-label={isService ? 'รายการที่เลือกได้' : 'รายการน้ำยาที่เลือกได้'}>
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
                        {variant === 'inventory' ? (
                          <>
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
                          </>
                        ) : (
                          <div>
                            <dt>หน่วย / ราคาต่อหน่วย</dt>
                            <dd>{option.unit} · <span className="identifier">{formatBaht(option.unitPrice)}</span></dd>
                          </div>
                        )}
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
        </>
      )}

      {onAddManual && (
        <fieldset className="item-picker__manual">
          <legend>เพิ่มรายการที่ยังไม่มีในคลัง</legend>
          <p className="item-picker__manual-note">
            {isService
              ? 'กรอกข้อมูลเองเมื่อค้นหาไม่พบรายการในคลัง แล้วแก้ไขจำนวนและราคาได้ในรายการใบ PR'
              : 'กรอกข้อมูลเองเมื่อค้นหาไม่พบ ระบบจะสร้างรายการน้ำยาในคงคลังให้อัตโนมัติพร้อมใบ PR (ยอดคงเหลือเริ่มต้น 0)'}
          </p>
          <div className="item-picker__manual-fields">
            <label>
              <span>{itemCodeLabel}</span>
              <input
                value={manualItem.lsCode}
                onChange={(event) => setManualItem((current) => ({ ...current, lsCode: event.target.value }))}
                placeholder="เช่น LS046022"
                autoComplete="off"
              />
            </label>
            <label>
              <span>{itemNameLabel}</span>
              <input
                value={manualItem.name}
                onChange={(event) => setManualItem((current) => ({ ...current, name: event.target.value }))}
                placeholder="ชื่อรายการน้ำยา"
                autoComplete="off"
              />
            </label>
            <label>
              <span>{itemUnitLabel}</span>
              <input
                value={manualItem.unit}
                onChange={(event) => setManualItem((current) => ({ ...current, unit: event.target.value }))}
                placeholder="เช่น ขวด"
                autoComplete="off"
              />
            </label>
            {manualUnitPrice && (
              <label>
                <span>ราคาต่อหน่วย</span>
                <MoneyInput
                  min="0"
                  step="0.01"
                  value={manualItem.unitPrice ?? ''}
                  onValueChange={(value) => setManualItem((current) => ({ ...current, unitPrice: value }))}
                  placeholder="0.00"
                />
              </label>
            )}
            <button className="lab-button lab-button--secondary" type="button" onClick={addManualItem}>
              เพิ่มรายการใหม่ลงใบ PR
            </button>
          </div>
          {manualError && <p className="field-error" role="alert">{manualError}</p>}
        </fieldset>
      )}
    </div>
  )
}
