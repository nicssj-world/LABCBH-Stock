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
import { StickyScroll } from '@/components/ui/StickyScroll'
import { bangkokIsoDate } from '@/lib/date/thai'
import { fiscalYearOfIsoDate } from '@/lib/annual-plans/fiscal'
import { generateAnnualPlanEvidence } from '@/lib/annual-plans/actions'
import {
  annualPlanReferenceFingerprint,
  matchAnnualPlanContractName,
  matchAnnualPlanLine,
  type AnnualPlanForPurchaseRequest,
  type AnnualPlanReference,
  type AnnualPlanReferenceLine,
} from '@/lib/annual-plans/pr-reference'
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
  annualPlanTypeForPurchaseMethod,
  methodRequiresAnnualPlanReference,
  purchaseRequestAttachmentSlotKey,
  validateCommitteeAssignments,
  validatePurchaseRequestAttachment,
  type CommitteeAssignmentInput,
} from '@/lib/pr/checklist'
import type { PurchaseRequestCommitteeCandidate } from '@/lib/pr/form-options'
import type { PurchaseRequestChecklistRecord } from '@/lib/pr/types'
import { AnnualPlanReferenceFields } from '@/components/pr/AnnualPlanReferenceFields'

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
  annualPlanReferenceRequired: boolean
  annualPlanReference?: AnnualPlanReference
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
  annualPlan: AnnualPlanForPurchaseRequest
  hiringPlan: AnnualPlanForPurchaseRequest
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
  unitPrice: number | ''
  requestedQuantity: number | ''
  /** Null when the purchase does not draw down a contract. */
  contractRemaining: number | null
  contractedQuantity: number | null
  /** Reference only — the confirmed snapshot is computed server-side at submission. */
  averageMonthlyUsage: number
}

type DraftNumber = number | ''

function draftNumberValue(value: DraftNumber): number {
  return value === '' ? 0 : value
}

