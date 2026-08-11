'use client'

/*
THESIS: Contract entry is a traceable bench record, never an opaque multi-step wizard.
OWN-WORLD: Flat white work zones, navy controls, teal identifiers, crisp instrument borders.
STORY: Staff name the contract, record procurement facts, verify every reagent line, then commit once.
FIRST VIEWPORT: Contract metadata and explicit draft state lead; reagent lines and total follow in one scan.
FORM: Established Laboratory Control Bench, Operate mode, dense single-page editor.
*/

import { useEffect, useMemo, useState, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { ThaiDateInput } from '@/components/ui/ThaiDateInput'
import { bangkokIsoDate } from '@/lib/date/thai'
import { ContractItemsEditor, type ContractCatalogChoice } from '@/components/contracts/ContractItemsEditor'
import { createContract, updateContract } from '@/lib/contracts/actions'
import { contractMode } from '@/lib/contracts/budget'
import { CONTRACT_TYPE_LABELS } from '@/lib/contracts/presenter'
import { CONTRACT_DEPARTMENTS, CONTRACT_TYPES, createContractInputSchema, updateContractInputSchema } from '@/lib/contracts/schema'
import type { ContractFormItemInput, ContractRecord } from '@/lib/contracts/types'

interface ContractFormProps {
  mode: 'create' | 'edit'
  contract?: ContractRecord
  catalog?: ContractCatalogChoice[]
  isAdmin?: boolean
  onCancel?: () => void
  onSaved?: () => void
  onDirtyChange?: (dirty: boolean) => void
}

interface FormState {
  fiscalYear: number
  contractType: (typeof CONTRACT_TYPES)[number]
  department: (typeof CONTRACT_DEPARTMENTS)[number]
  displayName: string
  vendor: string
  endDate: string
  sentToProcurementDate: string
  startImmediately: boolean
  contractNumber: string
  items: ContractFormItemInput[]
}

function currentThaiFiscalYear() {
  const [year, month] = bangkokIsoDate().split('-').map(Number)
  return year + (month >= 10 ? 544 : 543)
}

function todayIso() {
  return bangkokIsoDate()
}

function initialState(contract?: ContractRecord): FormState {
  return {
    fiscalYear: contract?.fiscalYear ?? currentThaiFiscalYear(),
    contractType: contract?.contractType ?? 'equipment_lease',
    department: contract?.department ?? CONTRACT_DEPARTMENTS[0],
    displayName: contract?.displayName ?? contract?.product ?? '',
    vendor: contract?.vendor ?? '',
    endDate: contract?.endDate ?? '',
    sentToProcurementDate: todayIso(),
    startImmediately: false,
    contractNumber: '',
    items: contract?.items.map((item) => ({
      id: item.id,
      lsCode: item.lsCode,
      name: item.name,
      quantity: item.quantity,
      unit: item.unit,
      unitPrice: item.unitPrice,
    })) ?? [{ id: null, lsCode: '', name: '', quantity: 1, unit: '', unitPrice: 1, openingUsedQuantity: null }],
  }
}

export function ContractForm({ mode, contract, catalog, isAdmin, onCancel, onSaved, onDirtyChange }: ContractFormProps) {
  const router = useRouter()
  const [state, setState] = useState(() => initialState(contract))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [draftReady, setDraftReady] = useState(false)
  const [isPending, startTransition] = useTransition()
  const draftKey = useMemo(() => `labcbh-contract-draft-${mode}-${contract?.id ?? 'new'}`, [mode, contract?.id])

  // An equipment lease is billed in baht and holds no line items. Offering the
  // items editor would collect input the schema and the database both reject.
  const tracking = contractMode(state.contractType)

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      try {
        const draft = localStorage.getItem(draftKey)
        if (draft) {
          setState(JSON.parse(draft) as FormState)
          setDirty(true)
          setMessage('กู้คืนฉบับร่างที่บันทึกไว้ในอุปกรณ์นี้แล้ว')
        }
      } catch {
        localStorage.removeItem(draftKey)
      } finally {
        setDraftReady(true)
      }
    }, 0)
    return () => window.clearTimeout(timeout)
  }, [draftKey])

  useEffect(() => {
    if (!draftReady || !dirty) return
    const timeout = window.setTimeout(() => localStorage.setItem(draftKey, JSON.stringify(state)), 300)
    return () => window.clearTimeout(timeout)
  }, [draftKey, draftReady, dirty, state])

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!dirty) return
      event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  useEffect(() => {
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])

  const patchState = <Key extends keyof FormState>(key: Key, value: FormState[Key]) => {
    setState((current) => ({ ...current, [key]: value }))
    setDirty(true)
    setMessage(null)
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setErrors({})
    setMessage(null)

    const shared = {
      fiscalYear: state.fiscalYear,
      contractType: state.contractType,
      department: state.department,
      displayName: state.displayName,
      vendor: state.vendor.trim() || null,
      endDate: state.endDate || null,
    }
    // A lease submits no items even if the editor was populated before the
    // type was switched, so a stale draft cannot fail validation invisibly.
    const parsed = mode === 'create'
      ? createContractInputSchema.safeParse({
          ...shared,
          sentToProcurementDate: state.sentToProcurementDate,
          contractNumber: state.startImmediately ? state.contractNumber.trim() : null,
          items: tracking === 'budget'
            ? []
            : state.items.map((item) => ({
                lsCode: item.lsCode,
                name: item.name,
                quantity: item.quantity,
                unit: item.unit,
                unitPrice: item.unitPrice,
                // Only meaningful on the admin "already started" fast path.
                // Omit an untouched field instead of serializing null: the
                // create_contract RPC treats a missing opening balance as
                // "not supplied" and validates numeric values when present.
                ...(state.startImmediately && item.openingUsedQuantity != null
                  ? { openingUsedQuantity: item.openingUsedQuantity }
                  : {}),
              })),
        })
      : updateContractInputSchema.safeParse({
          ...shared,
          expectedUpdatedAt: contract?.updatedAt ?? null,
          items: tracking === 'budget' ? [] : state.items,
        })

    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {}
      for (const issue of parsed.error.issues) {
        const key = issue.path.join('.') || 'form'
        fieldErrors[key] ??= issue.message
      }
      setErrors(fieldErrors)
      setMessage('ตรวจสอบข้อมูลที่ระบุสีแดง แล้วลองบันทึกอีกครั้ง')
      return
    }

    startTransition(async () => {
      try {
        const result = mode === 'create'
          ? await createContract(parsed.data as Parameters<typeof createContract>[0])
          : await updateContract(contract!.id, parsed.data as Parameters<typeof updateContract>[1])
        localStorage.removeItem(draftKey)
        setDirty(false)
        if (mode === 'edit' && onSaved) {
          onSaved?.()
          router.refresh()
          return
        }
        router.push(`/contracts/${result.id}`)
        router.refresh()
      } catch (error) {
        setMessage(error instanceof Error ? error.message : 'บันทึกสัญญาไม่สำเร็จ กรุณาลองใหม่')
      }
    })
  }

  const cancel = () => {
    // Discard the auto-saved draft on an explicit cancel — otherwise it
    // resurfaces on the next "new contract" attempt, since create mode has
    // no contract id to key the draft on.
    localStorage.removeItem(draftKey)
    setDirty(false)
    if (onCancel) onCancel()
    else router.back()
  }

  return (
    <form className="contract-form" onSubmit={submit} noValidate>
      <section className="bench-panel form-panel" aria-labelledby="contract-metadata-title">
        <div className="section-heading-row">
          <div>
            <p className="section-kicker">CONTRACT RECORD</p>
            <h2 id="contract-metadata-title">ข้อมูลสัญญา</h2>
          </div>
          <span className="draft-state" aria-live="polite">{dirty ? 'บันทึกฉบับร่างอัตโนมัติ' : 'ข้อมูลล่าสุดถูกบันทึกแล้ว'}</span>
        </div>
        <div className="form-grid">
          <label>
            ปีงบประมาณ
            <input type="number" min="2500" max="3000" value={state.fiscalYear} onChange={(event) => patchState('fiscalYear', Number(event.target.value))} aria-invalid={Boolean(errors.fiscalYear)} />
            {errors.fiscalYear && <small className="field-error">{errors.fiscalYear}</small>}
          </label>
          <label>
            ประเภทสัญญา
            <select value={state.contractType} onChange={(event) => patchState('contractType', event.target.value as FormState['contractType'])}>
              {CONTRACT_TYPES.map((type) => <option value={type} key={type}>{CONTRACT_TYPE_LABELS[type]}</option>)}
            </select>
          </label>
          <label className="form-grid__wide">
            ชื่อสัญญา
            <input value={state.displayName} onChange={(event) => patchState('displayName', event.target.value)} aria-invalid={Boolean(errors.displayName)} />
            {errors.displayName && <small className="field-error">{errors.displayName}</small>}
          </label>
          <label className="form-grid__wide">
            คู่สัญญา / บริษัท
            <input value={state.vendor} onChange={(event) => patchState('vendor', event.target.value)} aria-invalid={Boolean(errors.vendor)} />
            {errors.vendor && <small className="field-error">{errors.vendor}</small>}
          </label>
          <label>
            หน่วยงาน
            <select value={state.department} onChange={(event) => patchState('department', event.target.value as FormState['department'])}>
              {CONTRACT_DEPARTMENTS.map((department) => <option value={department} key={department}>{department}</option>)}
            </select>
          </label>
          {mode === 'create' && isAdmin && (
            <label className="form-grid__wide field-toggle">
              <input
                type="checkbox"
                checked={state.startImmediately}
                onChange={(event) => patchState('startImmediately', event.target.checked)}
              />
              สัญญานี้เริ่มใช้งานแล้ว (มีเลขที่สัญญาอยู่แล้ว)
            </label>
          )}
          {mode === 'create' && (
            <label>
              {state.startImmediately ? 'วันที่เริ่มสัญญา' : 'วันที่ส่งพัสดุ'}
              <ThaiDateInput value={state.sentToProcurementDate} onChange={(value) => patchState('sentToProcurementDate', value)} aria-invalid={Boolean(errors.sentToProcurementDate)} />
              {errors.sentToProcurementDate && <small className="field-error">{errors.sentToProcurementDate}</small>}
            </label>
          )}
          {mode === 'create' && state.startImmediately && (
            <label>
              เลขที่สัญญา
              <input value={state.contractNumber} onChange={(event) => patchState('contractNumber', event.target.value)} aria-invalid={Boolean(errors.contractNumber)} />
              {errors.contractNumber && <small className="field-error">{errors.contractNumber}</small>}
            </label>
          )}
          <label>
            วันที่สิ้นสุด (ถ้ามี)
            <ThaiDateInput value={state.endDate} onChange={(value) => patchState('endDate', value)} aria-invalid={Boolean(errors.endDate)} />
            {errors.endDate && <small className="field-error">{errors.endDate}</small>}
          </label>
        </div>
      </section>

      {tracking === 'budget' ? (
        <section className="items-editor" aria-labelledby="contract-lease-mode-title">
          <div className="section-heading-row">
            <div>
              <p className="section-kicker">LEASE BUDGET</p>
              <h2 id="contract-lease-mode-title">สัญญาเช่าเครื่องตัดงบเป็นรายเดือน</h2>
            </div>
          </div>
          <p className="items-editor__note">
            สัญญาประเภทนี้ไม่มีรายการน้ำยา บันทึกค่าใช้จ่ายรายเดือนได้ที่หน้ารายละเอียดสัญญา
            หลังบันทึกสัญญาแล้ว
          </p>
        </section>
      ) : (
        <ContractItemsEditor
          items={state.items}
          onChange={(items) => patchState('items', items)}
          errors={errors}
          disabled={isPending}
          catalog={catalog}
          showOpeningBalance={mode === 'create' && isAdmin && state.startImmediately}
        />
      )}

      <div className="form-action-bar">
        <div aria-live="polite">
          {message && <p className={Object.keys(errors).length ? 'form-error' : 'form-notice'}>{message}</p>}
        </div>
        <div className="form-action-bar__buttons">
          <Button variant="secondary" onClick={cancel} disabled={isPending}>ยกเลิก</Button>
          <Button type="submit" disabled={isPending}>{isPending ? 'กำลังบันทึก…' : mode === 'create' ? 'บันทึกสัญญา' : 'บันทึกการแก้ไข'}</Button>
        </div>
      </div>
    </form>
  )
}
