'use client'

import { Button } from '@/components/ui/Button'
import { CatalogItemCombobox } from '@/components/ui/CatalogItemCombobox'
import type { ContractFormItemInput } from '@/lib/contracts/types'

export interface ContractCatalogChoice {
  id: string
  lsCode: string
  name: string
  unit: string
}

interface ContractItemsEditorProps {
  items: ContractFormItemInput[]
  onChange: (items: ContractFormItemInput[]) => void
  errors?: Record<string, string>
  disabled?: boolean
  catalog?: ContractCatalogChoice[]
  /** Only the admin "already started" fast path records opening balances at create time. */
  showOpeningBalance?: boolean
}

const money = new Intl.NumberFormat('th-TH', {
  style: 'currency',
  currency: 'THB',
  minimumFractionDigits: 2,
})

function numericValue(value: number | ''): number {
  return value === '' ? 0 : value
}

const emptyItem = (): ContractFormItemInput => ({
  id: null,
  lsCode: '',
  name: '',
  quantity: 1,
  unit: '',
  unitPrice: 1,
  openingUsedQuantity: null,
})

// The form always starts with one blank row so the editor is never empty. If a
// catalog pick lands while that row is still untouched, fill it in place
// rather than leaving a dangling blank row the officer has to remember to delete.
const isUntouchedRow = (item: ContractFormItemInput) => {
  const blank = emptyItem()
  return !item.id && item.lsCode === blank.lsCode && item.name === blank.name
    && item.unit === blank.unit && item.quantity === blank.quantity && item.unitPrice === blank.unitPrice
}

