import 'server-only'

import { HeadObjectCommand } from '@aws-sdk/client-s3'
import type { Actor } from '@/lib/auth/actor'
import {
  derivePurchaseRequestChecklist,
  purchaseRequestAttachmentSlotKey,
  validateCommitteeAssignments,
  validatePurchaseRequestAttachment,
} from '@/lib/pr/checklist'
import {
  purchaseRequestChecklistSubmissionSchema,
  type PurchaseRequestChecklistSubmission,
} from '@/lib/pr/checklist-schema'
import { isPurchaseRequestChecklistStorageKey, validatePurchaseRequestChecklistObject } from '@/lib/pr/checklist-storage'
import { calculateLineTotal, type PurchaseMethodKind } from '@/lib/pr/schema'
import type { PurchaseRequestLineInput } from '@/lib/pr/types'
import { getR2BucketName, getR2Client } from '@/lib/r2/client'
import { supabaseAdmin } from '@/lib/supabase/admin'

interface UploadTicketRow {
  id: string
  actor_id: string
  upload_session_id: string
  attachment_kind: 'tor' | 'quotation' | 'plan_page' | 'contract_page'
  slot: number
  storage_key: string
  file_name: string
  mime_type: string
  size_bytes: number
  expires_at: string
  claimed_at: string | null
  cancelled_at: string | null
}

function checklistTotal(method: PurchaseMethodKind, items: readonly PurchaseRequestLineInput[]) {
  if (method === 'equipment_lease') return null
  return items.reduce((sum, item) => sum + calculateLineTotal(item.requestedQuantity, item.unitPrice), 0)
}

function validateSubmissionShape(
  method: PurchaseMethodKind,
  items: readonly PurchaseRequestLineInput[],
  submission: PurchaseRequestChecklistSubmission,
) {
  const policy = derivePurchaseRequestChecklist(method, checklistTotal(method, items))
  const expectedSlots = new Set(
    policy.attachments.map((requirement) => purchaseRequestAttachmentSlotKey(requirement.kind, requirement.slot)),
  )
  const submittedSlots = submission.attachments.map((attachment) =>
    purchaseRequestAttachmentSlotKey(attachment.kind, attachment.slot),
  )
  if (
    submittedSlots.length !== expectedSlots.size ||
    new Set(submittedSlots).size !== submittedSlots.length ||
    submittedSlots.some((slot) => !expectedSlots.has(slot))
  ) {
    throw new Error('เอกสาร checklist ยังไม่ครบหรือไม่ตรงกับยอดรวมปัจจุบัน')
  }

  const committeeErrors = validateCommitteeAssignments(policy, submission.committees)
  if (committeeErrors.length > 0) throw new Error(committeeErrors.join(' · '))
  return policy
}

export async function verifyPurchaseRequestChecklistUploads(input: {
  actor: Actor
  method: PurchaseMethodKind
  items: readonly PurchaseRequestLineInput[]
  submission: PurchaseRequestChecklistSubmission
  allowExistingAttachments: boolean
}) {
  const submission = purchaseRequestChecklistSubmissionSchema.parse(input.submission)
  validateSubmissionShape(input.method, input.items, submission)

  if (!input.allowExistingAttachments && submission.attachments.some((attachment) => 'attachmentId' in attachment)) {
    throw new Error('ใบ PR ใหม่ต้องอัปโหลดเอกสารทุกฉบับผ่านรอบการส่งปัจจุบัน')
  }

  const uploadReferences = submission.attachments.filter(
    (attachment): attachment is Extract<(typeof submission.attachments)[number], { uploadId: string }> =>
      'uploadId' in attachment,
  )
  if (uploadReferences.length === 0) return submission

  const uploadIds = uploadReferences.map((attachment) => attachment.uploadId)
  const ticketResult = await supabaseAdmin
    .from('purchase_request_upload_tickets')
    .select('id, actor_id, upload_session_id, attachment_kind, slot, storage_key, file_name, mime_type, size_bytes, expires_at, claimed_at, cancelled_at')
    .in('id', uploadIds)
  if (ticketResult.error) throw new Error(`ตรวจรายการอัปโหลดไม่สำเร็จ: ${ticketResult.error.message}`)

  const tickets = new Map((ticketResult.data as UploadTicketRow[] | null)?.map((ticket) => [ticket.id, ticket]) ?? [])
  await Promise.all(uploadReferences.map(async (reference) => {
    const ticket = tickets.get(reference.uploadId)
    if (!ticket) throw new Error('ไม่พบรายการอัปโหลด กรุณาอัปโหลดไฟล์นี้ใหม่')
    if (
      ticket.actor_id !== input.actor.id ||
      ticket.upload_session_id !== submission.uploadSessionId ||
      ticket.attachment_kind !== reference.kind ||
      ticket.slot !== reference.slot ||
      ticket.cancelled_at
    ) {
      throw new Error('รายการอัปโหลดไม่ตรงกับผู้ใช้หรือช่องเอกสาร')
    }
    if (!ticket.claimed_at && Date.parse(ticket.expires_at) <= Date.now()) {
      throw new Error('รายการอัปโหลดหมดอายุ กรุณาอัปโหลดไฟล์นี้ใหม่')
    }
    if (!isPurchaseRequestChecklistStorageKey(ticket.storage_key)) {
      throw new Error('เส้นทางเอกสารอยู่นอกพื้นที่ PR ที่อนุญาต')
    }
    const fileErrors = validatePurchaseRequestAttachment({
      kind: ticket.attachment_kind,
      mimeType: ticket.mime_type,
      sizeBytes: ticket.size_bytes,
    })
    if (fileErrors.length > 0) throw new Error(fileErrors.join(' · '))

    let object
    try {
      object = await getR2Client().send(new HeadObjectCommand({
        Bucket: getR2BucketName(),
        Key: ticket.storage_key,
      }))
    } catch {
      throw new Error(`ยังไม่พบไฟล์ ${ticket.file_name} ใน R2 กรุณาอัปโหลดใหม่`)
    }
    const objectErrors = validatePurchaseRequestChecklistObject(
      { sizeBytes: ticket.size_bytes, mimeType: ticket.mime_type },
      { contentLength: object.ContentLength, contentType: object.ContentType },
    )
    if (objectErrors.length > 0) throw new Error(`${ticket.file_name}: ${objectErrors.join(' · ')}`)
  }))

  return submission
}
