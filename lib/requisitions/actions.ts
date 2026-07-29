'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireActor } from '@/lib/auth/actor'
import { assertStockOperator } from '@/lib/inventory/authorization'
import { assertPurchaseRequester } from '@/lib/pr/authorization'
import { fulfillRequisitionInputSchema, requisitionInputSchema } from '@/lib/requisitions/schema'
import type { FulfillRequisitionInput, RequisitionInput } from '@/lib/requisitions/types'
import { supabaseAdmin } from '@/lib/supabase/admin'

const requisitionIdSchema = z.string().uuid()

function unwrapMutation(
  operation: string,
  result: { data: unknown; error: { message: string } | null },
) {
  if (result.error) throw new Error(`${operation}ไม่สำเร็จ: ${result.error.message}`)
  return z.object({ id: z.string().uuid() }).passthrough().parse(result.data)
}

function revalidateRequisition(id?: string) {
  revalidatePath('/requisitions')
  if (id) revalidatePath(`/requisitions/${id}`)
  revalidatePath('/inventory')
  revalidatePath('/dashboard')
}

export async function createRequisition(input: RequisitionInput) {
  const actor = await requireActor()
  assertPurchaseRequester(actor)
  const parsed = requisitionInputSchema.parse(input)
  const { items, ...requisition } = parsed

  const result = await supabaseAdmin.rpc('create_requisition', {
    p_actor_id: actor.id,
    p_requisition: requisition,
    p_items: items,
  })

  const created = unwrapMutation('สร้างใบเบิก', result)
  revalidateRequisition()
  return created
}

export async function fulfillRequisition(
  requisitionId: string,
  input: FulfillRequisitionInput,
) {
  const actor = await requireActor()
  assertStockOperator(actor)
  const parsedId = requisitionIdSchema.parse(requisitionId)
  const parsed = fulfillRequisitionInputSchema.parse(input)

  // The RPC locks the requisition and every chosen lot, refuses expired lots
  // and short issues, and is the only place stock actually moves.
  const result = await supabaseAdmin.rpc('fulfill_requisition', {
    p_requisition_id: parsedId,
    p_actor_id: actor.id,
    p_allocations: parsed.allocations,
  })

  const fulfilled = unwrapMutation('จ่ายของตามใบเบิก', result)
  revalidateRequisition(parsedId)
  return fulfilled
}
