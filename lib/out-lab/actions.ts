'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { isAdministrator } from '@/lib/auth/access'
import { requireActor } from '@/lib/auth/actor'
import { assertOutLabCreator, assertOutLabEditor } from '@/lib/out-lab/authorization'
import {
  outLabArchiveInputSchema,
  outLabCreateInputSchema,
  outLabExpireInputSchema,
  outLabResponsibleUsersInputSchema,
  outLabStageAdvanceSchema,
  outLabUpdateInputSchema,
  outLabUsageInputSchema,
} from '@/lib/out-lab/schema'
import type {
  OutLabArchiveInput,
  OutLabCreateInput,
  OutLabExpireInput,
  OutLabResponsibleUsersInput,
  OutLabStageAdvanceInput,
  OutLabUpdateInput,
  OutLabUsageInput,
} from '@/lib/out-lab/types'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { omitNullishProperties } from '@/lib/validation/json'

const contractIdSchema = z.string().uuid()
const mutationResultSchema = z.object({ id: z.string().uuid() }).passthrough()

async function requireOutLabEditor() {
  const actor = await requireActor()
  assertOutLabEditor(actor)
  return actor
}

async function requireOutLabCreator() {
  const actor = await requireActor()
  assertOutLabCreator(actor)
  return actor
}

function unwrapMutation(
  operation: string,
  result: { data: unknown; error: { message: string } | null },
) {
  if (result.error) throw new Error(`${operation}ไม่สำเร็จ: ${result.error.message}`)
  return mutationResultSchema.parse(result.data)
}

function unwrap(operation: string, result: { error: { message: string } | null }) {
  if (result.error) throw new Error(`${operation}ไม่สำเร็จ: ${result.error.message}`)
}

function revalidateContract(contractId: string) {
  revalidatePath(`/out-lab/${contractId}`)
  revalidatePath('/out-lab')
}

export async function createOutLabContract(input: OutLabCreateInput) {
  const actor = await requireOutLabCreator()
  const parsed = outLabCreateInputSchema.parse(input)
  const { contractNumber, effectiveDate, ...contract } = parsed

  // Registering a contract that has already started skips the stage history
  // this system would otherwise have witnessed, so it is narrower than the
  // admin-or-head editor check above. The RPC re-checks it.
  if (contractNumber && !isAdministrator(actor)) {
    throw new Error('เฉพาะผู้ดูแลระบบเท่านั้นที่สามารถเพิ่มสัญญาที่เริ่มใช้งานแล้วได้')
  }

  // An untouched optional field must reach the RPC as an omitted key, not as
  // JSON null: create_out_lab_contract rejects startDate/endDate on an annual
  // plan by key presence, and a null would trip that guard.
  const result = await supabaseAdmin.rpc('create_out_lab_contract', {
    p_actor_id: actor.id,
    p_contract: omitNullishProperties(contract),
    p_effective_date: effectiveDate ?? null,
    p_contract_number: contractNumber ?? null,
  })

  const created = unwrapMutation('สร้างสัญญา Out Lab', result)
  revalidatePath('/out-lab')
  return created
}

export async function updateOutLabContract(contractId: string, input: OutLabUpdateInput) {
  const actor = await requireOutLabEditor()
  const parsedContractId = contractIdSchema.parse(contractId)
  const parsed = outLabUpdateInputSchema.parse(input)
  const { expectedUpdatedAt, ...contract } = parsed

  const result = await supabaseAdmin.rpc('update_out_lab_contract', {
    p_actor_id: actor.id,
    p_contract_id: parsedContractId,
    p_contract: omitNullishProperties(contract),
    p_expected_updated_at: expectedUpdatedAt,
  })

  const updated = unwrapMutation('บันทึกการแก้ไขสัญญา', result)
  revalidateContract(parsedContractId)
  return updated
}

export async function advanceOutLabContractStage(
  contractId: string,
  input: OutLabStageAdvanceInput,
) {
  const actor = await requireOutLabEditor()
  const parsedContractId = contractIdSchema.parse(contractId)
  const parsed = outLabStageAdvanceSchema.parse(input)

  const result = await supabaseAdmin.rpc('advance_out_lab_contract_stage', {
    p_actor_id: actor.id,
    p_contract_id: parsedContractId,
    p_to_stage: parsed.to,
    p_effective_date: parsed.effectiveDate,
    p_contract_number: parsed.contractNumber ?? null,
    p_note: parsed.note ?? null,
  })

  unwrap('เปลี่ยนขั้นตอนสัญญา', result)
  revalidateContract(parsedContractId)
}

