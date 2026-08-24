import 'server-only'

import { z } from 'zod'
import { canOperateStock } from '@/lib/auth/access'
import type { Actor } from '@/lib/auth/actor'
import { purchaseMethodPurpose } from '@/lib/pr/schema'
import type { PurchaseRequestChecklistRecord } from '@/lib/pr/types'
import { supabaseAdmin } from '@/lib/supabase/admin'

const purchaseRequestIdSchema = z.string().uuid()

const accessRowSchema = z.object({
  id: z.string().uuid(),
  requester_id: z.string().uuid().nullable(),
  purchase_method: z.enum([
    'annual_plan',
    'contract',
    'awaiting_contract',
    'off_plan',
    'specific_contract',
    'e_bidding',
    'equipment_lease',
  ]),
  method_details: z.record(z.unknown()),
  status: z.string(),
  created_contract_id: z.coerce.number().int().positive().nullable(),
  checklist_policy_version: z.number().int().nullable(),
  checklist_completed_at: z.string().nullable(),
})

export class PurchaseRequestChecklistAccessError extends Error {
  constructor(message = 'ไม่มีสิทธิ์ดูเอกสาร checklist ของใบ PR นี้') {
    super(message)
    this.name = 'PurchaseRequestChecklistAccessError'
  }
}

export async function getPurchaseRequestChecklistAccess(purchaseRequestId: string, actor: Actor) {
  const id = purchaseRequestIdSchema.parse(purchaseRequestId)
  const result = await supabaseAdmin
    .from('purchase_requests')
    .select('id, requester_id, purchase_method, method_details, status, created_contract_id, checklist_policy_version, checklist_completed_at')
    .eq('id', id)
    .maybeSingle()
  if (result.error) throw new Error(`อ่านสิทธิ์เอกสารใบ PR ไม่สำเร็จ: ${result.error.message}`)
  if (!result.data) throw new PurchaseRequestChecklistAccessError('ไม่พบใบ PR')
  const request = accessRowSchema.parse(result.data)
  const stockAccess = canOperateStock(actor)
  if (!stockAccess && request.requester_id !== actor.id) throw new PurchaseRequestChecklistAccessError()
  return { request, stockAccess }
}

export async function assertPurchaseRequestChecklistStockAccess(purchaseRequestId: string, actor: Actor) {
  const access = await getPurchaseRequestChecklistAccess(purchaseRequestId, actor)
  if (!access.stockAccess) throw new PurchaseRequestChecklistAccessError('เฉพาะเจ้าหน้าที่คลังหรือผู้ดูแลระบบเท่านั้น')
  return access
}

async function checklistMustBePurged(request: z.infer<typeof accessRowSchema>) {
  if (
    purchaseMethodPurpose(request.purchase_method) === 'purchase_order' &&
    ['received', 'closed_short'].includes(request.status)
  ) return true

  if (purchaseMethodPurpose(request.purchase_method) !== 'new_contract' || !request.created_contract_id) return false
  const contractResult = await supabaseAdmin
    .from('contracts')
    .select('procurement_stage')
    .eq('id', request.created_contract_id)
    .maybeSingle()
  if (contractResult.error) throw new Error(`อ่านสถานะสัญญาไม่สำเร็จ: ${contractResult.error.message}`)
  return ['winner_announced', 'contract_started'].includes(contractResult.data?.procurement_stage ?? '')
}

export async function isPurchaseRequestChecklistDownloadBlocked(purchaseRequestId: string, actor: Actor) {
  const access = await getPurchaseRequestChecklistAccess(purchaseRequestId, actor)
  return checklistMustBePurged(access.request)
}

