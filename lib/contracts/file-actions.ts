'use server'

import { revalidatePath } from 'next/cache'
import { requireActor } from '@/lib/auth/actor'
import { assertContractEditor } from '@/lib/contracts/authorization'
import {
  CONTRACT_FILE_BUCKET,
  CONTRACT_FILE_TYPES,
  contractFilePath,
  isContractFilePathAllowed,
} from '@/lib/contracts/files'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { enqueueStorageCleanupJobBestEffort } from '@/lib/storage/cleanup-jobs'

function unwrap(operation: string, result: { error: { message: string } | null }) {
  if (result.error) throw new Error(`${operation}ไม่สำเร็จ: ${result.error.message}`)
}

/**
 * Shared by the no-JS `uploadContractFile` action and the progress-tracking
 * upload route. The actor is resolved here, before any Storage write, so this
 * helper remains safe even when the route and Server Action evolve separately.
 * Kept here (not in files.ts) so files.ts stays free of the supabaseAdmin
 * import and testable from plain node/tsx without a build.
 */
export async function storeContractFile(contractId: number, file: File) {
  const actor = await requireActor()
  assertContractEditor(actor)

  if (file.size === 0) {
    throw new Error('กรุณาเลือกไฟล์สัญญา')
  }
  if (!CONTRACT_FILE_TYPES.includes(file.type as (typeof CONTRACT_FILE_TYPES)[number])) {
    throw new Error('รองรับเฉพาะ PDF และรูปภาพ')
  }

  const path = contractFilePath(contractId, file.name)
  if (!isContractFilePathAllowed(path, contractId)) {
    throw new Error('เส้นทางไฟล์ไม่ถูกต้อง')
  }

  const { error: uploadError } = await supabaseAdmin.storage
    .from(CONTRACT_FILE_BUCKET)
    .upload(path, file, { upsert: false, contentType: file.type })

  if (uploadError) throw new Error(`อัปโหลดไฟล์สัญญาไม่สำเร็จ: ${uploadError.message}`)

  const result = await supabaseAdmin.rpc('set_contract_file', {
    p_actor_id: actor.id,
    p_contract_id: contractId,
    p_file_url: path,
    p_file_name: file.name,
    p_file_mime_type: file.type,
    p_file_size_bytes: file.size,
  })
  if (result.error) {
    const { error: cleanupError } = await supabaseAdmin.storage
      .from(CONTRACT_FILE_BUCKET)
      .remove([path])

    if (cleanupError) {
      console.error(`ล้างไฟล์สัญญาที่บันทึกไม่สำเร็จไม่ได้: ${cleanupError.message}`, { path })
      await enqueueStorageCleanupJobBestEffort({
        storageBackend: 'supabase_storage',
        bucketName: CONTRACT_FILE_BUCKET,
        storageKey: path,
        jobKind: 'storage_upload_rollback',
      })
    }

    throw new Error(`บันทึกไฟล์สัญญาไม่สำเร็จ: ${result.error.message}`)
  }

  return { path }
}

export async function uploadContractFile(contractId: number, formData: FormData) {
  const file = formData.get('file')
  if (!(file instanceof File)) {
    throw new Error('กรุณาเลือกไฟล์สัญญา')
  }

  const { path } = await storeContractFile(contractId, file)

  revalidatePath(`/contracts/${contractId}`)
  return { path }
}

/** Private evidence is read through a short-lived signed URL, never a public one. */
export async function contractFileUrl(contractId: number, path: string) {
  await requireActor()

  if (!isContractFilePathAllowed(path, contractId)) {
    throw new Error('เส้นทางไฟล์ไม่ถูกต้อง')
  }

  const { data, error } = await supabaseAdmin.storage
    .from(CONTRACT_FILE_BUCKET)
    .createSignedUrl(path, 300)

  if (error) throw new Error(`สร้างลิงก์ดาวน์โหลดไม่สำเร็จ: ${error.message}`)
  return data.signedUrl
}

