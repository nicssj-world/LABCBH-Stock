'use client'

import { useMemo, useState, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { ContractItemPicker, type PickerOption } from '@/components/pr/ContractItemPicker'
import {
  PurchaseMethodFields,
  emptyMethod,
  type AwaitingContractOption,
  type ContractOption,
} from '@/components/pr/PurchaseMethodFields'
import { ThaiDateInput } from '@/components/ui/ThaiDateInput'
import { formatQuantity } from '@/lib/inventory/presenter'
import { createPurchaseRequest } from '@/lib/pr/actions'
import { LOW_CONTRACT_BALANCE_THRESHOLD_PERCENT, LOW_CONTRACT_BALANCE_WARNING, formatBaht } from '@/lib/pr/presenter'
import { PURCHASE_METHODS_BY_PURPOSE, calculateLineTotal, type PurchaseMethod, type PurchasePurpose } from '@/lib/pr/schema'

export interface CatalogOption {
  inventoryItemId: string
  lsCode: string
  name: string
  unit: string
  defaultUnitPrice: number
  onHand: number
  averageMonthlyUsage: number
  belowMinimum: boolean
}

export interface ContractLineOption extends CatalogOption {
  contractItemId: string
  contractId: number
  contractRemaining: number
  contractedQuantity: number
}

export interface PurchaseRequestFormProps {
  department: string
  departments: readonly string[]
  headName: string
  contracts: ContractOption[]
  awaitingContracts: AwaitingContractOption[]
  contractLines: ContractLineOption[]
  catalog: CatalogOption[]
}

interface DraftLine {
  key: string
  inventoryItemId: string
  contractItemId: string | null
  lsCode: string
  name: string
  unit: string
  unitPrice: number
  requestedQuantity: number
  /** Null when the purchase does not draw down a contract. */
  contractRemaining: number | null
  contractedQuantity: number | null
}

/** Requesting more than the contract has left — the RPC would refuse it too, but the requester should see this before submitting, not after. */
function isOverContractLimit(line: DraftLine): boolean {
  return line.contractRemaining !== null && line.requestedQuantity > line.contractRemaining
}

/** Mirrors the dashboard watchlist's own remaining/contracted < 30% check. */
function isLowContractBalance(line: DraftLine): boolean {
  return (
    line.contractRemaining !== null &&
    line.contractedQuantity !== null &&
    line.contractedQuantity > 0 &&
    (line.contractRemaining / line.contractedQuantity) * 100 < LOW_CONTRACT_BALANCE_THRESHOLD_PERCENT
  )
}

/** Whether switching to `next` invalidates lines already picked under `current`. */
function invalidatesLines(current: PurchaseMethod, next: PurchaseMethod): boolean {
  if (current.kind !== next.kind) return true
  // Only "contract" ties the eligible item list to which contract is picked;
  // every other kind's own-field edits (plan sequence, contract draft text,
  // …) never change what's pickable, so they must not silently wipe lines.
  if (current.kind === 'contract' && next.kind === 'contract') {
    return current.contractId !== next.contractId
  }
  return false
}

export function PurchaseRequestForm({
  department: initialDepartment,
  departments,
  headName: initialHeadName,
  contracts,
  awaitingContracts,
  contractLines,
  catalog,
}: PurchaseRequestFormProps) {
  const router = useRouter()
  const [department, setDepartment] = useState(initialDepartment)
  const [headName, setHeadName] = useState(initialHeadName)
  const [requestedDate, setRequestedDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [note, setNote] = useState('')
  const [purpose, setPurpose] = useState<PurchasePurpose>('purchase_order')
  const [method, setMethod] = useState<PurchaseMethod>({ kind: 'off_plan' })
  const [lines, setLines] = useState<DraftLine[]>([])
  const [clearAnnouncement, setClearAnnouncement] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  // "ซื้อในสัญญา" and "ซื้อเจาะจงระหว่างรอสัญญา" only offer contracts that
  // belong to the department currently selected above.
  const departmentContracts = useMemo(
    () => contracts.filter((contract) => contract.department === department),
    [contracts, department],
  )
  const departmentAwaitingContracts = useMemo(
    () => awaitingContracts.filter((contract) => contract.department === department),
    [awaitingContracts, department],
  )

  // Contract purchases pick from the selected contract's remaining lines;
  // every other method — including opening a new contract — picks straight
  // from the full catalogue, since specific_contract/e_bidding items become a
  // brand-new contract's lines rather than drawing down an existing one.
  const optionsFor = (candidate: PurchaseMethod): PickerOption[] => {
    if (candidate.kind === 'contract') {
      return contractLines
        .filter((line) => line.contractId === candidate.contractId && line.contractRemaining > 0)
        .map((line) => ({
          inventoryItemId: line.inventoryItemId,
          contractItemId: line.contractItemId,
          lsCode: line.lsCode,
          name: line.name,
          unit: line.unit,
          unitPrice: line.defaultUnitPrice,
          contractRemaining: line.contractRemaining,
          contractedQuantity: line.contractedQuantity,
          onHand: line.onHand,
          averageMonthlyUsage: line.averageMonthlyUsage,
          belowMinimum: line.belowMinimum,
        }))
    }

    return catalog.map((item) => ({
      inventoryItemId: item.inventoryItemId,
      contractItemId: null,
      lsCode: item.lsCode,
      name: item.name,
      unit: item.unit,
      unitPrice: item.defaultUnitPrice,
      contractRemaining: null,
      contractedQuantity: null,
      onHand: item.onHand,
      averageMonthlyUsage: item.averageMonthlyUsage,
      belowMinimum: item.belowMinimum,
    }))
  }

  const options: PickerOption[] = optionsFor(method)

  const draftLineFor = (option: PickerOption): DraftLine => ({
    key: option.contractItemId ?? option.inventoryItemId,
    inventoryItemId: option.inventoryItemId,
    contractItemId: option.contractItemId,
    lsCode: option.lsCode,
    name: option.name,
    unit: option.unit,
    unitPrice: option.unitPrice,
    requestedQuantity: 1,
    contractRemaining: option.contractRemaining,
    contractedQuantity: option.contractedQuantity,
  })

  const addLine = (option: PickerOption) => {
    setLines((current) => [...current, draftLineFor(option)])
  }

  const updateLine = (key: string, patch: Partial<DraftLine>) => {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)))
  }

  const removeLine = (key: string) => {
    setLines((current) => current.filter((line) => line.key !== key))
  }

  const changeMethod = (next: PurchaseMethod, reason = 'เปลี่ยนวิธีจัดซื้อ') => {
    const shouldClear = invalidatesLines(method, next)
    setMethod(next)
    if (!shouldClear) return

    // "ซื้อในสัญญา" draws down one specific contract, so its full remaining
    // balance is exactly what the requester is choosing among — fill every
    // line in automatically rather than making them re-search it item by item.
    if (next.kind === 'contract') {
      const nextOptions = optionsFor(next)
      setLines(nextOptions.map(draftLineFor))
      setClearAnnouncement(
        nextOptions.length > 0 ? `เติมรายการทั้งหมดในสัญญาให้อัตโนมัติ (${nextOptions.length} รายการ)` : null,
      )
      return
    }

    setClearAnnouncement(lines.length > 0 ? `ล้างรายการที่เลือกไว้ ${lines.length} รายการ เพราะ${reason}` : null)
    setLines([])
  }

  const changePurpose = (nextPurpose: PurchasePurpose) => {
    setPurpose(nextPurpose)
    const firstKind = PURCHASE_METHODS_BY_PURPOSE[nextPurpose][0]
    changeMethod(emptyMethod(firstKind, departmentContracts, departmentAwaitingContracts), 'เปลี่ยนจุดประสงค์')
  }

  const changeDepartment = (nextDepartment: string) => {
    setDepartment(nextDepartment)
    const nextContracts = contracts.filter((contract) => contract.department === nextDepartment)
    const nextAwaitingContracts = awaitingContracts.filter((contract) => contract.department === nextDepartment)

    // The selected contract may no longer belong to the newly chosen
    // department; fall back to whatever that department actually offers
    // (which may be nothing — PurchaseMethodFields shows that as an
    // empty state rather than leaving a stale, invisible selection).
    if (method.kind === 'contract' && !nextContracts.some((contract) => contract.id === method.contractId)) {
      changeMethod(emptyMethod('contract', nextContracts, nextAwaitingContracts), 'เปลี่ยนหน่วยงานผู้ขอ')
    } else if (
      method.kind === 'awaiting_contract' &&
      !nextAwaitingContracts.some((contract) => contract.id === method.contractId)
    ) {
      changeMethod(emptyMethod('awaiting_contract', nextContracts, nextAwaitingContracts), 'เปลี่ยนหน่วยงานผู้ขอ')
    }
  }

  // A lease originates a contract with zero line items — it never picks from
  // the reagent catalogue or draws down a contract balance.
  const isLease = method.kind === 'equipment_lease'

  const methodSelectionMissing =
    (method.kind === 'contract' && (departmentContracts.length === 0 || method.contractId === 0)) ||
    (method.kind === 'awaiting_contract' && departmentAwaitingContracts.length === 0)

  const hasOverLimitLine = lines.some(isOverContractLimit)

  const total = lines.reduce(
    (sum, line) => sum + calculateLineTotal(line.requestedQuantity, line.unitPrice),
    0,
  )

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)

    startTransition(async () => {
      try {
        const created = await createPurchaseRequest({
          department,
          headName,
          requestedDate,
          note: note.trim() || null,
          method,
          items: lines
            .filter((line) => line.requestedQuantity > 0)
            .map((line) => ({
              inventoryItemId: line.inventoryItemId,
              contractItemId: line.contractItemId,
              requestedQuantity: line.requestedQuantity,
              unit: line.unit,
              unitPrice: line.unitPrice,
            })),
        })
        router.push(`/purchase-requests/${created.id}`)
        router.refresh()
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'สร้างใบ PR ไม่สำเร็จ กรุณาลองใหม่')
      }
    })
  }

  return (
    <form className="route-stack" onSubmit={submit}>
      <section className="bench-panel" aria-labelledby="pr-header-title">
        <div className="bench-panel__header">
          <div>
            <p className="section-kicker">REQUEST HEADER</p>
            <h2 id="pr-header-title">ข้อมูลผู้ขอ</h2>
          </div>
        </div>
        <div className="form-grid">
          <label className="field-row">
            หน่วยงานผู้ขอ
            <select required value={department} onChange={(event) => changeDepartment(event.target.value)}>
              {departments.map((department) => (
                <option value={department} key={department}>{department}</option>
              ))}
            </select>
          </label>
          <label className="field-row">
            หัวหน้างาน
            <input type="text" required value={headName} onChange={(event) => setHeadName(event.target.value)} />
          </label>
          <label className="field-row">
            วันที่ขอซื้อ
            <ThaiDateInput required value={requestedDate} onChange={setRequestedDate} />
          </label>
          <label className="field-row">
            หมายเหตุ
            <textarea rows={3} maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} />
          </label>
        </div>
      </section>

      <section className="bench-panel" aria-labelledby="pr-method-title">
        <div className="bench-panel__header">
          <div>
            <p className="section-kicker">PURCHASE METHOD</p>
            <h2 id="pr-method-title">จุดประสงค์และวิธีจัดซื้อ</h2>
          </div>
        </div>
        <p aria-live="polite" className="visually-hidden">{clearAnnouncement}</p>
        <PurchaseMethodFields
          purpose={purpose}
          method={method}
          contracts={departmentContracts}
          awaitingContracts={departmentAwaitingContracts}
          onPurposeChange={changePurpose}
          onChange={changeMethod}
        />
      </section>

      {method.kind !== 'contract' && !isLease && (
        <section className="bench-panel" aria-labelledby="pr-picker-title">
          <div className="bench-panel__header">
            <div>
              <p className="section-kicker">SELECT ITEMS</p>
              <h2 id="pr-picker-title">เลือกรายการที่ต้องการขอซื้อ</h2>
            </div>
            <p>{options.length} รายการที่เลือกได้</p>
          </div>
          <ContractItemPicker
            options={options}
            selectedIds={lines.map((line) => line.key)}
            onAdd={addLine}
          />
        </section>
      )}

      {isLease ? (
        <section className="bench-panel" aria-labelledby="pr-lease-title">
          <div className="bench-panel__header">
            <div>
              <p className="section-kicker">LEASE BUDGET</p>
              <h2 id="pr-lease-title">สัญญาเช่าเครื่องตัดงบเป็นรายเดือน</h2>
            </div>
          </div>
          <p className="items-editor__note">
            การเช่าเครื่องไม่มีรายการขอซื้อ — บันทึกค่าใช้จ่ายรายเดือนได้ที่หน้ารายละเอียดสัญญาหลังเปิดสัญญาแล้ว
          </p>
        </section>
      ) : (
      <section className="bench-panel" aria-labelledby="pr-lines-title">
        <div className="bench-panel__header">
          <div>
            <p className="section-kicker">REQUEST LINES</p>
            <h2 id="pr-lines-title">รายการในใบ PR</h2>
          </div>
          <p>{lines.length} รายการ</p>
        </div>

        {lines.length === 0 ? (
          <p className="empty-state">
            {method.kind === 'contract'
              ? 'กรุณาเลือกสัญญาก่อน ระบบจะเติมรายการในสัญญาให้อัตโนมัติ'
              : 'ยังไม่ได้เลือกรายการ กรุณาเลือกจากรายการด้านบน'}
          </p>
        ) : (
          <div className="detail-items-table">
            <table className="data-table">
              <thead>
                <tr>
                  <th>รหัสพัสดุ</th>
                  <th>ชื่อน้ำยา</th>
                  <th className="pr-line-cell--center">คงเหลือในสัญญา</th>
                  <th className="pr-line-cell--center">จำนวนที่ขอ</th>
                  <th className="pr-line-cell--center">หน่วย</th>
                  <th className="pr-line-cell--center">ราคาต่อหน่วย</th>
                  <th className="pr-line-cell--center">รวม</th>
                  <th><span className="visually-hidden">นำออก</span></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => {
                  const overLimit = isOverContractLimit(line)
                  return (
                  <tr key={line.key}>
                    <td className="identifier">{line.lsCode}</td>
                    <td>{line.name}</td>
                    <td className="pr-line-cell--center identifier">
                      {line.contractRemaining === null ? (
                        'ไม่ตัดยอดสัญญา'
                      ) : (
                        <>
                          {formatQuantity(line.contractRemaining, line.unit)}
                          {isLowContractBalance(line) && (
                            <small className="item-picker__warning">{LOW_CONTRACT_BALANCE_WARNING}</small>
                          )}
                        </>
                      )}
                    </td>
                    <td className="pr-line-cell--center">
                      <input
                        type="number"
                        className="no-spinner"
                        min="0"
                        step="1"
                        aria-invalid={overLimit}
                        aria-label={`จำนวนที่ขอของ ${line.name}`}
                        value={line.requestedQuantity}
                        onChange={(event) =>
                          updateLine(line.key, { requestedQuantity: Number(event.target.value) })
                        }
                      />
                      {overLimit && (
                        <small className="field-error">
                          เกินยอดคงเหลือในสัญญา ({formatQuantity(line.contractRemaining!, line.unit)})
                        </small>
                      )}
                    </td>
                    <td className="pr-line-cell--center">{line.unit}</td>
                    <td className="pr-line-cell--center">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        required
                        aria-label={`ราคาต่อหน่วยของ ${line.name}`}
                        value={line.unitPrice}
                        onChange={(event) => updateLine(line.key, { unitPrice: Number(event.target.value) })}
                      />
                    </td>
                    <td className="pr-line-cell--center identifier">
                      <strong>{formatBaht(calculateLineTotal(line.requestedQuantity, line.unitPrice))}</strong>
                    </td>
                    <td>
                      <Button variant="ghost" onClick={() => removeLine(line.key)}>นำออก</Button>
                    </td>
                  </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <p className="items-editor__grand-total">
          <span>ยอดรวม</span>
          <strong>{formatBaht(total)}</strong>
        </p>
      </section>
      )}

      {error && <p className="form-error" role="alert">{error}</p>}

      <div className="form-action-bar">
        <p>
          {purpose === 'new_contract'
            ? 'เจ้าหน้าที่คลังกดยืนยันแล้วสร้างสัญญาใหม่ทันที'
            : 'ยอดในสัญญาจะถูกตัดเมื่อเจ้าหน้าที่คลังยืนยันเท่านั้น'}
          {!isLease && lines.length > 0 && ` · ${formatQuantity(lines.length)} รายการ · รวม ${formatBaht(total)}`}
          {methodSelectionMissing && ' · ยังส่งไม่ได้จนกว่าจะมีสัญญาให้เลือกตามเงื่อนไขด้านบน'}
          {hasOverLimitLine && ' · มีรายการที่ขอเกินยอดคงเหลือในสัญญา กรุณาแก้ไขก่อนส่ง'}
        </p>
        <div className="form-action-bar__buttons">
          <Button variant="secondary" onClick={() => router.push('/purchase-requests')} disabled={isPending}>
            ยกเลิก
          </Button>
          <Button type="submit" disabled={isPending || (!isLease && lines.length === 0) || methodSelectionMissing || hasOverLimitLine}>
            {isPending ? 'กำลังส่ง…' : 'ส่งใบ PR'}
          </Button>
        </div>
      </div>
    </form>
  )
}
