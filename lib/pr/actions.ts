'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireActor } from '@/lib/auth/actor'
import { assertStockOperator } from '@/lib/inventory/authorization'
import {
  assertPurchaseRequestOutsideStockReceiver,
  assertPurchaseRequestManager,
  assertPurchaseRequester,
} from '@/lib/pr/authorization'
import {
  ephisPrNumberSchema,
  purchaseOrderNumberSchema,
  purchaseRequestInputSchema,
  purchaseRequestReversalSchema,
  purchaseRequestShortCloseSchema,
} from '@/lib/pr/schema'
import { isoDateSchema } from '@/lib/validation/date'
import { cleanupTerminalPurchaseRequestPoFile } from '@/lib/po/cleanup'
import type {
  EphisPrNumberInput,
  PurchaseOrderNumberInput,
  PurchaseRequestInput,
  PurchaseRequestReversalInput,
  PurchaseRequestShortCloseInput,
} from '@/lib/pr/types'
import { getPurchaseRequest } from '@/lib/pr/queries'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { omitNullishProperties } from '@/lib/validation/json'
import { formatPurchaseRequestMutationError } from './errors'

const purchaseRequestIdSchema = z.string().uuid()

function unwrapMutation(
  operation: string,
  result: { data: unknown; error: { message: string } | null },
) {
  if (result.error) throw new Error(formatPurchaseRequestMutationError(operation, result.error.message))
  return z.object({ id: z.string().uuid() }).passthrough().parse(result.data)
}

function revalidatePurchaseRequest(id?: string) {
  revalidatePath('/purchase-requests')
  revalidatePath('/purchase-requests/new')
  if (id) revalidatePath(`/purchase-requests/${id}`)
  revalidatePath('/dashboard')
  revalidatePath('/contracts')
  // A manually entered PR line may have created a new catalogue row in the
  // same transaction. Keep every downstream picker/list in sync immediately.
  revalidatePath('/inventory')
  revalidatePath('/receipts/new')
  revalidatePath('/requisitions/new')
}

/** The Thai fiscal year rolls on 1 October. */
function thaiFiscalYear(isoDate: string): number {
  const [year, month] = isoDate.split('-').map(Number)
  return year + 543 + (month >= 10 ? 1 : 0)
}

export async function createPurchaseRequest(input: PurchaseRequestInput) {
  const actor = await requireActor()
  assertPurchaseRequester(actor)
  const parsed = purchaseRequestInputSchema.parse(input)
  const { items, ...request } = parsed

  const result = await supabaseAdmin.rpc('create_purchase_request', {
    p_actor_id: actor.id,
    // headName always names the actor creating the PR — never trust a
    // client-supplied value, which a direct call to this action could set
    // to anyone's name.
    p_request: { ...request, headName: actor.name ?? request.headName, fiscalYear: thaiFiscalYear(parsed.requestedDate) },
    // Usage and on-hand snapshots are taken inside the transaction, not here,
    // so a stale browser value can never be recorded as fact.
    p_items: items.map(omitNullishProperties),
  })

  const created = unwrapMutation('สร้างใบ PR', result)
  revalidatePurchaseRequest()
  return created
}

/**
 * A submitted PR can only be changed while it is still pending. The RPC locks
 * the row and repeats every contract/item check so an old browser cannot
 * rewrite a PR after a stock officer has already acted on it.
 */
export async function updatePurchaseRequest(
  purchaseRequestId: string,
  input: PurchaseRequestInput,
) {
  const actor = await requireActor()
  const parsedId = purchaseRequestIdSchema.parse(purchaseRequestId)
  const parsed = purchaseRequestInputSchema.parse(input)
  const existing = await getPurchaseRequest(parsedId)
  if (!existing) throw new Error('ไม่พบใบ PR ที่ต้องการแก้ไข')
  assertPurchaseRequestManager(actor, existing.requesterId)
  const { items, ...request } = parsed

  const result = await supabaseAdmin.rpc('update_purchase_request', {
    p_pr_id: parsedId,
    p_actor_id: actor.id,
    p_request: { ...request, headName: actor.name ?? request.headName, fiscalYear: thaiFiscalYear(parsed.requestedDate) },
    p_items: items.map(omitNullishProperties),
  })

  const updated = unwrapMutation('แก้ไขใบ PR', result)
  revalidatePurchaseRequest(parsedId)
  return updated
}

/**
 * "ลบ" ในหน้าจอ PR คือการยกเลิกแบบเก็บประวัติไว้ ไม่ลบแถวหรือรายการสินค้า
 * จริง เพื่อให้เลขเอกสารและการตรวจสอบย้อนหลังยังเชื่อถือได้
 */
export async function cancelPurchaseRequest(purchaseRequestId: string) {
  const actor = await requireActor()
  const parsedId = purchaseRequestIdSchema.parse(purchaseRequestId)
  const existing = await getPurchaseRequest(parsedId)
  if (!existing) throw new Error('ไม่พบใบ PR ที่ต้องการลบ')
  assertPurchaseRequestManager(actor, existing.requesterId)

  const result = await supabaseAdmin.rpc('cancel_purchase_request', {
    p_pr_id: parsedId,
    p_actor_id: actor.id,
  })

  const cancelled = unwrapMutation('ลบใบ PR', result)
  revalidatePurchaseRequest(parsedId)
  return cancelled
}