export async function removeContractFile(contractId: number) {
  const actor = await requireActor()

  const result = await supabaseAdmin.rpc('set_contract_file', {
    p_actor_id: actor.id,
    p_contract_id: contractId,
    p_file_url: null,
    p_file_name: null,
    p_file_mime_type: null,
    p_file_size_bytes: null,
  })
  unwrap('ลบไฟล์สัญญา', result)

  // The stored object is deliberately left in place. Detaching is reversible,
  // deleting is not, and an orphan in a private bucket is harmless.
  revalidatePath(`/contracts/${contractId}`)
}

/**
 * Close-time deletion is deliberately separate from the reversible detach
 * control above. The database pointer and every PR reference are invalidated
 * first; Storage deletion then removes the canonical object and any replaced
 * objects that were kept alive by older PR references.
 */
export async function hardDeleteContractFiles(contractId: number, actorId: string) {
  const actor = await requireActor()
  assertContractEditor(actor)
  if (actor.id !== actorId) throw new Error('ผู้ดำเนินการลบไฟล์สัญญาไม่ตรงกับ session')

  const contractResult = await supabaseAdmin
    .from('contracts')
    .select('file_url')
    .eq('id', contractId)
    .maybeSingle()
  if (contractResult.error) throw new Error(`อ่านไฟล์สัญญาสำหรับลบไม่สำเร็จ: ${contractResult.error.message}`)
  if (!contractResult.data) throw new Error('ไม่พบสัญญาสำหรับลบไฟล์')

  const referencesResult = await supabaseAdmin
    .from('purchase_request_attachments')
    .select('storage_key')
    .eq('source_contract_id', contractId)
    .eq('storage_backend', 'supabase_storage')
  if (referencesResult.error) throw new Error(`อ่านเอกสาร PR ที่อ้างอิงไฟล์สัญญาไม่สำเร็จ: ${referencesResult.error.message}`)

  // A replacement or a reversible detach may have left an older object in
  // the contract folder. Include the folder listing so closing the contract
  // removes every object belonging to it, not only the current pointer.
  const contractFolder = `contracts/${contractId}`
  const listedResult = await supabaseAdmin.storage
    .from(CONTRACT_FILE_BUCKET)
    .list(contractFolder, { limit: 1000 })
  if (listedResult.error) throw new Error(`อ่านรายการไฟล์สัญญาสำหรับลบไม่สำเร็จ: ${listedResult.error.message}`)

  const paths = [...new Set([
    contractResult.data.file_url,
    ...(referencesResult.data ?? []).map((row) => row.storage_key),
    ...(listedResult.data ?? [])
      .filter((entry) => entry.id !== null)
      .map((entry) => `${contractFolder}/${entry.name}`),
  ].filter((path): path is string => typeof path === 'string' && path.length > 0))]

  for (const path of paths) {
    if (!isContractFilePathAllowed(path, contractId)) {
      throw new Error('เส้นทางไฟล์สัญญาไม่ถูกต้อง')
    }
  }

  const finalized = await supabaseAdmin.rpc('finalize_contract_file_hard_delete', {
    p_contract_id: contractId,
    p_actor_id: actor.id,
    p_file_paths: paths,
  })
  if (finalized.error) throw new Error(`ปิดอายุไฟล์สัญญาไม่สำเร็จ: ${finalized.error.message}`)

  const failedPaths: string[] = []
  for (let index = 0; index < paths.length; index += 100) {
    const batch = paths.slice(index, index + 100)
    const removed = await supabaseAdmin.storage.from(CONTRACT_FILE_BUCKET).remove(batch)
    if (removed.error) failedPaths.push(...batch)
  }

  for (const path of failedPaths) {
    await enqueueStorageCleanupJobBestEffort({
      storageBackend: 'supabase_storage',
      bucketName: CONTRACT_FILE_BUCKET,
      storageKey: path,
      jobKind: 'storage_upload_rollback',
    })
  }

  if (failedPaths.length > 0) {
    throw new Error(`ปิดสัญญาแล้ว แต่ยังรอลบไฟล์ ${failedPaths.length} รายการ`)
  }

  revalidatePath(`/contracts/${contractId}`)
  revalidatePath('/contracts')
  revalidatePath('/purchase-requests/new')
  return { deletedCount: paths.length }
}