export async function getPurchaseRequestChecklist(
  purchaseRequestId: string,
  actor: Actor,
): Promise<PurchaseRequestChecklistRecord> {
  const access = await getPurchaseRequestChecklistAccess(purchaseRequestId, actor)
  const [attachmentResult, committeeResult] = await Promise.all([
    supabaseAdmin
      .from('purchase_request_attachments')
      .select('id, attachment_kind, slot, file_name, mime_type, size_bytes, uploaded_at, deleted_at, deletion_reason, object_deleted_at, uploader:profiles!purchase_request_attachments_uploaded_by_fkey(name), deleter:profiles!purchase_request_attachments_deleted_by_fkey(name)')
      .eq('purchase_request_id', access.request.id)
      .order('attachment_kind')
      .order('slot'),
    supabaseAdmin
      .from('purchase_request_committees')
      .select('id, committee_kind, seat, profile_id, name_snapshot, position_snapshot, source_contract_id, profile:profiles!purchase_request_committees_profile_id_fkey(name, name_prefix, position_title, status, deleted_at)')
      .eq('purchase_request_id', access.request.id)
      .order('committee_kind')
      .order('seat'),
  ])
  if (attachmentResult.error) throw new Error(`อ่านเอกสาร checklist ไม่สำเร็จ: ${attachmentResult.error.message}`)
  if (committeeResult.error) throw new Error(`อ่านรายชื่อกรรมการไม่สำเร็จ: ${committeeResult.error.message}`)

  const attachments = (attachmentResult.data ?? []).map((row) => {
    const uploader = Array.isArray(row.uploader) ? row.uploader[0] : row.uploader
    const deleter = Array.isArray(row.deleter) ? row.deleter[0] : row.deleter
    return {
      id: String(row.id),
      kind: row.attachment_kind as PurchaseRequestChecklistRecord['attachments'][number]['kind'],
      slot: Number(row.slot),
      fileName: String(row.file_name),
      mimeType: String(row.mime_type),
      sizeBytes: Number(row.size_bytes),
      uploadedAt: String(row.uploaded_at),
      uploadedByName: uploader?.name ?? null,
      deletedAt: row.deleted_at ?? null,
      deletedByName: deleter?.name ?? null,
      deletionReason: row.deletion_reason as PurchaseRequestChecklistRecord['attachments'][number]['deletionReason'],
      objectDeletedAt: row.object_deleted_at ?? null,
    }
  })

  const committees = (committeeResult.data ?? []).map((row) => {
    const profile = Array.isArray(row.profile) ? row.profile[0] : row.profile
    const active = Boolean(profile && profile.status === 'active' && profile.deleted_at === null)
    return {
      id: String(row.id),
      kind: row.committee_kind as PurchaseRequestChecklistRecord['committees'][number]['kind'],
      seat: Number(row.seat),
      profileId: String(row.profile_id),
      name: profile?.name?.trim() || String(row.name_snapshot),
      namePrefix: profile?.name_prefix?.trim() || null,
      positionTitle: profile?.position_title?.trim() || null,
      profileActive: active,
      sourceContractId: row.source_contract_id === null ? null : Number(row.source_contract_id),
    }
  })

  const downloadsBlocked = await checklistMustBePurged(access.request)

  return {
    policyVersion: access.request.checklist_policy_version,
    completedAt: access.request.checklist_completed_at,
    attachments,
    committees,
    canDownloadCommitteePdf:
      committees.length > 0 && committees.every((member) => member.profileActive && Boolean(member.positionTitle)),
    cleanupPendingCount: attachments.filter((attachment) =>
      !attachment.objectDeletedAt && (downloadsBlocked || Boolean(attachment.deletedAt)),
    ).length,
    downloadsBlocked,
  }
}

export async function getPurchaseRequestChecklistAttachment(
  purchaseRequestId: string,
  attachmentId: string,
  actor: Actor,
) {
  const access = await getPurchaseRequestChecklistAccess(purchaseRequestId, actor)
  if (await checklistMustBePurged(access.request)) {
    throw new PurchaseRequestChecklistAccessError('เอกสารแนบถูกลบตามอายุงานแล้ว')
  }
  const parsedAttachmentId = z.string().uuid().parse(attachmentId)
  const result = await supabaseAdmin
    .from('purchase_request_attachments')
    .select('id, storage_key, file_name, mime_type, size_bytes')
    .eq('id', parsedAttachmentId)
    .eq('purchase_request_id', access.request.id)
    .is('deleted_at', null)
    .is('object_deleted_at', null)
    .maybeSingle()
  if (result.error) throw new Error(`อ่านเอกสารแนบไม่สำเร็จ: ${result.error.message}`)
  if (!result.data) throw new PurchaseRequestChecklistAccessError('ไม่พบเอกสารแนบหรือเอกสารถูกลบแล้ว')
  return result.data
}

export async function listPurchaseRequestChecklistDownloadObjects(
  purchaseRequestId: string,
  actor: Actor,
) {
  const access = await assertPurchaseRequestChecklistStockAccess(purchaseRequestId, actor)
  if (await checklistMustBePurged(access.request)) return []
  const result = await supabaseAdmin
    .from('purchase_request_attachments')
    .select('id, attachment_kind, slot, storage_key, file_name, mime_type, size_bytes')
    .eq('purchase_request_id', access.request.id)
    .is('deleted_at', null)
    .is('object_deleted_at', null)
    .order('attachment_kind')
    .order('slot')
  if (result.error) throw new Error(`อ่านเอกสารสำหรับดาวน์โหลดไม่สำเร็จ: ${result.error.message}`)
  return result.data ?? []
}
