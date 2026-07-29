'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireActor } from '@/lib/auth/actor'
import { assertStockOperator } from '@/lib/inventory/authorization'
import { goodsReceiptInputSchema } from '@/lib/receipts/schema'
import { PO_IMAGE_BUCKET, buildPoImagePath, isPoImagePathAllowed } from '@/lib/receipts/storage'
import type { GoodsReceiptInput } from '@/lib/receipts/types'
import { supabaseAdmin } from '@/lib/supabase/admin'

const receiptIdSchema = z.string().uuid()

const receiptRowSchema = z
  .object({ id: z.string().uuid(), fiscal_year: z.number().int() })
  .passthrough()

function unwrapMutation(
  operation: string,
  result: { data: unknown; error: { message: string } | null },
) {
  if (result.error) throw new Error(`${operation}ไม่สำเร็จ: ${result.error.message}`)
  return receiptRowSchema.parse(result.data)
}

function revalidateReceipt(id?: string) {
  revalidatePath('/receipts')
  if (id) revalidatePath(`/receipts/${id}`)
  revalidatePath('/inventory')
  revalidatePath('/dashboard')
}

export async function createGoodsReceipt(input: GoodsReceiptInput) {
  const actor = await requireActor()
  assertStockOperator(actor)
  const parsed = goodsReceiptInputSchema.parse(input)
  const { items, ...receipt } = parsed

  const result = await supabaseAdmin.rpc('create_goods_receipt', {
    p_actor_id: actor.id,
    p_receipt: receipt,
    p_items: items,
  })

  const created = unwrapMutation('สร้างใบรับเข้า', result)
  revalidateReceipt()
  return { id: created.id, fiscalYear: created.fiscal_year }
}

/**
 * Uploads happen only after a draft exists, so the object always lands inside
 * that draft's folder. A failure here leaves the draft — and the stock — alone.
 */
export async function uploadPoImage(receiptId: string, formData: FormData) {
  const actor = await requireActor()
  assertStockOperator(actor)
  const parsedId = receiptIdSchema.parse(receiptId)

  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) {
    throw new Error('กรุณาเลือกไฟล์ภาพใบสั่งซื้อ')
  }

  const { data: receipt, error: readError } = await supabaseAdmin
    .from('goods_receipts')
    .select('id, fiscal_year')
    .eq('id', parsedId)
    .maybeSingle()

  if (readError) throw new Error(`อ่านข้อมูลใบรับเข้าไม่สำเร็จ: ${readError.message}`)
  if (!receipt) throw new Error('ไม่พบใบรับเข้าที่ระบุ')

  const { fiscal_year: fiscalYear } = receiptRowSchema.parse(receipt)
  const path = buildPoImagePath({ fiscalYear, receiptId: parsedId, fileName: file.name })

  // buildPoImagePath already sanitises, but the path is what the storage policy
  // keys on, so it is re-checked rather than trusted.
  if (!isPoImagePathAllowed(path, fiscalYear, parsedId)) {
    throw new Error('เส้นทางไฟล์ไม่ถูกต้อง')
  }

  const { error: uploadError } = await supabaseAdmin.storage
    .from(PO_IMAGE_BUCKET)
    .upload(path, file, { upsert: true, contentType: file.type })

  if (uploadError) throw new Error(`อัปโหลดภาพใบสั่งซื้อไม่สำเร็จ: ${uploadError.message}`)

  const result = await supabaseAdmin.rpc('set_goods_receipt_image', {
    p_receipt_id: parsedId,
    p_actor_id: actor.id,
    p_po_image_path: path,
  })

  unwrapMutation('บันทึกภาพใบสั่งซื้อ', result)
  revalidateReceipt(parsedId)
  return { path }
}

/** Private evidence is read through a short-lived signed URL, never a public one. */
export async function getPoImageUrl(receiptId: string) {
  const actor = await requireActor()
  assertStockOperator(actor)
  const parsedId = receiptIdSchema.parse(receiptId)

  const { data: receipt, error } = await supabaseAdmin
    .from('goods_receipts')
    .select('id, fiscal_year, po_image_path')
    .eq('id', parsedId)
    .maybeSingle()

  if (error) throw new Error(`อ่านข้อมูลใบรับเข้าไม่สำเร็จ: ${error.message}`)

  const parsedReceipt = receiptRowSchema
    .extend({ po_image_path: z.string().nullable() })
    .nullable()
    .parse(receipt)

  if (!parsedReceipt?.po_image_path) return null
  if (!isPoImagePathAllowed(parsedReceipt.po_image_path, parsedReceipt.fiscal_year, parsedId)) {
    throw new Error('เส้นทางไฟล์ไม่ถูกต้อง')
  }

  const { data, error: signError } = await supabaseAdmin.storage
    .from(PO_IMAGE_BUCKET)
    .createSignedUrl(parsedReceipt.po_image_path, 300)

  if (signError) throw new Error(`สร้างลิงก์ดูภาพไม่สำเร็จ: ${signError.message}`)
  return data?.signedUrl ?? null
}

export async function postGoodsReceipt(receiptId: string) {
  const actor = await requireActor()
  assertStockOperator(actor)
  const parsedId = receiptIdSchema.parse(receiptId)

  const result = await supabaseAdmin.rpc('post_goods_receipt', {
    p_receipt_id: parsedId,
    p_actor_id: actor.id,
  })

  const posted = unwrapMutation('บันทึกรับเข้าคลัง', result)
  revalidateReceipt(parsedId)
  return posted
}