/**
 * `sentToProcurementDate` is required only when confirming a PR whose method
 * opens a new contract (specific_contract/e_bidding) — it becomes that
 * contract's stage-1 (ส่งพัสดุ) date. An ordinary drawdown PR must not send one;
 * the database rejects it either way, but validating here keeps the caller
 * from mistaking a required field for an optional one.
 */
export async function confirmPurchaseRequest(purchaseRequestId: string, sentToProcurementDate?: string | null) {
  const actor = await requireActor()
  assertStockOperator(actor)
  const parsedId = purchaseRequestIdSchema.parse(purchaseRequestId)
  const parsedDate = sentToProcurementDate ? isoDateSchema.parse(sentToProcurementDate) : null

  const result = await supabaseAdmin.rpc('confirm_purchase_request', {
    p_pr_id: parsedId,
    p_actor_id: actor.id,
    p_sent_to_procurement_date: parsedDate,
  })

  const confirmed = unwrapMutation('ยืนยันใบ PR', result)
  revalidatePurchaseRequest(parsedId)
  return confirmed
}

export async function reversePurchaseRequest(
  purchaseRequestId: string,
  input: PurchaseRequestReversalInput,
) {
  const actor = await requireActor()
  assertStockOperator(actor)
  const parsedId = purchaseRequestIdSchema.parse(purchaseRequestId)
  const parsed = purchaseRequestReversalSchema.parse(input)

  const result = await supabaseAdmin.rpc('reverse_purchase_request', {
    p_pr_id: parsedId,
    p_actor_id: actor.id,
    p_reason: parsed.reason,
  })

  const reversed = unwrapMutation('กลับรายการใบ PR', result)
  revalidatePurchaseRequest(parsedId)
  return reversed
}

export async function closePurchaseRequestRemaining(
  purchaseRequestId: string,
  input: PurchaseRequestShortCloseInput,
) {
  const actor = await requireActor()
  assertStockOperator(actor)
  const parsedId = purchaseRequestIdSchema.parse(purchaseRequestId)
  const parsed = purchaseRequestShortCloseSchema.parse(input)

  const result = await supabaseAdmin.rpc('close_purchase_request_remaining', {
    p_pr_id: parsedId,
    p_actor_id: actor.id,
    p_reason: parsed.reason,
  })

  const closed = unwrapMutation('ปิดยอดคงเหลือของใบ PR', result)
  try {
    // The short-close RPC is already committed. Cleanup failure must remain
    // retryable and must never make the caller believe the PR was reopened.
    await cleanupTerminalPurchaseRequestPoFile(parsedId, actor.id, {
      reason: 'closed_short',
      receiptId: null,
    })
  } catch (error) {
    revalidatePurchaseRequest(parsedId)
    const message = error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ'
    throw new Error(`ปิดยอดคงเหลือสำเร็จ แต่ล้างไฟล์ PO ไม่สำเร็จ: ${message}`)
  }
  revalidatePurchaseRequest(parsedId)
  return closed
}

export async function receivePurchaseRequestOutsideStock(purchaseRequestId: string) {
  const actor = await requireActor()
  const parsedId = purchaseRequestIdSchema.parse(purchaseRequestId)
  const existing = await getPurchaseRequest(parsedId)
  if (!existing) throw new Error('ไม่พบใบ PR ที่ต้องการรับของโดยหน่วยงาน')
  assertPurchaseRequestOutsideStockReceiver(actor, existing.requesterId)

  const result = await supabaseAdmin.rpc('mark_purchase_request_received_outside_stock', {
    p_pr_id: parsedId,
    p_actor_id: actor.id,
  })

  const received = unwrapMutation('รับของโดยหน่วยงาน', result)
  try {
    await cleanupTerminalPurchaseRequestPoFile(parsedId, actor.id, {
      reason: 'received',
      receiptId: null,
    })
  } catch (error) {
    revalidatePurchaseRequest(parsedId)
    const message = error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ'
    throw new Error(`รับของโดยหน่วยงานสำเร็จ แต่ล้างไฟล์ PO ไม่สำเร็จ: ${message}`)
  }

  revalidatePurchaseRequest(parsedId)
  return received
}

export async function setPurchaseOrderNumber(
  purchaseRequestId: string,
  input: PurchaseOrderNumberInput,
) {
  const actor = await requireActor()
  assertStockOperator(actor)
  const parsedId = purchaseRequestIdSchema.parse(purchaseRequestId)
  const parsed = purchaseOrderNumberSchema.parse(input)

  const result = await supabaseAdmin.rpc('set_purchase_order_number', {
    p_pr_id: parsedId,
    p_actor_id: actor.id,
    p_po_number: parsed.poNumber,
  })

  const updated = unwrapMutation('บันทึกเลขที่ใบสั่งซื้อ (PO)', result)
  revalidatePurchaseRequest(parsedId)
  return updated
}

export async function setEphisPrNumber(
  purchaseRequestId: string,
  input: EphisPrNumberInput,
) {
  const actor = await requireActor()
  assertStockOperator(actor)
  const parsedId = purchaseRequestIdSchema.parse(purchaseRequestId)
  const parsed = ephisPrNumberSchema.parse(input)

  const result = await supabaseAdmin.rpc('set_ephis_pr_number', {
    p_pr_id: parsedId,
    p_actor_id: actor.id,
    p_ephis_pr_number: parsed.ephisPrNumber,
  })

  const updated = unwrapMutation('บันทึกเลข PR จาก E-Phis', result)
  revalidatePurchaseRequest(parsedId)
  return updated
}
