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
  })
  if (result.error) {
    const { error: cleanupError } = await supabaseAdmin.storage
      .from(CONTRACT_FILE_BUCKET)
      .remove([path])

    if (cleanupError) {
      console.error(`ล้างไฟล์สัญญาที่บันทึกไม่สำเร็จไม่ได้: ${cleanupError.message}`, { path })
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
  })
  unwrap('ลบไฟล์สัญญา', result)

  // The stored object is deliberately left in place. Detaching is reversible,
  // deleting is not, and an orphan in a private bucket is harmless.
  revalidatePath(`/contracts/${contractId}`)
}
