import { DeleteObjectCommand } from '@aws-sdk/client-s3'
import { NextResponse } from 'next/server'
import { cleanupPurchaseRequestChecklistObjects } from '@/lib/pr/checklist-cleanup'
import type { PurchaseRequestChecklistDeletionReason } from '@/lib/pr/checklist-cleanup'
import { cleanupTerminalPurchaseRequestPoFile } from '@/lib/po/cleanup'
import { getR2BucketName, getR2Client } from '@/lib/r2/client'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

type CleanupJobKind =
  | 'checklist_upload_orphan'
  | 'storage_upload_rollback'
  | 'checklist_lifecycle_retry'
  | 'po_lifecycle_retry'

interface CleanupJob {
  id: string
  storage_backend: 'r2' | 'supabase_storage'
  bucket_name: string | null
  storage_key: string | null
  job_kind: CleanupJobKind
  resource_id: string | null
  metadata: Record<string, unknown>
}

const checklistReasons: readonly PurchaseRequestChecklistDeletionReason[] = [
  'replaced',
  'edit_removed',
  'received',
  'closed_short',
  'winner_announced',
]

function isChecklistReason(value: unknown): value is PurchaseRequestChecklistDeletionReason {
  return typeof value === 'string' && checklistReasons.includes(value as PurchaseRequestChecklistDeletionReason)
}

function isMissingSupabaseStorageObject(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const candidate = error as { statusCode?: number | string; message?: string }
  return (
    String(candidate.statusCode ?? '') === '404' ||
    /not found|does not exist|object not found|no such object/i.test(candidate.message ?? '')
  )
}

async function removeStorageObject(job: CleanupJob) {
  if (!job.storage_key || !job.bucket_name) throw new Error('คิวล้างไฟล์ไม่มี bucket หรือ storage key')

  if (job.storage_backend === 'r2') {
    await getR2Client().send(new DeleteObjectCommand({
      Bucket: getR2BucketName(),
      Key: job.storage_key,
    }))
    return
  }

  const result = await supabaseAdmin.storage.from(job.bucket_name).remove([job.storage_key])
  if (result.error && !isMissingSupabaseStorageObject(result.error)) {
    throw new Error(result.error.message)
  }
}

async function findSystemActorId() {
  const result = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('ephis_id', '9495')
    .eq('status', 'active')
    .is('deleted_at', null)
    .maybeSingle()
  if (result.error) throw new Error(`อ่านผู้ดูแลระบบสำหรับ cleanup ไม่สำเร็จ: ${result.error.message}`)
  if (!result.data?.id) throw new Error('ไม่พบผู้ดูแลระบบที่ใช้ทำ cleanup อัตโนมัติ')
  return result.data.id
}

async function processChecklistUploadOrphan(job: CleanupJob) {
  if (!job.resource_id || !job.storage_key) throw new Error('คิว orphan checklist ไม่มี upload ticket')

  const begin = await supabaseAdmin.rpc('begin_purchase_request_upload_object_cleanup', {
    p_ticket_id: job.resource_id,
  })
  if (begin.error) throw new Error(begin.error.message)

  const target = Array.isArray(begin.data) ? begin.data[0] as { id: string; storage_key: string } | undefined : undefined
  if (!target) return
  if (target.storage_key !== job.storage_key) throw new Error('storage key ของ upload ticket ไม่ตรงกับคิว')

  try {
    await removeStorageObject({ ...job, storage_backend: 'r2', bucket_name: '__r2__', storage_key: target.storage_key })
    const mark = await supabaseAdmin.rpc('mark_purchase_request_upload_object_deleted', {
      p_ticket_id: job.resource_id,
    })
    if (mark.error) throw new Error(mark.error.message)
  } catch (error) {
    await supabaseAdmin.rpc('release_purchase_request_upload_object_cleanup', {
      p_ticket_id: job.resource_id,
    })
    throw error
  }
}

async function processLifecycleRetry(job: CleanupJob) {
  if (!job.resource_id) throw new Error('คิว lifecycle cleanup ไม่มี resource id')
  const actorId = await findSystemActorId()
  const reason = job.metadata.reason

  if (job.job_kind === 'checklist_lifecycle_retry') {
    if (!isChecklistReason(reason)) throw new Error('เหตุผล cleanup checklist ไม่ถูกต้อง')
    await cleanupPurchaseRequestChecklistObjects(job.resource_id, actorId, reason)
    return
  }

  if (job.job_kind === 'po_lifecycle_retry') {
    if (reason !== 'received' && reason !== 'closed_short') throw new Error('เหตุผล cleanup PO ไม่ถูกต้อง')
    const receiptId = job.metadata.receiptId
    if (receiptId !== null && receiptId !== undefined && typeof receiptId !== 'string') {
      throw new Error('receipt id ของ cleanup PO ไม่ถูกต้อง')
    }
    await cleanupTerminalPurchaseRequestPoFile(job.resource_id, actorId, {
      reason,
      receiptId: receiptId ?? null,
    })
    return
  }

  throw new Error('ไม่รู้จัก lifecycle cleanup job')
}

async function processJob(job: CleanupJob) {
  if (job.job_kind === 'checklist_upload_orphan') {
    await processChecklistUploadOrphan(job)
    return
  }
  if (job.job_kind === 'storage_upload_rollback') {
    await removeStorageObject(job)
    return
  }
  await processLifecycleRetry(job)
}

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret) return NextResponse.json({ error: 'cleanup secret is not configured' }, { status: 503 })
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'ไม่ได้รับอนุญาต' }, { status: 401 })
  }

  const claimed = await supabaseAdmin.rpc('claim_storage_cleanup_jobs', { p_limit: 25 })
  if (claimed.error) {
    return NextResponse.json({ error: claimed.error.message }, { status: 500 })
  }

  const jobs = (Array.isArray(claimed.data) ? claimed.data : []) as CleanupJob[]
  let completed = 0
  const failures: Array<{ id: string; error: string }> = []

  for (const job of jobs) {
    try {
      await processJob(job)
      const result = await supabaseAdmin.rpc('complete_storage_cleanup_job', {
        p_job_id: job.id,
        p_success: true,
        p_error: null,
      })
      if (result.error) throw new Error(result.error.message)
      completed += 1
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      failures.push({ id: job.id, error: message })
      await supabaseAdmin.rpc('complete_storage_cleanup_job', {
        p_job_id: job.id,
        p_success: false,
        p_error: message,
      })
    }
  }

  return NextResponse.json(
    { ok: failures.length === 0, claimed: jobs.length, completed, failed: failures.length, failures },
    { status: failures.length === 0 ? 200 : 500 },
  )
}