function isFiniteDraftNumber(value: DraftNumber): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** Requesting more than the contract has left — the RPC would refuse it too, but the requester should see this before submitting, not after. */
function isOverContractLimit(line: DraftLine): boolean {
  return (
    line.contractRemaining !== null &&
    isFiniteDraftNumber(line.requestedQuantity) &&
    line.requestedQuantity > line.contractRemaining
  )
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

function safeFiscalYearOfIsoDate(value: string) {
  try {
    return fiscalYearOfIsoDate(value)
  } catch {
    return null
  }
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
  if (current.kind === 'equipment_lease' && next.kind === 'equipment_lease') {
    return current.contractDraft.displayName !== next.contractDraft.displayName
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
  annualPlan,
  hiringPlan,
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
  const isContractOriginationMethod = method !== null && (
    method.kind === 'specific_contract' ||
    method.kind === 'e_bidding' ||
    method.kind === 'equipment_lease'
  )
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
  const [annualPlanSelections, setAnnualPlanSelections] = useState<Record<string, AnnualPlanReferenceLine | undefined>>(() =>
    Object.fromEntries(
      (initialValues?.annualPlanReference?.lines ?? []).flatMap((reference, index) => {
        const item = initialValues?.items[index]
        const key = item?.contractItemId ?? item?.inventoryItemId
        return key ? [[key, reference] as const] : []
      }),
    ),
  )
  const [annualPlanContractSelection, setAnnualPlanContractSelection] = useState<AnnualPlanReferenceLine | undefined>(
    initialValues?.annualPlanReference?.contract?.line,
  )
  const [annualPlanEvidence, setAnnualPlanEvidence] = useState<{
    uploadId: string
    fileName: string
    fingerprint: string
    planVersionId: string
  } | null>(null)
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

  const annualPlanType = method ? annualPlanTypeForPurchaseMethod(method.kind) : null
  const activeAnnualPlan = annualPlanType === 'hiring' ? hiringPlan : annualPlan
  const annualPlanReadyForMatching = Boolean(method && methodRequiresAnnualPlanReference(method.kind))
    && activeAnnualPlan.status === 'ready'
    && Boolean(activeAnnualPlan.planVersionId)
    && activeAnnualPlan.rows.length > 0

  const resolvedAnnualPlanContractSelection = useMemo<AnnualPlanReferenceLine | undefined>(() => {
    if (!annualPlanReadyForMatching || activeAnnualPlan.planType !== 'hiring' || method?.kind !== 'equipment_lease') {
      return undefined
    }
    const retained = annualPlanContractSelection
    if (retained && activeAnnualPlan.rows.some((row) => row.id === retained.planRowId)) return retained
    const automatic = matchAnnualPlanContractName(method.contractDraft.displayName, activeAnnualPlan.rows)
    return automatic.selected && automatic.matchMethod
      ? {
          lineNumber: automatic.selected.lineNumber,
          planRowId: automatic.selected.id,
          matchMethod: automatic.matchMethod,
        }
      : undefined
  }, [activeAnnualPlan.planType, activeAnnualPlan.rows, annualPlanContractSelection, annualPlanReadyForMatching, method])

  // A unique exact match is selected for the requester automatically. Keep
  // only manual choices in state; deriving automatic matches avoids a render
  // cycle and means an edited name/code immediately gets re-matched.
  const resolvedAnnualPlanSelections = useMemo(() => {
    if (!annualPlanReadyForMatching || activeAnnualPlan.planType !== 'procurement') return {}

    const next: Record<string, AnnualPlanReferenceLine | undefined> = {}
    for (const line of lines) {
      const retained = annualPlanSelections[line.key]
      if (retained && activeAnnualPlan.rows.some((row) => row.id === retained.planRowId)) {
        next[line.key] = retained
        continue
      }
      const automatic = matchAnnualPlanLine(line.name, line.lsCode, activeAnnualPlan.rows)
      if (automatic.selected && automatic.matchMethod) {
        next[line.key] = {
          lineNumber: automatic.selected.lineNumber,
          planRowId: automatic.selected.id,
          matchMethod: automatic.matchMethod,
        }
      }
    }
    return next
  }, [activeAnnualPlan.planType, activeAnnualPlan.rows, annualPlanReadyForMatching, annualPlanSelections, lines])

  const annualPlanReference = useMemo<AnnualPlanReference | null>(() => {
    if (!annualPlanReadyForMatching || !activeAnnualPlan.planVersionId) return null
    if (activeAnnualPlan.planType === 'hiring') {
      if (method?.kind !== 'equipment_lease' || !resolvedAnnualPlanContractSelection) return null
      return {
        planVersionId: activeAnnualPlan.planVersionId,
        planFiscalYear: activeAnnualPlan.currentFiscalYear,
        planType: 'hiring',
        lines: [],
        contract: {
          contractName: method.contractDraft.displayName,
          line: resolvedAnnualPlanContractSelection,
        },
      }
    }
    if (lines.length === 0) return null
    const references = lines.map((line) => resolvedAnnualPlanSelections[line.key])
    if (references.some((reference): reference is undefined => !reference)) return null
    return {
      planVersionId: activeAnnualPlan.planVersionId,
      planFiscalYear: activeAnnualPlan.currentFiscalYear,
      planType: 'procurement',
      lines: references as AnnualPlanReferenceLine[],
    }
  }, [activeAnnualPlan.currentFiscalYear, activeAnnualPlan.planType, activeAnnualPlan.planVersionId, annualPlanReadyForMatching, lines, method, resolvedAnnualPlanContractSelection, resolvedAnnualPlanSelections])

  const annualPlanEvidenceFingerprint = annualPlanReferenceFingerprint(
    annualPlanReference?.planVersionId ?? null,
    lines.map((line) => ({ name: line.name, lsCode: line.lsCode, reference: resolvedAnnualPlanSelections[line.key] })),
    method?.kind === 'equipment_lease'
      ? { name: method.contractDraft.displayName, reference: resolvedAnnualPlanContractSelection }
      : undefined,
  )

  const draftLineFor = (option: PickerOption): DraftLine => ({
    key: option.contractItemId ?? option.inventoryItemId,
    inventoryItemId: option.inventoryItemId,
    contractItemId: option.contractItemId,
    lsCode: option.lsCode,
    name: option.name,
    unit: option.unit,
    unitPrice: option.unitPrice,
    // Contract lines are prefilled as choices, not as quantities. A blank
    // value means zero and is omitted from the submitted PR until the user
    // enters a positive amount.
    requestedQuantity: option.contractItemId !== null ? '' : 1,
    contractRemaining: option.contractRemaining,
    contractedQuantity: option.contractedQuantity,
    averageMonthlyUsage: option.averageMonthlyUsage,
  })

  const addLine = (option: PickerOption) => {
    setLines((current) => [...current, draftLineFor(option)])
    setAnnualPlanEvidence(null)
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
    setAnnualPlanEvidence(null)
    setError(null)
    return null
  }

  const updateLine = (key: string, patch: Partial<DraftLine>) => {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)))
    setAnnualPlanSelections((current) => {
      if (!(key in current)) return current
      const next = { ...current }
      delete next[key]
      return next
    })
    setAnnualPlanEvidence(null)
  }

  const removeLine = (key: string) => {
    setLines((current) => current.filter((line) => line.key !== key))
    setAnnualPlanSelections((current) => {
      if (!(key in current)) return current
      const next = { ...current }
      delete next[key]
      return next
    })
    setAnnualPlanEvidence(null)
  }

  const changeMethod = (next: PurchaseMethod, reason = 'เปลี่ยนวิธีจัดซื้อ') => {
    const shouldClear = invalidatesLines(method, next)
    setMethod(next)
    if (!shouldClear) return

    setChecklistFiles({})
    setUploadedChecklistFiles({})
    setAnnualPlanSelections({})
    setAnnualPlanContractSelection(undefined)
    setAnnualPlanEvidence(null)
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
    setAnnualPlanSelections({})
    setAnnualPlanContractSelection(undefined)
    setAnnualPlanEvidence(null)
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
  const isContractPurchase = method?.kind === 'contract'

  const methodSelectionMissing =
    method === null ||
    (method.kind === 'contract' && (departmentContracts.length === 0 || method.contractId === 0)) ||
    (method.kind === 'awaiting_contract' && departmentAwaitingContracts.length === 0) ||
    (isContractOriginationMethod && method.contractDraft.contractDurationYears == null)

  const hasOverLimitLine = lines.some(isOverContractLimit)
  const hasInvalidLine = lines.some((line) => {
    const quantityIsBlankOrZero = line.requestedQuantity === '' || (
      isFiniteDraftNumber(line.requestedQuantity) && line.requestedQuantity === 0
    )
    const invalidQuantity = isContractPurchase
      ? (!quantityIsBlankOrZero && (
          !isFiniteDraftNumber(line.requestedQuantity) || line.requestedQuantity < 0
        ))
      : (!isFiniteDraftNumber(line.requestedQuantity) || line.requestedQuantity <= 0)

    return invalidQuantity || !isFiniteDraftNumber(line.unitPrice) || line.unitPrice < 0
  })
  const hasPositiveRequestedQuantity = lines.some(
    (line) => isFiniteDraftNumber(line.requestedQuantity) && line.requestedQuantity > 0,
  )

  const total = lines.reduce(
    (sum, line) => sum + calculateLineTotal(draftNumberValue(line.requestedQuantity), draftNumberValue(line.unitPrice)),
    0,
  )

  // PRs created before annual-plan references were introduced may have a
  // checklist but no saved plan reference. Keep their original edit lifecycle;
  // only newly created plan-backed PRs are required to rematch against the
  // current plan version.
  const legacyAnnualPlan = Boolean(
    isEditMode &&
    method &&
    methodRequiresAnnualPlanReference(method.kind) &&
    initialValues?.method.kind === method.kind &&
    initialValues.annualPlanReferenceRequired === false,
  )
  const legacyChecklistExempt = Boolean(
    isEditMode &&
    (initialValues?.checklistPolicyVersion === null || legacyAnnualPlan),
  )
  const checklistTotal = method?.kind === 'equipment_lease' ? null : total
  const checklistPolicy = method ? derivePurchaseRequestChecklist(method.kind, checklistTotal) : null
  const existingChecklistAttachments = initialValues?.checklist?.attachments ?? []
  const existingChecklistBySlot = new Map(
    existingChecklistAttachments
      .filter((attachment) => !attachment.deletedAt)
      .map((attachment) => [purchaseRequestAttachmentSlotKey(attachment.kind, attachment.slot), attachment]),
  )
  const selectedContract = method?.kind === 'contract'
    ? contracts.find((contract) => contract.id === method.contractId) ?? null
    : null
  const selectedContractFileAvailable = Boolean(selectedContract?.fileUrl)
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
  const requestedFiscalYear = safeFiscalYearOfIsoDate(requestedDate)
  const annualPlanDateValid = !method || !methodRequiresAnnualPlanReference(method.kind)
    || requestedFiscalYear === activeAnnualPlan.currentFiscalYear
  const annualPlanDateError = method && methodRequiresAnnualPlanReference(method.kind) && !annualPlanDateValid
    ? `วันที่ขอซื้อของ PR ที่อ้างอิงแผน${activeAnnualPlan.planType === 'hiring' ? 'จัดจ้าง' : 'จัดซื้อ'}ต้องอยู่ในปีงบประมาณปัจจุบัน (${activeAnnualPlan.currentFiscalYear}) ระบบจะไม่เปลี่ยนไปใช้แผนย้อนหลัง`
    : null
  const annualPlanReferenceReady = !method || !methodRequiresAnnualPlanReference(method.kind)
    || Boolean(annualPlanReference)
  const checklistComplete = legacyChecklistExempt || Boolean(
    checklistPolicy &&
    annualPlanDateValid &&
    annualPlanReferenceReady &&
    selectedContractRosterReady &&
    checklistPolicy.attachments.every((requirement) => {
      const key = purchaseRequestAttachmentSlotKey(requirement.kind, requirement.slot)
      const file = checklistFiles[key]
      if (requirement.kind === 'plan_page' && method && methodRequiresAnnualPlanReference(method.kind)) {
        return Boolean(annualPlanReference)
      }
      if (requirement.kind === 'contract_page' && method?.kind === 'contract' && !file) {
        return selectedContractFileAvailable || existingChecklistBySlot.has(key)
      }
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
    if (slotKey === purchaseRequestAttachmentSlotKey('plan_page', 1)) setAnnualPlanEvidence(null)
    setOverallProgress(null)
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)

    if (method === null) {
      setError('กรุณาเลือกจุดประสงค์และวิธีจัดซื้อก่อนส่งใบ PR')
      return
    }

    if (!isLease && !hasPositiveRequestedQuantity) {
      setError('กรุณาระบุจำนวนที่ต้องการซื้ออย่างน้อย 1 รายการ')
      return
    }

    if (isContractOriginationMethod && method.contractDraft.contractDurationYears == null) {
      setError('กรุณาเลือกจำนวนปีที่ทำสัญญาก่อนส่งใบ PR')
      document.querySelector<HTMLSelectElement>('[name="contractDurationYears"]')?.focus()
      return
    }

    if (!legacyChecklistExempt && methodRequiresAnnualPlanReference(method.kind)) {
      if (!annualPlanDateValid) {
        setError(annualPlanDateError ?? 'วันที่ขอซื้อไม่อยู่ในปีงบประมาณปัจจุบัน')
        return
      }
      if (!annualPlanReference) {
        setError(`กรุณาจับคู่${activeAnnualPlan.planType === 'hiring' ? 'ชื่อสัญญา' : 'รายการทั้งหมด'}กับแผน${activeAnnualPlan.planType === 'hiring' ? 'จัดจ้าง' : 'จัดซื้อ'}ปีงบประมาณ ${activeAnnualPlan.currentFiscalYear} ก่อนส่งใบ PR`)
        document.getElementById('annual-plan-reference-title')?.focus()
        return
      }
    }

    if (!checklistComplete) {
      setError('กรุณาแนบเอกสารและเลือกรายชื่อกรรมการใน checklist ให้ครบก่อนส่งใบ PR')
      document.getElementById('pr-checklist-title')?.focus()
      return
    }

    startTransition(async () => {
      try {
        const selectedPlanRows = annualPlanReference?.lines
          .map((reference) => activeAnnualPlan.rows.find((row) => row.id === reference.planRowId))
          .filter((row): row is NonNullable<typeof row> => Boolean(row)) ?? []
        const submittedMethod: PurchaseMethod = method.kind === 'annual_plan' && !legacyChecklistExempt
          ? {
              ...method,
              fiscalYear: activeAnnualPlan.currentFiscalYear,
              planSequence: selectedPlanRows.map((row) => row.planSequence).join(', '),
            }
          : method
        const input = {
          department,
          headName,
          requestedDate,
          note: note.trim() || null,
          method: submittedMethod,
          items: lines
            .filter((line) => isFiniteDraftNumber(line.requestedQuantity) && line.requestedQuantity > 0)
            .map((line) => ({
              inventoryItemId: line.inventoryItemId,
              lsCode: line.lsCode,
              name: line.name,
              contractItemId: line.contractItemId,
              requestedQuantity: draftNumberValue(line.requestedQuantity),
              unit: line.unit,
              unitPrice: draftNumberValue(line.unitPrice),
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
        let uploadsForSubmit = uploadedChecklistFiles
        if (!legacyChecklistExempt && methodRequiresAnnualPlanReference(method.kind)) {
          if (!annualPlanReference || !activeAnnualPlan.planVersionId) {
            throw new Error(`ไม่มีแผน${activeAnnualPlan.planType === 'hiring' ? 'จัดจ้าง' : 'จัดซื้อ'}ปีงบประมาณ ${activeAnnualPlan.currentFiscalYear} ที่พร้อมใช้งาน`)
          }
          const cachedEvidence = annualPlanEvidence?.fingerprint === annualPlanEvidenceFingerprint
            && annualPlanEvidence.planVersionId === activeAnnualPlan.planVersionId
          if (!cachedEvidence) {
            const generated = await generateAnnualPlanEvidence({
              uploadSessionId,
              requestedDate,
              method: method.kind,
              contractName: method.kind === 'equipment_lease' ? method.contractDraft.displayName : undefined,
              reference: annualPlanReference,
              items: input.items.map((item) => ({ name: item.name, lsCode: item.lsCode })),
            })
            const generatedUpload: UploadedChecklistFile = {
              source: 'r2',
              uploadId: generated.uploadId,
              fingerprint: annualPlanEvidenceFingerprint,
            }
            setAnnualPlanEvidence({
              uploadId: generated.uploadId,
              fileName: generated.fileName,
              fingerprint: annualPlanEvidenceFingerprint,
              planVersionId: generated.planVersionId,
            })
            setUploadedChecklistFiles((current) => ({
              ...current,
              [purchaseRequestAttachmentSlotKey('plan_page', 1)]: generatedUpload,
            }))
            uploadsForSubmit = {
              ...uploadsForSubmit,
              [purchaseRequestAttachmentSlotKey('plan_page', 1)]: generatedUpload,
            }
          }
        }
        const uploaded = await uploadChecklistFiles({
          uploadSessionId,
          method: method.kind,
          contractFileAvailable: selectedContractFileAvailable,
          total: checklistTotal,
          policy: checklistPolicy,
          files: checklistFiles,
          uploaded: uploadsForSubmit,
          onUploaded: (slotKey: string, uploadedFile: UploadedChecklistFile) => {
            setUploadedChecklistFiles((current) => ({ ...current, [slotKey]: uploadedFile }))
          },
          onOverallProgress: setOverallProgress,
        })
        const attachments = checklistPolicy.attachments.map((requirement) => {
          const key = purchaseRequestAttachmentSlotKey(requirement.kind, requirement.slot)
          const file = checklistFiles[key]
          const existing = existingChecklistBySlot.get(key)
          if (requirement.kind === 'plan_page' && methodRequiresAnnualPlanReference(method.kind)) {
            const generated = uploaded[key]
            if (!generated || generated.source !== 'r2' || !generated.uploadId) {
              throw new Error('ยังสร้างไฟล์แผนที่ไฮไลท์รายการไม่สำเร็จ กรุณาลองใหม่')
            }
            return { kind: requirement.kind, slot: requirement.slot, uploadId: generated.uploadId }
          }
          if (requirement.kind === 'contract_page' && method.kind === 'contract') {
            if (selectedContractFileAvailable) {
              return { kind: requirement.kind, slot: requirement.slot, contractFile: true as const }
            }
          }
          if (file) {
            const uploadedFile = uploaded[key]
            if (
              !uploadedFile ||
              uploadedFile.source !== 'r2' ||
              !uploadedFile.uploadId ||
              uploadedFile.fingerprint !== checklistFileFingerprint(file)
            ) {
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
          ? await updatePurchaseRequest(initialValues.requestId, input, checklist, annualPlanReference)
          : await createPurchaseRequest(input, checklist, annualPlanReference)
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
            <span>หน่วยงานผู้ขอ <span className="field-required" aria-hidden="true">*</span></span>
            <select required value={department} onChange={(event) => changeDepartment(event.target.value)}>
              {departments.map((department) => (
                <option value={department} key={department}>{department}</option>
              ))}
            </select>
          </label>
          <label className="field-row">
            <span>ชื่อผู้ขอ <span className="field-required" aria-hidden="true">*</span></span>
            <input type="text" required readOnly value={headName} title="ชื่อผู้สร้างใบขอซื้อ แก้ไขไม่ได้" />
          </label>
          <label className="field-row">
            <span>วันที่ขอซื้อ <span className="field-required" aria-hidden="true">*</span></span>
            <ThaiDateInput
              required
              value={requestedDate}
              onChange={(value) => {
                setRequestedDate(value)
                setAnnualPlanEvidence(null)
              }}
            />
            {annualPlanDateError && <small className="field-error">{annualPlanDateError}</small>}
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
          annualPlanFiscalYear={activeAnnualPlan.currentFiscalYear}
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
          <>
            <StickyScroll className="detail-items-table pr-form-lines-table--desktop" ariaLabel="รายการในใบขอซื้อ เลื่อนในแนวนอนเพื่อดูคอลัมน์เพิ่มเติม">
            <table className="data-table">
              <thead>
                <tr>
                  <th><span>รหัสน้ำยา (LS) <span className="field-required" aria-hidden="true">*</span></span></th>
                  <th><span>ชื่อน้ำยา <span className="field-required" aria-hidden="true">*</span></span></th>
                  <th className="pr-line-cell--center">คงเหลือในสัญญา</th>
                  <th className="pr-line-cell--center">อัตราใช้/เดือน</th>
                  <th className="pr-line-cell--center"><span>จำนวนที่ขอ <span className="field-required" aria-hidden="true">*</span></span></th>
                  <th className="pr-line-cell--center"><span>หน่วย <span className="field-required" aria-hidden="true">*</span></span></th>
                  <th className="pr-line-cell--center"><span>ราคาต่อหน่วย <span className="field-required" aria-hidden="true">*</span></span></th>
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
                        required={!isContractPurchase}
                        aria-invalid={overLimit}
                        aria-label={`จำนวนที่ขอของ ${line.name}`}
                        value={line.requestedQuantity}
                        onChange={(event) => {
                          const value = event.target.value
                          updateLine(line.key, { requestedQuantity: value === '' ? '' : Number(value) })
                        }}
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
                        onChange={(event) => {
                          const value = event.target.value
                          updateLine(line.key, { unitPrice: value === '' ? '' : Number(value) })
                        }}
                      />
                    </td>
                    <td className="pr-line-cell--center identifier">
                      <strong>{formatBaht(calculateLineTotal(draftNumberValue(line.requestedQuantity), draftNumberValue(line.unitPrice)))}</strong>
                    </td>
                    <td>
                      <Button variant="ghost" onClick={() => removeLine(line.key)}>นำออก</Button>
                    </td>
                  </tr>
                  )
                })}
              </tbody>
            </table>
            </StickyScroll>

            <ul className="pr-form-line-cards" aria-label="รายการในใบ PR">
            {lines.map((line) => {
              const overLimit = isOverContractLimit(line)
              const lineTotal = formatBaht(calculateLineTotal(draftNumberValue(line.requestedQuantity), draftNumberValue(line.unitPrice)))
              return (
                <li key={line.key} className="pr-form-line-card">
                  <div className="pr-form-line-card__heading">
                    <div className="pr-form-line-card__identity">
                      {line.inventoryItemId === null ? (
                        <label className="field-row">
                          <span>รหัสน้ำยา (LS) <span className="field-required" aria-hidden="true">*</span></span>
                          <input
                            type="text"
                            required
                            aria-label={`รหัสน้ำยา (LS) ของรายการที่ ${line.key}`}
                            value={line.lsCode}
                            onChange={(event) => updateLine(line.key, { lsCode: event.target.value })}
                          />
                        </label>
                      ) : (
                        <span className="identifier">{line.lsCode}</span>
                      )}
                      {line.inventoryItemId === null ? (
                        <label className="field-row">
                          <span>ชื่อน้ำยา <span className="field-required" aria-hidden="true">*</span></span>
                          <input
                            type="text"
                            required
                            aria-label={`ชื่อน้ำยาของรายการที่ ${line.key}`}
                            value={line.name}
                            onChange={(event) => updateLine(line.key, { name: event.target.value })}
                          />
                        </label>
                      ) : (
                        <strong>{line.name}</strong>
                      )}
                    </div>
                    <Button variant="ghost" onClick={() => removeLine(line.key)}>นำออก</Button>
                  </div>

                  <dl className="pr-form-line-card__facts">
                    <div>
                      <dt>คงเหลือในสัญญา</dt>
                      <dd>
                        {line.contractRemaining === null ? 'ไม่ตัดยอดสัญญา' : formatQuantity(line.contractRemaining, line.unit)}
                        {line.contractRemaining !== null && isLowContractBalance(line) && (
                          <small className="item-picker__warning">{LOW_CONTRACT_BALANCE_WARNING}</small>
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>อัตราใช้/เดือน</dt>
                      <dd className="identifier">{formatQuantity(line.averageMonthlyUsage, line.unit)}</dd>
                    </div>
                    <div>
                      <dt>รวม</dt>
                      <dd className="identifier">{lineTotal}</dd>
                    </div>
                  </dl>

                  <div className="pr-form-line-card__fields">
                    <label className="field-row">
                      <span>จำนวนที่ขอ ({line.unit}) <span className="field-required" aria-hidden="true">*</span></span>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        required={!isContractPurchase}
                        aria-invalid={overLimit}
                        aria-label={`จำนวนที่ขอของ ${line.name}`}
                        value={line.requestedQuantity}
                        onChange={(event) => {
                          const value = event.target.value
                          updateLine(line.key, { requestedQuantity: value === '' ? '' : Number(value) })
                        }}
                      />
                      {overLimit && (
                        <small className="field-error">
                          เกินยอดคงเหลือในสัญญา ({formatQuantity(line.contractRemaining!, line.unit)})
                        </small>
                      )}
                    </label>
                    <div className="field-row">
                      <span>หน่วย <span className="field-required" aria-hidden="true">*</span></span>
                      {line.inventoryItemId === null ? (
                        <input
                          type="text"
                          required
                          aria-label={`หน่วยนับของรายการที่ ${line.key}`}
                          value={line.unit}
                          onChange={(event) => updateLine(line.key, { unit: event.target.value })}
                        />
                      ) : (
                        <strong className="pr-form-line-card__readonly-value">{line.unit}</strong>
                      )}
                    </div>
                    <label className="field-row">
                      <span>ราคาต่อหน่วย <span className="field-required" aria-hidden="true">*</span></span>
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
                        onChange={(event) => {
                          const value = event.target.value
                          updateLine(line.key, { unitPrice: value === '' ? '' : Number(value) })
                        }}
                      />
                    </label>
                  </div>
                </li>
              )
            })}
            </ul>
          </>
        )}

        <p className="items-editor__grand-total">
          <span>ยอดรวม</span>
          <strong>{formatBaht(total)}</strong>
        </p>
      </section>
      )}

      {method && methodRequiresAnnualPlanReference(method.kind) && !legacyChecklistExempt && (
        <AnnualPlanReferenceFields
          plan={activeAnnualPlan}
          lines={lines.map((line) => ({ key: line.key, name: line.name, lsCode: line.lsCode }))}
          selections={resolvedAnnualPlanSelections}
          contractName={method.kind === 'equipment_lease' ? method.contractDraft.displayName : undefined}
          contractSelection={resolvedAnnualPlanContractSelection}
          disabled={isPending}
          onSelect={(lineKey, reference) => {
            setAnnualPlanSelections((current) => ({ ...current, [lineKey]: reference }))
            setAnnualPlanEvidence(null)
          }}
          onContractSelect={(reference) => {
            setAnnualPlanContractSelection(reference)
            setAnnualPlanEvidence(null)
          }}
        />
      )}

      {method !== null && !legacyChecklistExempt && (
        <PurchaseRequestChecklistFields
          method={method.kind}
          contractFileAvailable={selectedContractFileAvailable}
          total={checklistTotal}
          candidates={committeeCandidates}
          files={checklistFiles}
          existingAttachments={existingChecklistAttachments}
          assignments={applicableAssignments}
          contractRosterReady={selectedContractRosterReady}
          checklistComplete={checklistComplete}
          annualPlanReferenceReady={!methodRequiresAnnualPlanReference(method.kind) || Boolean(annualPlanReference)}
          annualPlanFileName={annualPlanEvidence?.fileName ?? `${activeAnnualPlan.planType === 'hiring' ? 'แผนจัดจ้าง' : 'แผนจัดซื้อ'}-ไฮไลท์-${activeAnnualPlan.currentFiscalYear}.pdf`}
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
          <Button type="submit" disabled={isPending || (!isLease && !hasPositiveRequestedQuantity) || methodSelectionMissing || hasInvalidLine || hasOverLimitLine || !checklistComplete}>
            {isPending ? (isEditMode ? 'กำลังบันทึก…' : 'กำลังส่ง…') : isEditMode ? 'บันทึกการแก้ไข' : 'ส่งใบ PR'}
          </Button>
        </div>
      </div>
    </form>
  )
}
