'use client'

import { Button } from '@/components/ui/Button'
import type { ContractItemUpdateInput } from '@/lib/contracts/types'

interface ContractItemsEditorProps {
  items: ContractItemUpdateInput[]
  onChange: (items: ContractItemUpdateInput[]) => void
  errors?: Record<string, string>
  disabled?: boolean
}

const money = new Intl.NumberFormat('th-TH', {
  style: 'currency',
  currency: 'THB',
  minimumFractionDigits: 2,
})

const emptyItem = (): ContractItemUpdateInput => ({
  id: null,
  lsCode: '',
  name: '',
  quantity: 1,
  unit: '',
  unitPrice: 1,
})

export function ContractItemsEditor({ items, onChange, errors = {}, disabled }: ContractItemsEditorProps) {
  const update = (index: number, field: keyof ContractItemUpdateInput, value: string | number) => {
    onChange(items.map((item, itemIndex) => (
      itemIndex === index ? { ...item, [field]: value } : item
    )))
  }

  const grandTotal = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0)

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

      <div className="items-editor__rows">
        {items.map((item, index) => (
          <fieldset className="item-edit-row" key={item.id ?? `new-${index}`} disabled={disabled}>
            <legend>รายการที่ {index + 1}</legend>
            {item.id && <input type="hidden" name={`items.${index}.id`} value={item.id} />}
            <label>
              รหัสน้ำยา (LS)
              <input value={item.lsCode} onChange={(event) => update(index, 'lsCode', event.target.value)} aria-invalid={Boolean(errors[`items.${index}.lsCode`])} />
              {errors[`items.${index}.lsCode`] && <small className="field-error">{errors[`items.${index}.lsCode`]}</small>}
            </label>
            <label className="item-edit-row__name">
              ชื่อน้ำยา
              <input value={item.name} onChange={(event) => update(index, 'name', event.target.value)} aria-invalid={Boolean(errors[`items.${index}.name`])} />
              {errors[`items.${index}.name`] && <small className="field-error">{errors[`items.${index}.name`]}</small>}
            </label>
            <label>
              จำนวนในสัญญา
              <input type="number" min="0.001" step="0.001" inputMode="decimal" value={item.quantity} onChange={(event) => update(index, 'quantity', Number(event.target.value))} aria-invalid={Boolean(errors[`items.${index}.quantity`])} />
              {errors[`items.${index}.quantity`] && <small className="field-error">{errors[`items.${index}.quantity`]}</small>}
            </label>
            <label>
              หน่วย
              <input value={item.unit} onChange={(event) => update(index, 'unit', event.target.value)} aria-invalid={Boolean(errors[`items.${index}.unit`])} />
              {errors[`items.${index}.unit`] && <small className="field-error">{errors[`items.${index}.unit`]}</small>}
            </label>
            <label>
              ราคาต่อหน่วย
              <input type="number" min="0.01" step="0.01" inputMode="decimal" value={item.unitPrice} onChange={(event) => update(index, 'unitPrice', Number(event.target.value))} aria-invalid={Boolean(errors[`items.${index}.unitPrice`])} />
              {errors[`items.${index}.unitPrice`] && <small className="field-error">{errors[`items.${index}.unitPrice`]}</small>}
            </label>
            <div className="item-edit-row__total">
              <span>ราคารวม</span>
              <strong>{money.format(item.quantity * item.unitPrice)}</strong>
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
