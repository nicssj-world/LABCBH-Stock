'use client'

import { ThaiDateInput } from '@/components/ui/ThaiDateInput'
import { CONTRACT_TYPE_LABELS } from '@/lib/contracts/presenter'
import { PURCHASE_METHOD_LABELS, PURCHASE_PURPOSE_LABELS } from '@/lib/pr/presenter'
import {
  PURCHASE_METHODS_BY_PURPOSE,
  PURCHASE_PURPOSES,
  contractTypeForMethod,
  type PurchaseMethod,
  type PurchaseMethodKind,
  type PurchasePurpose,
} from '@/lib/pr/schema'

export interface ContractOption {
  id: number
  label: string
  /** Used to filter this contract out once the requester picks a different department. */
  department: string
  nextPurchaseSequence: number
}

export interface AwaitingContractOption {
  id: number
  label: string
  department: string
}

export interface PurchaseMethodFieldsProps {
  purpose: PurchasePurpose
  method: PurchaseMethod
  /** Contracts already at "เริ่มสัญญา", pre-filtered to non-lease and non-expired. */
  contracts: ContractOption[]
  /** Contracts still working through the procurement stages. */
  awaitingContracts: AwaitingContractOption[]
  onPurposeChange: (purpose: PurchasePurpose) => void
  onChange: (method: PurchaseMethod) => void
}