export function ContractItemsEditor({ items, onChange, errors = {}, disabled, catalog = [], showOpeningBalance }: ContractItemsEditorProps) {
  const update = (index: number, field: keyof ContractFormItemInput, value: string | number | null) => {
    onChange(items.map((item, itemIndex) => (
      itemIndex === index ? { ...item, [field]: value } : item
    )))
  }

  const addFromCatalog = (choice: ContractCatalogChoice) => {
    const filled: ContractFormItemInput = { id: null, lsCode: choice.lsCode, name: choice.name, quantity: 1, unit: choice.unit, unitPrice: 1, openingUsedQuantity: null }
    onChange(items.length === 1 && isUntouchedRow(items[0]) ? [filled] : [...items, filled])
  }

  const grandTotal = items.reduce(
    (sum, item) => sum + numericValue(item.quantity) * numericValue(item.unitPrice),
    0,
  )

  return (
    <section className="items-editor" aria-labelledby="contract-items-title">
      <div className="section-heading-row">
        <div>
          <p className="section-kicker">REAGENT LINES</p>
          <h2 id="contract-items-title">รายการน้ำยาในสัญญา</h2>
        </div>
        <Button variant="secondary" onClick={() => onChange([...items, emptyItem()])} disabled={disabled}>
          เพิ่มรายการน้ำยา
        </Button>
      </div>

      {catalog.length > 0 && (
        <CatalogItemCombobox
          label="ค้นหาน้ำยาจากคลัง"
          placeholder="พิมพ์รหัสพัสดุ หรือชื่อน้ำยา…"
          options={catalog.map((item) => ({
            id: item.id,
            label: `${item.lsCode} · ${item.name}`,
            hint: `หน่วย ${item.unit} · เลือกเพื่อเติมบรรทัดรายการน้ำยา`,
            searchText: `${item.lsCode} ${item.name}`,
          }))}
          onSelect={(id) => {
            const choice = catalog.find((item) => item.id === id)
            if (choice) addFromCatalog(choice)
          }}
        />
      )}

      <div className="items-editor__rows">
        {items.map((item, index) => (
          <fieldset className="item-edit-row" key={item.id ?? `new-${index}`} disabled={disabled}>
            <legend>รายการที่ {index + 1}</legend>
            {item.id && <input type="hidden" name={`items.${index}.id`} value={item.id} />}
            <label>
              <span>รหัสน้ำยา (LS) <span className="field-required" aria-hidden="true">*</span></span>
              <input required value={item.lsCode} onChange={(event) => update(index, 'lsCode', event.target.value)} aria-invalid={Boolean(errors[`items.${index}.lsCode`])} />
              {errors[`items.${index}.lsCode`] && <small className="field-error">{errors[`items.${index}.lsCode`]}</small>}
            </label>
            <label className="item-edit-row__name">
              <span>ชื่อน้ำยา <span className="field-required" aria-hidden="true">*</span></span>
              <input required value={item.name} onChange={(event) => update(index, 'name', event.target.value)} aria-invalid={Boolean(errors[`items.${index}.name`])} />
              {errors[`items.${index}.name`] && <small className="field-error">{errors[`items.${index}.name`]}</small>}
            </label>
            <label>
              <span>จำนวนในสัญญา <span className="field-required" aria-hidden="true">*</span></span>
              <input
                type="number"
                min="0.001"
                step="0.001"
                inputMode="decimal"
                required
                value={item.quantity}
                onChange={(event) => {
                  const value = event.target.value
                  update(index, 'quantity', value === '' ? '' : Number(value))
                }}
                aria-invalid={Boolean(errors[`items.${index}.quantity`])}
              />
              {errors[`items.${index}.quantity`] && <small className="field-error">{errors[`items.${index}.quantity`]}</small>}
            </label>
            <label>
              <span>หน่วย <span className="field-required" aria-hidden="true">*</span></span>
              <input required value={item.unit} onChange={(event) => update(index, 'unit', event.target.value)} aria-invalid={Boolean(errors[`items.${index}.unit`])} />
              {errors[`items.${index}.unit`] && <small className="field-error">{errors[`items.${index}.unit`]}</small>}
            </label>
            <label>
              <span>ราคาต่อหน่วย <span className="field-required" aria-hidden="true">*</span></span>
              <input
                type="number"
                min="0.01"
                step="0.01"
                inputMode="decimal"
                required
                value={item.unitPrice}
                onChange={(event) => {
                  const value = event.target.value
                  update(index, 'unitPrice', value === '' ? '' : Number(value))
                }}
                aria-invalid={Boolean(errors[`items.${index}.unitPrice`])}
              />
              {errors[`items.${index}.unitPrice`] && <small className="field-error">{errors[`items.${index}.unitPrice`]}</small>}
            </label>
            {showOpeningBalance && (
              <label>
                ใช้ไปแล้วก่อนเข้าระบบ
                <input
                  type="number"
                  min="0"
                  max={item.quantity === '' ? undefined : item.quantity}
                  step="0.001"
                  inputMode="decimal"
                  value={item.openingUsedQuantity ?? ''}
                  onChange={(event) => update(index, 'openingUsedQuantity', event.target.value === '' ? null : Number(event.target.value))}
                  aria-invalid={Boolean(errors[`items.${index}.openingUsedQuantity`])}
                />
                <small>คงเหลือจะเป็น {Math.max(numericValue(item.quantity) - (item.openingUsedQuantity ?? 0), 0)} {item.unit}</small>
                {errors[`items.${index}.openingUsedQuantity`] && <small className="field-error">{errors[`items.${index}.openingUsedQuantity`]}</small>}
              </label>
            )}
            <div className="item-edit-row__total">
              <span>ราคารวม</span>
              <strong>{money.format(numericValue(item.quantity) * numericValue(item.unitPrice))}</strong>
            </div>
            <Button
              variant="ghost"
              className="item-edit-row__remove"
              onClick={() => onChange(items.filter((_, itemIndex) => itemIndex !== index))}
              disabled={disabled || items.length === 1}
              aria-label={`ลบรายการที่ ${index + 1}`}
            >
              ลบรายการ
            </Button>
          </fieldset>
        ))}
      </div>

      <div className="items-editor__grand-total">
        <span>ยอดรวมทั้งสัญญา</span>
        <strong>{money.format(grandTotal)}</strong>
      </div>
      {errors.items && <p className="form-error">{errors.items}</p>}
    </section>
  )
}
