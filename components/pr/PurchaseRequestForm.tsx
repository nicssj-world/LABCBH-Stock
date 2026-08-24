'use client'

import { useMemo, useState, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { ContractItemPicker, type ManualItemInput, type PickerOption } from '@/components/pr/ContractItemPicker'
import {
  PurchaseMethodFields,
  emptyMethod,
  type AwaitingContractOption,
  type ContractOption,
} from '@/components/pr/PurchaseMethodFields'
import { ThaiDateInput } from '@/components/ui/ThaiDateInput'
import { bangkokIsoDate } from '@/lib/date/thai'
import { normalizeLsCode } from '@/lib/inventory/ls-code'
import { formatQuantity } from '@/lib/inventory/presenter'
import { createPurchaseRequest, updatePurchaseRequest } from '@/lib/pr/actions'
import { LOW_CONTRACT_BALANCE_THRESHOLD_PERCENT, LOW_CONTRACT_BALANCE_WARNING, formatBaht } from '@/lib/pr/presenter'
import { calculateLineTotal, type PurchaseMethod, type PurchasePurpose } from '@/lib/pr/schema'
import {
  PurchaseRequestChecklistFields,
  checklistFileFingerprint,
  purchaseRequestFileMime,
  uploadChecklistFiles,
  type ChecklistFileSelections,
  type UploadedChecklistFile,
  type UploadedChecklistFiles,
} from '@/components/pr/PurchaseRequestChecklistFields'
import {
  derivePurchaseRequestChecklist,
  purchaseRequestAttachmentSlotKey,
  validateCommitteeAssignments,
  validatePurchaseRequestAttachment,
  type CommitteeAssignmentInput,
} from '@/lib/pr/checklist'
import type { PurchaseRequestCommitteeCandidate } from '@/lib/pr/form-options'
import type { PurchaseRequestChecklistRecord } from '@/lib/pr/types'

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

export interface PurchaseRequestFormInitialItem {
  inventoryItemId: string
  contractItemId: string | null
  lsCode: string
  name: string
  unit: string
  requestedQuantity: number
  unitPrice: number
  contractRemaining: number | null
  monthlyUsageSnapshot: number
}

export interface PurchaseRequestFormInitialValues {
  requestId: string
  requestedDate: string
  note: string | null
  purpose: PurchasePurpose
  method: PurchaseMethod
  items: PurchaseRequestFormInitialItem[]
  checklistPolicyVersion: number | null
  checklist: PurchaseRequestChecklistRecord | null
}

export interface PurchaseRequestFormProps {
  department: string
  departments: readonly string[]
  headName: string
  contracts: ContractOption[]
  awaitingContracts: AwaitingContractOption[]
  contractLines: ContractLineOption[]
  catalog: CatalogOption[]
  committeeCandidates: PurchaseRequestCommitteeCandidate[]
  mode?: 'create' | 'edit'
  initialValues?: PurchaseRequestFormInitialValues
}

interface DraftLine {
  key: string
  inventoryItemId: string | null
  contractItemId: string | null
  lsCode: string
  name: string
  unit: string
  unitPrice: number
  requestedQuantity: number
  /** Null when the purchase does not draw down a contract. */
  contractRemaining: number | null
  contractedQuantity: number | null
  /** Reference only — the confirmed snapshot is computed server-side at submission. */
  averageMonthlyUsage: number
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
function invalidatesLines(current: PurchaseMethod | null, next: PurchaseMethod): boolean {
  // Nothing was chosen yet, so there is nothing selected under the old method
  // that could be stale — but the caller still needs the picker rebuilt.
  if (current === null) return true
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
  committeeCandidates,
  mode = 'create',
  initialValues,
}: PurchaseRequestFormProps) {
  const router = useRouter()
  const [department, setDepartment] = useState(initialDepartment)
  const headName = initialHeadName
  const isEditMode = mode === 'edit' && Boolean(initialValues?.requestId)
  const [requestedDate, setRequestedDate] = useState(() => initialValues?.requestedDate ?? bangkokIsoDate())
  const [note, setNote] = useState(initialValues?.note ?? '')
  // Both start unchosen on a new request: a purchase method is a statement
  // about how public money is being spent, so it has to be picked on purpose.
  // Editing an existing request restores what it already says.
  const [purpose, setPurpose] = useState<PurchasePurpose | null>(initialValues?.purpose ?? null)
  const [method, setMethod] = useState<PurchaseMethod | null>(() => initialValues?.method ?? null)
  const [lines, setLines] = useState<DraftLine[]>(() =>
    initialValues?.items.map((item) => {
      const contractLine = item.contractItemId
        ? contractLines.find((option) => option.contractItemId === item.contractItemId)
        : undefined

      return {
        key: item.contractItemId ?? item.inventoryItemId,
        inventoryItemId: item.inventoryItemId,
        contractItemId: item.contractItemId,
        lsCode: item.lsCode,
        name: item.name,
        unit: item.unit,
        unitPrice: item.unitPrice,
        requestedQuantity: item.requestedQuantity,
        contractRemaining: item.contractRemaining,
        contractedQuantity: contractLine?.contractedQuantity ?? null,
        averageMonthlyUsage: item.monthlyUsageSnapshot,
      }
    }) ?? [],
  )
  const [uploadSessionId, setUploadSessionId] = useState(() => crypto.randomUUID())
  const [checklistFiles, setChecklistFiles] = useState<ChecklistFileSelections>({})
  const [uploadedChecklistFiles, setUploadedChecklistFiles] = useState<UploadedChecklistFiles>({})
  const [committeeAssignments, setCommitteeAssignments] = useState<CommitteeAssignmentInput[]>(() =>
    initialValues?.checklist?.committees.map((member) => ({
      kind: member.kind,
      seat: member.seat,
      profileId: member.profileId,
    })) ?? [],
  )
  const [overallProgress, setOverallProgress] = useState<number | null>(null)
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
  const optionsFor = (candidate: PurchaseMethod | null): PickerOption[] => {
    if (candidate === null) return []

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
    averageMonthlyUsage: option.averageMonthlyUsage,
  })

  const addLine = (option: PickerOption) => {
    setLines((current) => [...current, draftLineFor(option)])
  }

  const addManualLine = (item: ManualItemInput): string | null => {
    const normalizedLsCode = normalizeLsCode(item.lsCode)
    if (lines.some((line) => normalizeLsCode(line.lsCode) === normalizedLsCode)) {
      return 'รหัสน้ำยานี้ถูกเพิ่มในใบ PR แล้ว กรุณาเลือกรายการเดิมหรือใช้รหัสอื่น'
    }

    setLines((current) => [
      ...current,
      {
        key: `new-${crypto.randomUUID()}`,
        inventoryItemId: null,
        contractItemId: null,
        lsCode: item.lsCode,
        name: item.name,
        unit: item.unit,
        unitPrice: 0,
        requestedQuantity: 1,
        contractRemaining: null,
        contractedQuantity: null,
        averageMonthlyUsage: 0,
      },
    ])
    setError(null)
    return null
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

    setChecklistFiles({})
    setUploadedChecklistFiles({})
    setCommitteeAssignments([])
    setUploadSessionId(crypto.randomUUID())
    setOverallProgress(null)

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
    // Deliberately does not pre-pick a method: the two purposes offer different
    // methods, and auto-selecting one of them is the behaviour being removed.
    setMethod(null)
    setClearAnnouncement(lines.length > 0 ? `ล้างรายการที่เลือกไว้ ${lines.length} รายการ เพราะเปลี่ยนจุดประสงค์` : null)
    setLines([])
    setChecklistFiles({})
    setUploadedChecklistFiles({})
    setCommitteeAssignments([])
    setUploadSessionId(crypto.randomUUID())
    setOverallProgress(null)
  }

  const changeDepartment = (nextDepartment: string) => {
    setDepartment(nextDepartment)
    const nextContracts = contracts.filter((contract) => contract.department === nextDepartment)
    const nextAwaitingContracts = awaitingContracts.filter((contract) => contract.department === nextDepartment)

    // The selected contract may no longer belong to the newly chosen
    // department; fall back to whatever that department actually offers
    // (which may be nothing — PurchaseMethodFields shows that as an
    // empty state rather than leaving a stale, invisible selection).
    if (method?.kind === 'contract' && !nextContracts.some((contract) => contract.id === method.contractId)) {
      changeMethod(emptyMethod('contract', nextContracts, nextAwaitingContracts), 'เปลี่ยนหน่วยงานผู้ขอ')
    } else if (
      method?.kind === 'awaiting_contract' &&
      !nextAwaitingContracts.some((contract) => contract.id === method.contractId)
    ) {
      changeMethod(emptyMethod('awaiting_contract', nextContracts, nextAwaitingContracts), 'เปลี่ยนหน่วยงานผู้ขอ')
    }
  }

  // A lease originates a contract with zero line items — it never picks from
  // the reagent catalogue or draws down a contract balance.
  const isLease = method?.kind === 'equipment_lease'

  const methodSelectionMissing =
    method === null ||
    (method.kind === 'contract' && (departmentContracts.length === 0 || method.contractId === 0)) ||
    (method.kind === 'awaiting_contract' && departmentAwaitingContracts.length === 0)

  const hasOverLimitLine = lines.some(isOverContractLimit)

  const total = lines.reduce(
    (sum, line) => sum + calculateLineTotal(line.requestedQuantity, line.unitPrice),
    0,
  )

  const legacyChecklistExempt = Boolean(isEditMode && initialValues?.checklistPolicyVersion === null)
  const checklistTotal = method?.kind === 'equipment_lease' ? null : total
  const checklistPolicy = method ? derivePurchaseRequestChecklist(method.kind, checklistTotal) : null
  const existingChecklistAttachments = initialValues?.checklist?.attachments ?? []
  const existingChecklistBySlot = new Map(
    existingChecklistAttachments
      .filter((attachment) => !attachment.deletedAt)
      .map((attachment) => [purchaseRequestAttachmentSlotKey(attachment.kind, attachment.slot), attachment]),
  )
  const applicableAssignments = checklistPolicy?.committees.flatMap((requirement) =>
    Array.from({ length: requirement.seats }, (_, index) =>
      committeeAssignments.find(
        (assignment) => assignment.kind === requirement.kind && assignment.seat === index + 1,
      ),
    ).filter((assignment): assignment is CommitteeAssignmentInput => Boolean(assignment)),
  ) ?? []
  const selectedContractRosterReady = method?.kind !== 'contract'
    ? true
    : contracts.find((contract) => contract.id === method.contractId)?.committeeRosterReady === true
  const checklistComplete = legacyChecklistExempt || Boolean(
    checklistPolicy &&
    selectedContractRosterReady &&
    checklistPolicy.attachments.every((requirement) => {
      const key = purchaseRequestAttachmentSlotKey(requirement.kind, requirement.slot)
      const file = checklistFiles[key]
      if (!file) return existingChecklistBySlot.has(key)
      return validatePurchaseRequestAttachment({
        kind: requirement.kind,
        mimeType: purchaseRequestFileMime(file),
        sizeBytes: file.size,
      }).length === 0
    }) &&
    validateCommitteeAssignments(checklistPolicy, applicableAssignments).length === 0
  )

  const changeChecklistFile = (slotKey: string, file: File | undefined) => {
    setChecklistFiles((current) => ({ ...current, [slotKey]: file }))
    setUploadedChecklistFiles((current) => {
      const next = { ...current }
      delete next[slotKey]
      return next
    })
    setOverallProgress(null)
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)

    if (method === null) {
      setError('กรุณาเลือกจุดประสงค์และวิธีจัดซื้อก่อนส่งใบ PR')
      return
    }

    if (!checklistComplete) {
      setError('กรุณาแนบเอกสารและเลือกรายชื่อกรรมการใน checklist ให้ครบก่อนส่งใบ PR')
      document.getElementById('pr-checklist-title')?.focus()
      return
    }

    startTransition(async () => {
      try {
        const input = {
          department,
          headName,
          requestedDate,
          note: note.trim() || null,
          method,
          items: lines
            .filter((line) => line.requestedQuantity > 0)
            .map((line) => ({
              inventoryItemId: line.inventoryItemId,
              lsCode: line.lsCode,
              name: line.name,
              contractItemId: line.contractItemId,
              requestedQuantity: line.requestedQuantity,
              unit: line.unit,
              unitPrice: line.unitPrice,
            })),
        }
        if (legacyChecklistExempt && isEditMode && initialValues) {
          const saved = await updatePurchaseRequest(initialValues.requestId, input)
          router.push(`/purchase-requests/${saved.id}`)
          router.refresh()
          return
        }

        if (!checklistPolicy) throw new Error('ไม่พบกฎ checklist ของวิธีจัดซื้อ')
        setOverallProgress(0)
        const uploaded = await uploadChecklistFiles({
          uploadSessionId,
          method: method.kind,
          total: checklistTotal,
          policy: checklistPolicy,
          files: checklistFiles,
          uploaded: uploadedChecklistFiles,
          onUploaded: (slotKey: string, uploadedFile: UploadedChecklistFile) => {
            setUploadedChecklistFiles((current) => ({ ...current, [slotKey]: uploadedFile }))
          },
          onOverallProgress: setOverallProgress,
        })
        const attachments = checklistPolicy.attachments.map((requirement) => {
          const key = purchaseRequestAttachmentSlotKey(requirement.kind, requirement.slot)
          const file = checklistFiles[key]
          const existing = existingChecklistBySlot.get(key)
          if (file) {
            const uploadedFile = uploaded[key]
            if (!uploadedFile || uploadedFile.fingerprint !== checklistFileFingerprint(file)) {
              throw new Error(`อัปโหลด ${requirement.label} ยังไม่สำเร็จ`)
            }
            return { kind: requirement.kind, slot: requirement.slot, uploadId: uploadedFile.uploadId }
          }
          if (existing) return { kind: requirement.kind, slot: requirement.slot, attachmentId: existing.id }
          throw new Error(`ยังไม่ได้แนบ ${requirement.label}`)
        })
        const checklist = {
          uploadSessionId,
          attachments,
          committees: checklistPolicy.committeeSource === 'contract' ? [] : applicableAssignments,
        }
        const saved = isEditMode && initialValues
          ? await updatePurchaseRequest(initialValues.requestId, input, checklist)
          : await createPurchaseRequest(input, checklist)
        router.push(`/purchase-requests/${saved.id}`)
        router.refresh()
      } catch (caught) {
        setOverallProgress(null)
        setError(caught instanceof Error ? caught.message : `${isEditMode ? 'แก้ไข' : 'สร้าง'}ใบ PR ไม่สำเร็จ กรุณาลองใหม่`)
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
            ชื่อผู้ขอ
            <input type="text" required readOnly value={headName} title="ชื่อผู้สร้างใบขอซื้อ แก้ไขไม่ได้" />
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

      {method !== null && method.kind !== 'contract' && !isLease && (
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
            onAddManual={addManualLine}
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
            {method?.kind === 'contract'
              ? 'กรุณาเลือกสัญญาก่อน ระบบจะเติมรายการในสัญญาให้อัตโนมัติ'
              : 'ยังไม่ได้เลือกรายการ กรุณาเลือกจากรายการด้านบน'}
          </p>
        ) : (
          <div className="detail-items-table">
            <table className="data-table">
              <thead>
                <tr>
                  <th>รหัสน้ำยา (LS)</th>
                  <th>ชื่อน้ำยา</th>
                  <th className="pr-line-cell--center">คงเหลือในสัญญา</th>
                  <th className="pr-line-cell--center">อัตราใช้/เดือน</th>
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
                    <td className={line.inventoryItemId === null ? 'pr-line-cell--manual' : 'identifier'}>
                      {line.inventoryItemId === null ? (
                        <input
                          type="text"
                          required
                          aria-label={`รหัสน้ำยา (LS) ของรายการที่ ${line.key}`}
                          value={line.lsCode}
                          onChange={(event) => updateLine(line.key, { lsCode: event.target.value })}
                        />
                      ) : line.lsCode}
                    </td>
                    <td className={`pr-line-cell--name${line.inventoryItemId === null ? ' pr-line-cell--manual' : ''}`}>
                      {line.inventoryItemId === null ? (
                        <input
                          type="text"
                          required
                          aria-label={`ชื่อน้ำยาของรายการที่ ${line.key}`}
                          value={line.name}
                          onChange={(event) => updateLine(line.key, { name: event.target.value })}
                        />
                      ) : line.name}
                    </td>
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
                    <td className="pr-line-cell--center identifier">
                      <input
                        type="text"
                        readOnly
                        tabIndex={-1}
                        aria-label={`อัตราใช้/เดือนของ ${line.name}`}
                        title="คำนวณจากประวัติการเบิกจริง แก้ไขไม่ได้"
                        value={formatQuantity(line.averageMonthlyUsage, line.unit)}
                      />
                    </td>
                    <td className="pr-line-cell--center">
                      <input
                        type="number"
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
                    <td className="pr-line-cell--center">
                      {line.inventoryItemId === null ? (
                        <input
                          type="text"
                          required
                          aria-label={`หน่วยนับของรายการที่ ${line.key}`}
                          value={line.unit}
                          onChange={(event) => updateLine(line.key, { unit: event.target.value })}
                        />
                      ) : line.unit}
                    </td>
                    <td className="pr-line-cell--center">
                      <input
                        type="number"
                        min={method?.kind === 'specific_contract' || method?.kind === 'e_bidding' ? '0.01' : '0'}
                        step="0.01"
                        required
                        readOnly={line.contractItemId !== null}
                        tabIndex={line.contractItemId !== null ? -1 : undefined}
                        aria-label={`ราคาต่อหน่วยของ ${line.name}`}
                        title={line.contractItemId !== null ? 'ราคากำหนดตามสัญญา แก้ไขไม่ได้' : undefined}
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

      {method !== null && !legacyChecklistExempt && (
        <PurchaseRequestChecklistFields
          method={method.kind}
          total={checklistTotal}
          candidates={committeeCandidates}
          files={checklistFiles}
          existingAttachments={existingChecklistAttachments}
          assignments={applicableAssignments}
          contractRosterReady={selectedContractRosterReady}
          checklistComplete={checklistComplete}
          overallProgress={overallProgress}
          disabled={isPending}
          showCommitteeValidationErrors={isEditMode}
          onFileChange={changeChecklistFile}
          onAssignmentsChange={setCommitteeAssignments}
        />
      )}

      {legacyChecklistExempt && (
        <section className="bench-panel pr-checklist pr-checklist--legacy" aria-label="ข้อยกเว้น checklist">
          <p>ใบ PR นี้สร้างก่อนเริ่มใช้นโยบาย checklist จึงแก้ไขและส่งต่อได้โดยไม่ต้องแนบเอกสารย้อนหลัง</p>
        </section>
      )}

      {error && <p className="form-error" role="alert">{error}</p>}

      <div className="form-action-bar">
        <p>
          {isEditMode
            ? 'แก้ไขได้เฉพาะใบ PR ที่ยังรอเจ้าหน้าที่คลังยืนยัน'
            : purpose === 'new_contract'
            ? null
            : 'ยอดในสัญญาจะถูกตัดเมื่อเจ้าหน้าที่คลังยืนยันเท่านั้น'}
          {!isLease && lines.length > 0 && ` · ${formatQuantity(lines.length)} รายการ · รวม ${formatBaht(total)}`}
          {method === null && ' · เลือกจุดประสงค์และวิธีจัดซื้อก่อนจึงจะส่งได้'}
          {method !== null && methodSelectionMissing && ' · ยังส่งไม่ได้จนกว่าจะมีสัญญาให้เลือกตามเงื่อนไขด้านบน'}
          {hasOverLimitLine && ' · มีรายการที่ขอเกินยอดคงเหลือในสัญญา กรุณาแก้ไขก่อนส่ง'}
        </p>
        <div className="form-action-bar__buttons">
          <Button
            variant="secondary"
            onClick={() => router.push(isEditMode && initialValues ? `/purchase-requests/${initialValues.requestId}` : '/purchase-requests')}
            disabled={isPending}
          >
            ยกเลิก
          </Button>
          <Button type="submit" disabled={isPending || (!isLease && lines.length === 0) || methodSelectionMissing || hasOverLimitLine || !checklistComplete}>
            {isPending ? (isEditMode ? 'กำลังบันทึก…' : 'กำลังส่ง…') : isEditMode ? 'บันทึกการแก้ไข' : 'ส่งใบ PR'}
          </Button>
        </div>
      </div>
    </form>
  )
}
