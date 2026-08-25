import 'server-only'

import { supabaseAdmin } from '@/lib/supabase/admin'

export type StorageCleanupBackend = 'r2' | 'supabase_storage'
export type StorageCleanupJobKind =
  | 'checklist_upload_orphan'
  | 'storage_upload_rollback'
  | 'checklist_lifecycle_retry'
  | 'po_lifecycle_retry'
  | 'annual_plan_retention_retry'

interface StorageCleanupJobInput {
  storageBackend: StorageCleanupBackend
  bucketName: string | null
  storageKey: string | null
  jobKind: StorageCleanupJobKind
  resourceId?: string | null
  metadata?: Record<string, unknown>
  availableAt?: string | null
}

export async function enqueueStorageCleanupJob(input: StorageCleanupJobInput): Promise<string | null> {
  const result = await supabaseAdmin.rpc('enqueue_storage_cleanup_job', {
    p_storage_backend: input.storageBackend,
    p_bucket_name: input.bucketName,
    p_storage_key: input.storageKey,
    p_job_kind: input.jobKind,
    p_resource_id: input.resourceId ?? null,
    p_metadata: input.metadata ?? {},
    p_available_at: input.availableAt ?? null,
  })
  if (result.error) throw new Error(`เข้าคิวล้างไฟล์ไม่สำเร็จ: ${result.error.message}`)
  return typeof result.data === 'string' ? result.data : null
}

export async function enqueueStorageCleanupJobBestEffort(input: StorageCleanupJobInput) {
  try {
    await enqueueStorageCleanupJob(input)
  } catch (error) {
    console.error('จัดคิวล้างไฟล์อัตโนมัติไม่สำเร็จ', {
      jobKind: input.jobKind,
      storageBackend: input.storageBackend,
      bucketName: input.bucketName,
      storageKey: input.storageKey,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
