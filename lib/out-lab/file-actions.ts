'use server'

import { revalidatePath } from 'next/cache'
import { requireActor } from '@/lib/auth/actor'
import { assertOutLabEditor } from '@/lib/out-lab/authorization'
import {
  OUT_LAB_FILE_BUCKET,
  OUT_LAB_FILE_TYPES,
  isOutLabFilePathAllowed,
  outLabFilePath,
} from '@/lib/out-lab/files'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { enqueueStorageCleanupJobBestEffort } from '@/lib/storage/cleanup-jobs'

function unwrap(operation: string, result: { error: { message: string } | null }) {
  if (result.error) throw new Error(`${operation}ไม่สำเร็จ: ${result.error.message}`)
}

/**
 * Shared by the progress-tracking upload route. The actor is resolved here,
 * before any Storage write, so the helper stays safe even as the route evolves
 * separately. Kept out of files.ts so that module stays free of the
 * supabaseAdmin import and testable from plain node/tsx without a build.
 */
export async function storeOutLabFile(contractId: string, file: File) {
  const actor = await requireActor()
  assertOutLabEditor(actor)

  if (file.size === 0) throw new Error('กรุณาเลือกไฟล์สัญญา')
  if (!OUT_LAB_FILE_TYPES.includes(file.type as (typeof OUT_LAB_FILE_TYPES)[number])) {
    throw new Error('รองรับเฉพาะ PDF และรูปภาพ')
  }

  const path = outLabFilePath(contractId, file.name)
  if (!isOutLabFilePathAllowed(path, contractId)) {
    throw new Error('เส้นทางไฟล์ไม่ถูกต้อง')
  }

  const { error: uploadError } = await supabaseAdmin.storage
    .from(OUT_LAB_FILE_BUCKET)
    .upload(path, file, { upsert: false, contentType: file.type })

  if (uploadError) throw new Error(`อัปโหลดไฟล์สัญญาไม่สำเร็จ: ${uploadError.message}`)

  const result = await supabaseAdmin.rpc('set_out_lab_contract_file', {
    p_actor_id: actor.id,
    p_contract_id: contractId,
    p_file_url: path,
  })

  if (result.error) {
    const { error: cleanupError } = await supabaseAdmin.storage
      .from(OUT_LAB_FILE_BUCKET)
      .remove([path])

    if (cleanupError) {
      console.error(`ล้างไฟล์สัญญาที่บันทึกไม่สำเร็จไม่ได้: ${cleanupError.message}`, { path })
      await enqueueStorageCleanupJobBestEffort({
        storageBackend: 'supabase_storage',
        bucketName: OUT_LAB_FILE_BUCKET,
        storageKey: path,
        jobKind: 'storage_upload_rollback',
      })
    }

    throw new Error(`บันทึกไฟล์สัญญาไม่สำเร็จ: ${result.error.message}`)
  }

  return { path }
}

/** Private evidence is read through a short-lived signed URL, never a public one. */
export async function outLabFileUrl(contractId: string, path: string) {
  await requireActor()

  if (!isOutLabFilePathAllowed(path, contractId)) {
    throw new Error('เส้นทางไฟล์ไม่ถูกต้อง')
  }

  const { data, error } = await supabaseAdmin.storage
    .from(OUT_LAB_FILE_BUCKET)
    .createSignedUrl(path, 300)

  if (error) throw new Error(`สร้างลิงก์ดาวน์โหลดไม่สำเร็จ: ${error.message}`)
  return data.signedUrl
}

export async function removeOutLabFile(contractId: string) {
  const actor = await requireActor()
  assertOutLabEditor(actor)

  const result = await supabaseAdmin.rpc('set_out_lab_contract_file', {
    p_actor_id: actor.id,
    p_contract_id: contractId,
    p_file_url: null,
  })
  unwrap('ลบไฟล์สัญญา', result)

  // The stored object is deliberately left in place. Detaching is reversible,
  // deleting is not, and an orphan in a private bucket is harmless.
  revalidatePath(`/out-lab/${contractId}`)
}
