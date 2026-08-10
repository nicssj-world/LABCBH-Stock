'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireActor } from '@/lib/auth/actor'
import { assertStockOperator } from '@/lib/inventory/authorization'
import { assertPurchaseRequester } from '@/lib/pr/authorization'
import {
  ephisPrNumberSchema,
  purchaseOrderNumberSchema,
  purchaseRequestInputSchema,
  purchaseRequestReversalSchema,
} from '@/lib/pr/schema'
import { isoDateSchema } from '@/lib/validation/date'
import type {
  EphisPrNumberInput,
  PurchaseOrderNumberInput,
  PurchaseRequestInput,
  PurchaseRequestReversalInput,
} from '@/lib/pr/types'
import { supabaseAdmin } from '@/lib/supabase/admin'

const purchaseRequestIdSchema = z.string().uuid()

function unwrapMutation(
  operation: string,
  result: { data: unknown; error: { message: string } | null },
) {
  if (result.error) throw new Error(`${operation}ไม่สำเร็จ: ${result.error.message}`)
  return z.object({ id: z.string().uuid() }).passthrough().parse(result.data)
}

function revalidatePurchaseRequest(id?: string) {
  revalidatePath('/purchase-requests')
  if (id) revalidatePath(`/purchase-requests/${id}`)
  revalidatePath('/dashboard')
  revalidatePath('/contracts')
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
    p_items: items,
  })

  const created = unwrapMutation('สร้างใบ PR', result)
  revalidatePurchaseRequest()
  return created
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

  const updated = unwrapMutation('บันทึกเลขที่ใบสั่งซื้อ', result)
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
