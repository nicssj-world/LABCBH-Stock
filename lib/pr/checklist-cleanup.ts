import 'server-only'

import { DeleteObjectCommand } from '@aws-sdk/client-s3'
import { purchaseMethodPurpose } from '@/lib/pr/schema'
import { isPurchaseRequestChecklistStorageKey } from '@/lib/pr/checklist-storage'
import { getR2BucketName, getR2Client } from '@/lib/r2/client'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { enqueueStorageCleanupJobBestEffort } from '@/lib/storage/cleanup-jobs'

export type PurchaseRequestChecklistDeletionReason =
  | 'replaced'
  | 'edit_removed'
  | 'received'
  | 'closed_short'
  | 'winner_announced'
  | 'contract_closed'

interface CleanupAttachmentRow {
  id: string
  storage_key: string
  deletion_reason: PurchaseRequestChecklistDeletionReason | null
  source_contract_id: number | null
}

async function markDeleted(
  purchaseRequestId: string,
  actorId: string,
  reason: PurchaseRequestChecklistDeletionReason,
  attachmentIds: string[],
) {
  if (attachmentIds.length === 0) return
  const result = await supabaseAdmin.rpc('mark_purchase_request_checklist_objects_deleted', {
    p_pr_id: purchaseRequestId,
    p_actor_id: actorId,
    p_attachment_ids: attachmentIds,
    p_reason: reason,
  })
  if (result.error) throw new Error(`บันทึกผลการลบเอกสาร checklist ไม่สำเร็จ: ${result.error.message}`)
}

async function queueChecklistLifecycleRetry(
  purchaseRequestId: string,
  reason: PurchaseRequestChecklistDeletionReason,
) {
  await enqueueStorageCleanupJobBestEffort({
    storageBackend: 'r2',
    bucketName: null,
    storageKey: null,
    jobKind: 'checklist_lifecycle_retry',
    resourceId: purchaseRequestId,
    metadata: { reason },
  })
}

export async function cleanupPurchaseRequestChecklistObjects(
  purchaseRequestId: string,
  actorId: string,
  reason: PurchaseRequestChecklistDeletionReason,
) {
  const requestResult = await supabaseAdmin
    .from('purchase_requests')
    .select('id, purchase_method, checklist_policy_version')
    .eq('id', purchaseRequestId)
    .maybeSingle()
  if (requestResult.error) throw new Error(`อ่านใบ PR ก่อนลบเอกสารไม่สำเร็จ: ${requestResult.error.message}`)
  if (!requestResult.data?.checklist_policy_version) return { deletedCount: 0 }

  const purpose = purchaseMethodPurpose(requestResult.data.purchase_method)
  if (reason === 'winner_announced' && purpose !== 'new_contract') return { deletedCount: 0 }
  if (['received', 'closed_short'].includes(reason) && purpose !== 'purchase_order') return { deletedCount: 0 }

  let query = supabaseAdmin
    .from('purchase_request_attachments')
    .select('id, storage_key, deletion_reason, source_contract_id')
    .eq('purchase_request_id', purchaseRequestId)
    .is('object_deleted_at', null)
  if (reason === 'replaced' || reason === 'edit_removed') query = query.not('deleted_at', 'is', null)

  const attachmentResult = await query
  if (attachmentResult.error) throw new Error(`อ่านรายการเอกสารที่จะลบไม่สำเร็จ: ${attachmentResult.error.message}`)
  const attachments = (attachmentResult.data ?? []) as CleanupAttachmentRow[]
  // Contract-page rows are references to the contract bucket, not owned R2
  // objects of this PR. They remain available to later PRs until the contract
  // close action performs the hard delete.
  const ownedAttachments = attachments.filter((attachment) => attachment.source_contract_id === null)
  const deletedByReason = new Map<PurchaseRequestChecklistDeletionReason, string[]>()
  const failures: string[] = []

  for (const attachment of ownedAttachments) {
    if (!isPurchaseRequestChecklistStorageKey(attachment.storage_key)) {
      failures.push(`${attachment.id}: เส้นทางอยู่นอก namespace ของ PR`)
      continue
    }
    try {
      await getR2Client().send(new DeleteObjectCommand({
        Bucket: getR2BucketName(),
        Key: attachment.storage_key,
      }))
      const recordedReason = attachment.deletion_reason ?? reason
      const ids = deletedByReason.get(recordedReason) ?? []
      ids.push(attachment.id)
      deletedByReason.set(recordedReason, ids)
    } catch (error) {
      failures.push(`${attachment.id}: ${error instanceof Error ? error.message : 'ลบไฟล์จาก R2 ไม่สำเร็จ'}`)
      await queueChecklistLifecycleRetry(purchaseRequestId, reason)
    }
  }

  for (const [recordedReason, attachmentIds] of deletedByReason) {
    try {
      await markDeleted(purchaseRequestId, actorId, recordedReason, attachmentIds)
    } catch (error) {
      await queueChecklistLifecycleRetry(purchaseRequestId, recordedReason)
      throw error
    }
  }
  if (failures.length > 0) throw new Error(failures.join(' · '))
  return { deletedCount: [...deletedByReason.values()].reduce((sum, ids) => sum + ids.length, 0) }
}

export async function cleanupPurchaseRequestChecklistForContract(contractId: number, actorId: string) {
  const result = await supabaseAdmin
    .from('purchase_requests')
    .select('id')
    .eq('created_contract_id', contractId)
    .not('checklist_policy_version', 'is', null)
    .maybeSingle()
  if (result.error) throw new Error(`ค้นหาใบ PR ต้นทางของสัญญาไม่สำเร็จ: ${result.error.message}`)
  if (!result.data) return { deletedCount: 0 }
  return cleanupPurchaseRequestChecklistObjects(result.data.id, actorId, 'winner_announced')
}

export async function cleanupPurchaseRequestChecklistAfterPostedReceipt(receiptId: string, actorId: string) {
  const receiptResult = await supabaseAdmin
    .from('goods_receipts')
    .select('purchase_request_id, purchase_request:purchase_requests!goods_receipts_purchase_request_id_fkey(status)')
    .eq('id', receiptId)
    .maybeSingle()
  if (receiptResult.error) throw new Error(`อ่านใบ PR ของใบรับเข้าไม่สำเร็จ: ${receiptResult.error.message}`)
  const relation = receiptResult.data?.purchase_request
  const request = Array.isArray(relation) ? relation[0] : relation
  if (!receiptResult.data?.purchase_request_id || request?.status !== 'received') return { deletedCount: 0 }
  return cleanupPurchaseRequestChecklistObjects(receiptResult.data.purchase_request_id, actorId, 'received')
}
