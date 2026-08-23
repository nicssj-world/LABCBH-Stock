import type { PurchaseMethodKind } from './schema'

export const PR_CHECKLIST_POLICY_VERSION = 1
export const PR_MAX_ATTACHMENT_SIZE_BYTES = 20 * 1024 * 1024

export const PR_ATTACHMENT_KINDS = ['tor', 'quotation', 'plan_page', 'contract_page'] as const
export type PurchaseRequestAttachmentKind = (typeof PR_ATTACHMENT_KINDS)[number]

export const PR_COMMITTEE_KINDS = ['specification', 'result', 'inspection'] as const
export type PurchaseRequestCommitteeKind = (typeof PR_COMMITTEE_KINDS)[number]

export interface PurchaseRequestAttachmentRequirement {
  kind: PurchaseRequestAttachmentKind
  slot: number
  label: string
  accept: readonly string[]
}

export interface PurchaseRequestCommitteeRequirement {
  kind: PurchaseRequestCommitteeKind
  seats: number
  label: string
}

export interface PurchaseRequestChecklistPolicy {
  version: typeof PR_CHECKLIST_POLICY_VERSION
  method: PurchaseMethodKind
  attachments: PurchaseRequestAttachmentRequirement[]
  committees: PurchaseRequestCommitteeRequirement[]
  committeeSource: 'request' | 'contract'
}

export interface CommitteeAssignmentInput {
  kind: PurchaseRequestCommitteeKind
  seat: number
  profileId: string
}

const PDF_TYPES = ['application/pdf'] as const
const PDF_OR_IMAGE_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] as const

export const PR_ATTACHMENT_KIND_LABELS: Record<PurchaseRequestAttachmentKind, string> = {
  tor: 'รายละเอียดคุณลักษณะเฉพาะ (TOR)',
  quotation: 'ใบเสนอราคา',
  plan_page: 'แผนที่มีลำดับรายการที่ต้องการซื้อ',
  contract_page: 'หน้าสัญญาที่มีรายการที่ต้องการซื้อ',
}

export const PR_COMMITTEE_KIND_LABELS: Record<PurchaseRequestCommitteeKind, string> = {
  specification: 'คณะกรรมการกำหนดราคากลางและคุณลักษณะเฉพาะ',
  result: 'คณะกรรมการพิจารณาผล',
  inspection: 'คณะกรรมการตรวจรับพัสดุ',
}

function attachment(
  kind: PurchaseRequestAttachmentKind,
  slot: number,
  accept: readonly string[],
): PurchaseRequestAttachmentRequirement {
  return {
    kind,
    slot,
    label: kind === 'quotation' ? `${PR_ATTACHMENT_KIND_LABELS[kind]} บริษัทที่ ${slot}` : PR_ATTACHMENT_KIND_LABELS[kind],
    accept,
  }
}

function attachments(kind: PurchaseRequestAttachmentKind, count: number, accept: readonly string[]) {
  return Array.from({ length: count }, (_, index) => attachment(kind, index + 1, accept))
}

function committees(
  requirements: ReadonlyArray<readonly [PurchaseRequestCommitteeKind, number]>,
): PurchaseRequestCommitteeRequirement[] {
  return requirements.map(([kind, seats]) => ({ kind, seats, label: PR_COMMITTEE_KIND_LABELS[kind] }))
}

/**
 * Central policy used by the form, upload API and server actions. Thresholds
 * are inclusive at 50,000 and 100,000 baht exactly.
 */
export function derivePurchaseRequestChecklist(
  method: PurchaseMethodKind,
  total: number | null,
): PurchaseRequestChecklistPolicy {
  if (method === 'contract') {
    return {
      version: PR_CHECKLIST_POLICY_VERSION,
      method,
      attachments: attachments('contract_page', 1, PDF_OR_IMAGE_TYPES),
      committees: [],
      committeeSource: 'contract',
    }
  }

  if (method === 'specific_contract') {
    return {
      version: PR_CHECKLIST_POLICY_VERSION,
      method,
      attachments: [
        ...attachments('tor', 1, PDF_TYPES),
        ...attachments('quotation', 3, PDF_OR_IMAGE_TYPES),
        ...attachments('plan_page', 1, PDF_OR_IMAGE_TYPES),
      ],
      committees: committees([['specification', 3], ['inspection', 3]]),
      committeeSource: 'request',
    }
  }

  if (method === 'e_bidding' || method === 'equipment_lease') {
    return {
      version: PR_CHECKLIST_POLICY_VERSION,
      method,
      attachments: [
        ...attachments('tor', 1, PDF_TYPES),
        ...attachments('quotation', 3, PDF_OR_IMAGE_TYPES),
        ...attachments('plan_page', 1, PDF_OR_IMAGE_TYPES),
      ],
      committees: committees([['specification', 3], ['result', 3], ['inspection', 3]]),
      committeeSource: 'request',
    }
  }

  const quoteCount = total !== null && total >= 50_000 ? 3 : 1
  const committeeSeats = total !== null && total >= 100_000 ? 3 : 1
  const requiredAttachments = [
    ...attachments('tor', 1, PDF_TYPES),
    ...attachments('quotation', quoteCount, PDF_OR_IMAGE_TYPES),
  ]

  if (method === 'annual_plan') {
    requiredAttachments.push(...attachments('plan_page', 1, PDF_OR_IMAGE_TYPES))
  }

  return {
    version: PR_CHECKLIST_POLICY_VERSION,
    method,
    attachments: requiredAttachments,
    committees: committees([['specification', committeeSeats], ['inspection', committeeSeats]]),
    committeeSource: 'request',
  }
}