/**
 * Authorisation deliberately lives in the RPC rather than here. It is the only
 * place that can read the contract's responsible users in the same transaction
 * as the write, holding the same lock that enforces the ceiling.
 *
 * This is an upsert: the month is the key, so re-submitting a month replaces
 * its figure rather than adding a second row.
 */
export async function recordOutLabMonthlyUsage(input: OutLabUsageInput) {
  const actor = await requireActor()
  const parsed = outLabUsageInputSchema.parse(input)

  const result = await supabaseAdmin.rpc('record_out_lab_monthly_usage', {
    p_actor_id: actor.id,
    p_contract_id: parsed.contractId,
    p_amount: parsed.amount,
    p_usage_month: parsed.usageMonth,
    p_note: parsed.note ?? null,
  })

  unwrap('บันทึกยอดใช้จ่าย', result)
  revalidateContract(parsed.contractId)
}

export async function deleteOutLabMonthlyUsage(contractId: string, usageId: string) {
  const actor = await requireActor()
  const parsedContractId = contractIdSchema.parse(contractId)

  const result = await supabaseAdmin.rpc('delete_out_lab_monthly_usage', {
    p_actor_id: actor.id,
    p_usage_id: z.string().uuid().parse(usageId),
  })

  unwrap('ลบยอดใช้จ่าย', result)
  revalidateContract(parsedContractId)
}

export async function setOutLabResponsibleUsers(input: OutLabResponsibleUsersInput) {
  const actor = await requireActor()
  if (!isAdministrator(actor)) throw new Error('ไม่มีสิทธิ์กำหนดผู้รับผิดชอบสัญญา')
  const parsed = outLabResponsibleUsersInputSchema.parse(input)

  const result = await supabaseAdmin.rpc('set_out_lab_responsible_users', {
    p_actor_id: actor.id,
    p_contract_id: parsed.contractId,
    p_profile_ids: parsed.profileIds,
    p_note: parsed.note ?? null,
  })

  unwrap('บันทึกผู้รับผิดชอบ', result)
  revalidateContract(parsed.contractId)
}

export async function archiveOutLabContract(contractId: string, input: OutLabArchiveInput) {
  const actor = await requireActor()
  if (!isAdministrator(actor)) throw new Error('ไม่มีสิทธิ์เก็บสัญญาเข้าคลัง')
  const parsedContractId = contractIdSchema.parse(contractId)
  const parsed = outLabArchiveInputSchema.parse(input)

  const result = await supabaseAdmin.rpc('archive_out_lab_contract', {
    p_actor_id: actor.id,
    p_contract_id: parsedContractId,
    p_reason: parsed.reason,
  })

  unwrap('เก็บสัญญาเข้าคลัง', result)
  revalidateContract(parsedContractId)
}

export async function restoreOutLabContract(contractId: string) {
  const actor = await requireActor()
  if (!isAdministrator(actor)) throw new Error('ไม่มีสิทธิ์กู้คืนสัญญา')
  const parsedContractId = contractIdSchema.parse(contractId)

  const result = await supabaseAdmin.rpc('restore_out_lab_contract', {
    p_actor_id: actor.id,
    p_contract_id: parsedContractId,
  })

  unwrap('กู้คืนสัญญา', result)
  revalidateContract(parsedContractId)
}

export async function expireOutLabContract(contractId: string, input: OutLabExpireInput) {
  const actor = await requireActor()
  if (!isAdministrator(actor)) throw new Error('ไม่มีสิทธิ์สิ้นสุดสัญญา')
  const parsedContractId = contractIdSchema.parse(contractId)
  const parsed = outLabExpireInputSchema.parse(input)

  const result = await supabaseAdmin.rpc('expire_out_lab_contract', {
    p_actor_id: actor.id,
    p_contract_id: parsedContractId,
    p_reason: parsed.reason,
  })

  unwrap('สิ้นสุดสัญญา', result)
  revalidateContract(parsedContractId)
}
