'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { isAdministrator } from '@/lib/auth/access'
import { requireActor } from '@/lib/auth/actor'
import { assertContractEditor } from '@/lib/contracts/authorization'
import {
  archiveContractInputSchema,
  createContractInputSchema,
  expireContractInputSchema,
  stageAdvanceSchema,
  updateContractInputSchema,
} from '@/lib/contracts/schema'
import type {
  ArchiveContractInput,
  CreateContractInput,
  ExpireContractInput,
  StageAdvanceInput,
  UpdateContractInput,
} from '@/lib/contracts/types'
import { supabaseAdmin } from '@/lib/supabase/admin'

const mutationResultSchema = z.object({ id: z.coerce.number().int().positive() }).passthrough()

async function requireContractEditor() {
  const actor = await requireActor()
  assertContractEditor(actor)
  return actor
}

function unwrapMutation(
  operation: string,
  result: { data: unknown; error: { message: string } | null },
) {
  if (result.error) throw new Error(`${operation}ไม่สำเร็จ: ${result.error.message}`)
  return mutationResultSchema.parse(result.data)
}

export async function createContract(input: CreateContractInput) {
  const actor = await requireContractEditor()
  const parsed = createContractInputSchema.parse(input)
  const { items, sentToProcurementDate, ...contract } = parsed

  const result = await supabaseAdmin.rpc('create_contract', {
    p_actor_id: actor.id,
    p_contract: contract,
    p_items: items,
    p_effective_date: sentToProcurementDate,
  })

  const created = unwrapMutation('สร้างสัญญา', result)
  revalidatePath('/contracts')
  return created
}

export async function updateContract(contractId: number, input: UpdateContractInput) {
  const actor = await requireContractEditor()
  const parsedContractId = z.number().int().positive().parse(contractId)
  const parsed = updateContractInputSchema.parse(input)
  const { items, expectedUpdatedAt, ...contract } = parsed

  const result = await supabaseAdmin.rpc('update_contract', {
    p_contract_id: parsedContractId,
    p_actor_id: actor.id,
    p_contract: contract,
    p_items: items,
    p_expected_updated_at: expectedUpdatedAt,
  })

  const updated = unwrapMutation('บันทึกการแก้ไขสัญญา', result)
  revalidatePath('/contracts')
  revalidatePath(`/contracts/${parsedContractId}`)
  return updated
}

export async function archiveContract(contractId: number, input: ArchiveContractInput) {
  const actor = await requireActor()
  if (!isAdministrator(actor)) throw new Error('ไม่มีสิทธิ์เก็บรายการสัญญา')
  const parsedContractId = z.number().int().positive().parse(contractId)
  const parsed = archiveContractInputSchema.parse(input)

  const result = await supabaseAdmin.rpc('archive_contract', {
    p_contract_id: parsedContractId,
    p_actor_id: actor.id,
    p_reason: parsed.reason,
  })

  const archived = unwrapMutation('เก็บรายการสัญญา', result)
  revalidatePath('/contracts')
  revalidatePath(`/contracts/${parsedContractId}`)
  return archived
}

export async function expireContract(contractId: number, input: ExpireContractInput) {
  const actor = await requireContractEditor()
  const parsedContractId = z.number().int().positive().parse(contractId)
  const parsed = expireContractInputSchema.parse(input)

  const result = await supabaseAdmin.rpc('expire_contract', {
    p_actor_id: actor.id,
    p_contract_id: parsedContractId,
    p_reason: parsed.reason,
  })

  const expired = unwrapMutation('เปลี่ยนสถานะสัญญา', result)
  revalidatePath('/contracts')
  revalidatePath(`/contracts/${parsedContractId}`)
  revalidatePath('/dashboard')
  return expired
}

export async function advanceContractStage(contractId: number, input: StageAdvanceInput) {
  const actor = await requireContractEditor()
  const parsedContractId = z.number().int().positive().parse(contractId)
  const parsed = stageAdvanceSchema.parse(input)

  // `from` is an optimistic client assertion only. The locked database row in
  // advance_contract_stage remains the source of truth for the transition.
  const result = await supabaseAdmin.rpc('advance_contract_stage', {
    p_contract_id: parsedContractId,
    p_actor_id: actor.id,
    p_to_stage: parsed.to,
    p_effective_date: parsed.effectiveDate,
    p_contract_number: parsed.contractNumber ?? null,
    p_note: parsed.note ?? null,
  })

  const advanced = unwrapMutation('เปลี่ยนขั้นตอนสัญญา', result)
  revalidatePath('/contracts')
  revalidatePath(`/contracts/${parsedContractId}`)
  return advanced
}