const PURPOSE_CONSEQUENCE: Record<PurchasePurpose, string> = {
  purchase_order: 'ตัดยอดในสัญญา (ถ้ามี) และออกใบสั่งซื้อ',
  new_contract: 'เจ้าหน้าที่คลังกดยืนยันแล้วสร้างสัญญาใหม่ทันที',
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

/** The Thai fiscal year rolls on 1 October, mirroring lib/pr/actions.ts's thaiFiscalYear. */
function currentThaiFiscalYear(): number {
  const now = new Date()
  return now.getFullYear() + 543 + (now.getMonth() >= 9 ? 1 : 0)
}

/** A fresh method carries only its own fields, so stale values never leak. */
export function emptyMethod(
  kind: PurchaseMethodKind,
  contracts: ContractOption[],
  awaitingContracts: AwaitingContractOption[],
): PurchaseMethod {
  switch (kind) {
    case 'annual_plan':
      return { kind, fiscalYear: currentThaiFiscalYear(), planSequence: '' }
    case 'contract':
      // contractId 0 is the unselected placeholder — the requester must pick
      // a contract deliberately, since picking one now auto-fills every line
      // of the PR from it. Auto-selecting contracts[0] would silently fill
      // from whichever contract happens to sort first.
      return { kind, contractId: 0, purchaseSequence: 1 }
    case 'awaiting_contract':
      return { kind, contractId: awaitingContracts[0]?.id ?? 0 }
    case 'off_plan':
      return { kind }
    case 'specific_contract':
    case 'e_bidding':
      return {
        kind,
        contractDraft: {
          fiscalYear: currentThaiFiscalYear(),
          displayName: '',
          vendor: null,
          sentToStockOfficerDate: todayIso(),
        },
      }
  }
}

export function PurchaseMethodFields({
  purpose,
  method,
  contracts,
  awaitingContracts,
  onPurposeChange,
  onChange,
}: PurchaseMethodFieldsProps) {
  const methodKinds = PURCHASE_METHODS_BY_PURPOSE[purpose]

  return (
    <div className="method-stack">
      <fieldset className="purpose-fieldset">
        <legend>จุดประสงค์</legend>

        <div className="purpose-options" role="radiogroup" aria-label="จุดประสงค์">
          {PURCHASE_PURPOSES.map((purposeOption) => (
            <label key={purposeOption} className="purpose-option">
              <span className="purpose-option__title">
                <input
                  type="radio"
                  name="purchasePurpose"
                  value={purposeOption}
                  checked={purpose === purposeOption}
                  onChange={() => onPurposeChange(purposeOption)}
                />
                {PURCHASE_PURPOSE_LABELS[purposeOption]}
              </span>
              <p className="purpose-option__consequence">{PURPOSE_CONSEQUENCE[purposeOption]}</p>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="method-fieldset">
        <legend>วิธีจัดซื้อ</legend>

        <div className="method-options" role="radiogroup" aria-label="วิธีจัดซื้อ">
          {methodKinds.map((kind) => (
            <label key={kind} className="method-option">
              <input
                type="radio"
                name="purchaseMethod"
                value={kind}
                checked={method.kind === kind}
                onChange={() => onChange(emptyMethod(kind, contracts, awaitingContracts))}
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
          contracts.length === 0 ? (
            <p className="empty-state">
              หน่วยงานนี้ยังไม่มีสัญญาที่เริ่มใช้แล้ว — เลือกวิธีจัดซื้ออื่น หรือเปลี่ยนหน่วยงานผู้ขอ
            </p>
          ) : (
            <div className="method-detail-grid">
              <label className="field-row">
                สัญญา
                <select
                  required
                  value={method.contractId}
                  onChange={(event) => {
                    const contractId = Number(event.target.value)
                    const contract = contracts.find((option) => option.id === contractId)
                    onChange({ ...method, contractId, purchaseSequence: contract?.nextPurchaseSequence ?? 1 })
                  }}
                >
                  <option value={0} disabled>เลือกสัญญา</option>
                  {contracts.map((contract) => (
                    <option key={contract.id} value={contract.id}>{contract.label}</option>
                  ))}
                </select>
              </label>
              <label className="field-row">
                ครั้งที่ซื้อ
                <input type="text" inputMode="numeric" required readOnly value={method.purchaseSequence} />
                <small>กำหนดอัตโนมัติจากสัญญาที่เลือก</small>
              </label>
            </div>
          )
        )}

        {method.kind === 'awaiting_contract' && (
          awaitingContracts.length === 0 ? (
            <p className="empty-state">
              หน่วยงานนี้ยังไม่มีสัญญาที่อยู่ระหว่างดำเนินการ — เลือกวิธีจัดซื้ออื่น หรือเปลี่ยนหน่วยงานผู้ขอ
            </p>
          ) : (
            <label className="field-row">
              สัญญาที่รอดำเนินการ
              <select
                required
                value={method.contractId}
                onChange={(event) => onChange({ ...method, contractId: Number(event.target.value) })}
              >
                {awaitingContracts.map((contract) => (
                  <option key={contract.id} value={contract.id}>{contract.label}</option>
                ))}
              </select>
            </label>
          )
        )}

        {(method.kind === 'specific_contract' || method.kind === 'e_bidding') && (
          <>
            <label className="field-row">
              ชื่อสัญญา
              <input
                type="text"
                required
                value={method.contractDraft.displayName}
                onChange={(event) =>
                  onChange({ ...method, contractDraft: { ...method.contractDraft, displayName: event.target.value } })
                }
              />
            </label>

            <div className="method-detail-grid">
              <label className="field-row">
                ปีงบประมาณ
                <input
                  type="number"
                  min="2500"
                  max="3000"
                  required
                  value={method.contractDraft.fiscalYear}
                  onChange={(event) =>
                    onChange({
                      ...method,
                      contractDraft: { ...method.contractDraft, fiscalYear: Number(event.target.value) },
                    })
                  }
                />
              </label>
              <label className="field-row">
                ประเภทสัญญา
                <input type="text" readOnly value={CONTRACT_TYPE_LABELS[contractTypeForMethod(method.kind)!]} />
                <small>กำหนดจากวิธีจัดซื้อที่เลือกไว้</small>
              </label>
              <label className="field-row">
                คู่สัญญา
                <input
                  type="text"
                  required
                  value={method.contractDraft.vendor ?? ''}
                  onChange={(event) =>
                    onChange({
                      ...method,
                      contractDraft: { ...method.contractDraft, vendor: event.target.value },
                    })
                  }
                />
              </label>
              <label className="field-row">
                วันที่ส่งเจ้าหน้าที่คลัง
                <ThaiDateInput
                  required
                  value={method.contractDraft.sentToStockOfficerDate}
                  onChange={(isoDate) =>
                    onChange({
                      ...method,
                      contractDraft: { ...method.contractDraft, sentToStockOfficerDate: isoDate },
                    })
                  }
                />
              </label>
            </div>
          </>
        )}
      </fieldset>
    </div>
  )
}
