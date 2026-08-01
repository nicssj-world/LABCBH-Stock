'use server'

import { revalidatePath } from 'next/cache'
import { requireActor } from '@/lib/auth/actor'
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

export async function uploadContractFile(contractId: number, formData: FormData) {
  const actor = await requireActor()

  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) {
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
    .upload(path, file, { upsert: true, contentType: file.type })

  if (uploadError) throw new Error(`อัปโหลดไฟล์สัญญาไม่สำเร็จ: ${uploadError.message}`)

  // Authorisation lives in the RPC so the storage write is never the only gate.
  const result = await supabaseAdmin.rpc('set_contract_file', {
    p_actor_id: actor.id,
    p_contract_id: contractId,
    p_file_url: path,
  })
  unwrap('บันทึกไฟล์สัญญา', result)

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
