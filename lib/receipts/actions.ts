'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireActor } from '@/lib/auth/actor'
import { assertStockOperator } from '@/lib/inventory/authorization'
import { assertGoodsReceiptCreator } from '@/lib/receipts/authorization'
import { cancelGoodsReceiptSchema, goodsReceiptInputSchema } from '@/lib/receipts/schema'
import { cleanupPoFileAfterPostedReceipt } from '@/lib/po/cleanup'
import { cleanupPurchaseRequestChecklistAfterPostedReceipt } from '@/lib/pr/checklist-cleanup'
import type { CancelGoodsReceiptInput, GoodsReceiptInput } from '@/lib/receipts/types'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { omitNullishProperties } from '@/lib/validation/json'

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
  revalidatePath('/purchase-requests')
}

export async function createGoodsReceipt(input: GoodsReceiptInput) {
  const actor = await requireActor()
  assertGoodsReceiptCreator(actor)
  const parsed = goodsReceiptInputSchema.parse(input)
  const { items, ...receipt } = parsed

  const result = await supabaseAdmin.rpc('create_goods_receipt', {
    p_actor_id: actor.id,
    p_receipt: receipt,
    p_items: items.map(omitNullishProperties),
  })

  const created = unwrapMutation('สร้างใบรับเข้า', result)
  revalidateReceipt()
  return { id: created.id, fiscalYear: created.fiscal_year }
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
  try {
    await Promise.all([
      cleanupPoFileAfterPostedReceipt(parsedId, actor.id),
      cleanupPurchaseRequestChecklistAfterPostedReceipt(parsedId, actor.id),
    ])
  } catch (error) {
    // The receipt and stock transition are already committed by the RPC. Do
    // not pretend that it rolled back; surface a retryable cleanup warning.
    revalidateReceipt(parsedId)
    const message = error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ'
    throw new Error(`บันทึกรับเข้าคลังสำเร็จ แต่การล้างไฟล์หลังรับเข้าไม่สำเร็จ: ${message}`)
  }
  revalidateReceipt(parsedId)
  return posted
}

export async function cancelGoodsReceipt(receiptId: string, input: CancelGoodsReceiptInput) {
  const actor = await requireActor()
  assertStockOperator(actor)
  const parsedId = receiptIdSchema.parse(receiptId)
  const parsed = cancelGoodsReceiptSchema.parse(input)

  const result = await supabaseAdmin.rpc('cancel_goods_receipt', {
    p_receipt_id: parsedId,
    p_actor_id: actor.id,
    p_note: parsed.note,
  })

  const cancelled = unwrapMutation('ยกเลิกใบรับเข้า', result)
  revalidateReceipt(parsedId)
  return cancelled
}