export function purchaseRequestAttachmentSlotKey(
  kind: PurchaseRequestAttachmentKind,
  slot: number,
) {
  return `${kind}:${slot}` as const
}

export function validatePurchaseRequestAttachment(input: {
  kind: PurchaseRequestAttachmentKind
  mimeType: string
  sizeBytes: number
}): string[] {
  const errors: string[] = []
  const mime = input.mimeType.trim().toLowerCase()
  const allowed = input.kind === 'tor' ? PDF_TYPES : PDF_OR_IMAGE_TYPES

  if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes <= 0) {
    errors.push('ไฟล์ต้องมีขนาดมากกว่า 0 ไบต์')
  } else if (input.sizeBytes > PR_MAX_ATTACHMENT_SIZE_BYTES) {
    errors.push('ไฟล์แนบแต่ละไฟล์ต้องมีขนาดไม่เกิน 20 MB')
  }

  if (!allowed.includes(mime as never)) {
    errors.push(input.kind === 'tor' ? 'เอกสาร TOR ต้องเป็นไฟล์ PDF เท่านั้น' : 'รองรับเฉพาะ PDF, JPG, PNG หรือ WEBP')
  }

  return errors
}

export function validateCommitteeAssignments(
  policy: PurchaseRequestChecklistPolicy,
  assignments: readonly CommitteeAssignmentInput[],
): string[] {
  if (policy.committeeSource === 'contract') {
    return assignments.length === 0 ? [] : ['กรรมการของการซื้อในสัญญาต้องใช้รายชื่อจากสัญญา']
  }

  const errors: string[] = []
  const requiredKinds = new Set(policy.committees.map((requirement) => requirement.kind))

  for (const requirement of policy.committees) {
    const rows = assignments.filter((assignment) => assignment.kind === requirement.kind)
    const seats = rows.map((row) => row.seat).sort((a, b) => a - b)
    const expectedSeats = Array.from({ length: requirement.seats }, (_, index) => index + 1)

    if (rows.length !== requirement.seats || seats.some((seat, index) => seat !== expectedSeats[index])) {
      errors.push(`${requirement.label} ต้องมี ${requirement.seats} คน`)
    }
    if (rows.some((row) => !row.profileId.trim())) {
      errors.push(`${requirement.label} ต้องเลือกรายชื่อให้ครบ`)
    }
    const selected = rows.map((row) => row.profileId).filter(Boolean)
    if (new Set(selected).size !== selected.length) {
      errors.push(`${requirement.label} ห้ามเลือกบุคคลซ้ำภายในชุดเดียวกัน`)
    }
  }

  if (assignments.some((assignment) => !requiredKinds.has(assignment.kind))) {
    errors.push('พบชุดกรรมการที่ไม่ตรงกับวิธีจัดซื้อ')
  }

  const specification = new Set(
    assignments.filter((row) => row.kind === 'specification').map((row) => row.profileId),
  )
  const result = new Set(assignments.filter((row) => row.kind === 'result').map((row) => row.profileId))
  const inspection = assignments.filter((row) => row.kind === 'inspection')

  if (inspection.some((row) => specification.has(row.profileId))) {
    errors.push('คณะกรรมการกำหนดคุณลักษณะเฉพาะต้องไม่ซ้ำกับคณะกรรมการตรวจรับ')
  }
  if (inspection.some((row) => result.has(row.profileId))) {
    errors.push('คณะกรรมการพิจารณาผลต้องไม่ซ้ำกับคณะกรรมการตรวจรับ')
  }

  return [...new Set(errors)]
}

export type CommitteePdfVariant =
  | { kind: 'contract'; subjectName: string; budget: number | null }
  | { kind: 'specific_under_500k'; subjectName: null; budget: number | null }

export function committeePdfVariant(input: {
  subjectName: string | null
  total: number | null
}): CommitteePdfVariant {
  const subjectName = input.subjectName?.trim() || null
  if (subjectName) return { kind: 'contract', subjectName, budget: input.total }
  return { kind: 'specific_under_500k', subjectName: null, budget: input.total }
}
