import 'server-only'

import { z } from 'zod'
import { enqueueStorageCleanupJobBestEffort } from '@/lib/storage/cleanup-jobs'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { SERVICE_FILE_BUCKET, isServiceFilePathAllowed } from './files'

const closureSchema = z.object({ planId: z.string().uuid(), storageKeys: z.array(z.string()) })

function isMissingStorageObject(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const candidate = error as { statusCode?: number | string; message?: string }
  return String(candidate.statusCode ?? '') === '404' || /not found|does not exist|object not found|no such object/i.test(candidate.message ?? '')
}

async function removeObject(path: string) {
  const result = await supabaseAdmin.storage.from(SERVICE_FILE_BUCKET).remove([path])
  if (result.error && !isMissingStorageObject(result.error)) throw new Error(result.error.message)
}

/** Moves expired plans through active → closing → closed and hard-deletes the
 * current quotation/contract objects. Failed object deletions are retried by
 * the existing shared storage-cleanup queue. */
export async function cleanupExpiredServicePlans(systemActorId: string): Promise<{ closed: number; deleted: number; queued: number }> {
  const result = await supabaseAdmin.rpc('advance_service_procurement_plan_lifecycle', { p_actor_id: systemActorId })
  if (result.error) throw new Error(`ปิดแผนงานจ้างสิ้นปีไม่สำเร็จ: ${result.error.message}`)
  let closed = 0; let deleted = 0; let queued = 0
  for (const raw of Array.isArray(result.data) ? result.data : []) {
    const plan = closureSchema.parse(raw); closed += 1
    for (const path of plan.storageKeys) {
      if (!isServiceFilePathAllowed(path, plan.planId, 'plan-document')) { queued += 1; await enqueueStorageCleanupJobBestEffort({ storageBackend: 'supabase_storage', bucketName: SERVICE_FILE_BUCKET, storageKey: path, jobKind: 'storage_upload_rollback' }); continue }
      try { await removeObject(path); deleted += 1 }
      catch (error) { queued += 1; await enqueueStorageCleanupJobBestEffort({ storageBackend: 'supabase_storage', bucketName: SERVICE_FILE_BUCKET, storageKey: path, jobKind: 'storage_upload_rollback' }); console.error('ล้างเอกสารแผนงานจ้างไม่สำเร็จ', error) }
    }
  }
  return { closed, deleted, queued }
}
