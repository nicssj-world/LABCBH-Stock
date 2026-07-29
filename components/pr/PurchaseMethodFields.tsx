'use client'

import { PURCHASE_METHOD_LABELS } from '@/lib/pr/presenter'
import { PURCHASE_METHODS, type PurchaseMethod, type PurchaseMethodKind } from '@/lib/pr/schema'

export interface ContractOption {
  id: number
  label: string
}

export interface PurchaseMethodFieldsProps {
  method: PurchaseMethod
  contracts: ContractOption[]
  onChange: (method: PurchaseMethod) => void
}

/** A fresh method carries only its own fields, so stale values never leak. */
function emptyMethod(kind: PurchaseMethodKind, contracts: ContractOption[]): PurchaseMethod {
  switch (kind) {
    case 'annual_plan':
      return { kind, fiscalYear: new Date().getFullYear() + 543, planSequence: '' }
    case 'contract':
      return { kind, contractId: contracts[0]?.id ?? 0, purchaseSequence: 1 }
    case 'awaiting_contract':
      return { kind, reference: '' }
    default:
      return { kind }
  }
}

export function PurchaseMethodFields({ method, contracts, onChange }: PurchaseMethodFieldsProps) {
  return (
    <fieldset className="method-fieldset">
      <legend>วิธีจัดซื้อ</legend>

      <div className="method-options" role="radiogroup" aria-label="วิธีจัดซื้อ">
        {PURCHASE_METHODS.map((kind) => (
          <label key={kind} className="method-option">
            <input
              type="radio"
              name="purchaseMethod"
              value={kind}
              checked={method.kind === kind}
              onChange={() => onChange(emptyMethod(kind, contracts))}
            />
            <span>{PURCHASE_METHOD_LABELS[kind]}</span>
          </label>
        ))}
      </div>

      {method.kind === 'annual_plan' && (
        <div className="method-detail-grid">
          <label className="field-row">
            ปีงบประมาณของแผน
            <input
              type="number"
              min="2500"
              max="3000"
              required
              value={method.fiscalYear}
              onChange={(event) => onChange({ ...method, fiscalYear: Number(event.target.value) })}
            />
          </label>
          <label className="field-row">
            ลำดับในแผนจัดซื้อ
            <input
              type="text"
              required
              value={method.planSequence}
              onChange={(event) => onChange({ ...method, planSequence: event.target.value })}
            />
          </label>
        </div>
      )}

      {method.kind === 'contract' && (
        <div className="method-detail-grid">
          <label className="field-row">
            สัญญา
            <select
              required
              value={method.contractId}
              onChange={(event) => onChange({ ...method, contractId: Number(event.target.value) })}
            >
              {contracts.length === 0 && <option value={0}>ยังไม่มีสัญญาที่เริ่มใช้แล้ว</option>}
              {contracts.map((contract) => (
                <option key={contract.id} value={contract.id}>{contract.label}</option>
              ))}
            </select>
          </label>
          <label className="field-row">
            ครั้งที่ซื้อ
            <input
              type="number"
              min="1"
              step="1"
              required
              value={method.purchaseSequence}
              onChange={(event) => onChange({ ...method, purchaseSequence: Number(event.target.value) })}
            />
          </label>
        </div>
      )}

      {method.kind === 'awaiting_contract' && (
        <label className="field-row">
          เอกสารอ้างอิงระหว่างรอทำสัญญา
          <input
            type="text"
            required
            value={method.reference}
            onChange={(event) => onChange({ ...method, reference: event.target.value })}
          />
        </label>
      )}
    </fieldset>
  )
}
