'use client'

import { useState } from 'react'
import { ThaiDateInput } from '@/components/ui/ThaiDateInput'
import { bangkokIsoDate } from '@/lib/date/thai'
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
  /** The full contract document, if the contract already has one. */
  fileUrl: string | null
  committeeRosterReady?: boolean
}

export interface AwaitingContractOption {
  id: number
  label: string
  department: string
}

export interface PurchaseMethodFieldsProps {
  /** null until the requester picks one — nothing is chosen on their behalf. */
  purpose: PurchasePurpose | null
  /** null until a method is picked, which is also what blocks submission. */
  method: PurchaseMethod | null
  /** Contracts already at "เริ่มสัญญา", pre-filtered to non-lease and non-expired. */
  contracts: ContractOption[]
  /** Contracts still working through the procurement stages. */
  awaitingContracts: AwaitingContractOption[]
  onPurposeChange: (purpose: PurchasePurpose) => void
  onChange: (method: PurchaseMethod) => void
}

const PURPOSE_CONSEQUENCE: Partial<Record<PurchasePurpose, string>> = {
  purchase_order: 'ตัดยอดในสัญญา (ถ้ามี) และออกใบสั่งซื้อ',
}

function todayIso(): string {
  return bangkokIsoDate()
}

/** The Thai fiscal year rolls on 1 October, mirroring lib/pr/actions.ts's thaiFiscalYear. */
function currentThaiFiscalYear(): number {
  const [year, month] = bangkokIsoDate().split('-').map(Number)
  return year + 543 + (month >= 10 ? 1 : 0)
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
    case 'equipment_lease':
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

type ContractOriginationMethod = Extract<
  PurchaseMethod,
  { kind: 'specific_contract' | 'e_bidding' | 'equipment_lease' }
>

/**
 * Patches the shared contractDraft fields (name/fiscal year/vendor/date).
 * A plain `{ ...method, contractDraft: { ...method.contractDraft, ... } }`
 * doesn't type-check here: with `method` narrowed to a 3-member union, TS
 * can't re-correlate which contractDraft shape goes with which `kind` after
 * a spread, even though each individual branch below is sound. Switching on
 * `method.kind` narrows to exactly one member per branch instead.
 */
function patchContractDraft(
  method: ContractOriginationMethod,
  patch: Partial<Pick<ContractOriginationMethod['contractDraft'], 'fiscalYear' | 'displayName' | 'vendor' | 'sentToStockOfficerDate'>>,
): ContractOriginationMethod {
  switch (method.kind) {
    case 'specific_contract':
    case 'e_bidding':
      return { ...method, contractDraft: { ...method.contractDraft, ...patch } }
    case 'equipment_lease':
      return { ...method, contractDraft: { ...method.contractDraft, ...patch } }
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
  const [fiscalYearDrafts, setFiscalYearDrafts] = useState<Partial<Record<PurchaseMethodKind, string>>>({})
  const methodKinds = purpose === null ? [] : PURCHASE_METHODS_BY_PURPOSE[purpose]

  const selectMethod = (next: PurchaseMethod) => {
    setFiscalYearDrafts({})
    onChange(next)
  }

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
              {PURPOSE_CONSEQUENCE[purposeOption] && (
                <p className="purpose-option__consequence">{PURPOSE_CONSEQUENCE[purposeOption]}</p>
              )}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="method-fieldset">
        <legend>วิธีจัดซื้อ</legend>

        {purpose === null && (
          <p className="empty-state">เลือกจุดประสงค์ด้านบนก่อน แล้ววิธีจัดซื้อที่เลือกได้จะแสดงขึ้นมา</p>
        )}

        <div className="method-options" role="radiogroup" aria-label="วิธีจัดซื้อ">
          {methodKinds.map((kind) => (
            <label key={kind} className="method-option">
              <input
                type="radio"
                name="purchaseMethod"
                value={kind}
                checked={method?.kind === kind}
                onChange={() => selectMethod(emptyMethod(kind, contracts, awaitingContracts))}
              />
              <span>{PURCHASE_METHOD_LABELS[kind]}</span>
            </label>
          ))}
        </div>

        {method !== null && (
          <>
            {method.kind === 'annual_plan' && (
              <div className="method-detail-grid">
                <label className="field-row">
                  ปีงบประมาณของแผน
                  <input
                    type="number"
                    min="2500"
                    max="3000"
                    required
                    value={fiscalYearDrafts[method.kind] ?? method.fiscalYear}
                    onChange={(event) => {
                      const value = event.target.value
                      setFiscalYearDrafts((current) => ({ ...current, [method.kind]: value }))
                      if (value !== '') onChange({ ...method, fiscalYear: Number(value) })
                    }}
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

            {(method.kind === 'specific_contract' || method.kind === 'e_bidding' || method.kind === 'equipment_lease') && (
              <>
                <label className="field-row">
                  ชื่อสัญญา
                  <input
                    type="text"
                    required
                    value={method.contractDraft.displayName}
                    onChange={(event) => onChange(patchContractDraft(method, { displayName: event.target.value }))}
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
                      value={fiscalYearDrafts[method.kind] ?? method.contractDraft.fiscalYear}
                      onChange={(event) => {
                        const value = event.target.value
                        setFiscalYearDrafts((current) => ({ ...current, [method.kind]: value }))
                        if (value !== '') onChange(patchContractDraft(method, { fiscalYear: Number(value) }))
                      }}
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
                      required={method.kind === 'specific_contract'}
                      value={method.contractDraft.vendor ?? ''}
                      onChange={(event) => onChange(patchContractDraft(method, { vendor: event.target.value }))}
                    />
                    {method.kind !== 'specific_contract' && <small>ยังไม่ทราบได้ เว้นว่างไว้ก่อนได้</small>}
                  </label>
                  <label className="field-row">
                    วันที่ส่งเจ้าหน้าที่คลัง
                    <ThaiDateInput
                      required
                      value={method.contractDraft.sentToStockOfficerDate}
                      onChange={(isoDate) => onChange(patchContractDraft(method, { sentToStockOfficerDate: isoDate }))}
                    />
                  </label>
                </div>
              </>
            )}
          </>
        )}
      </fieldset>
    </div>
  )
}
