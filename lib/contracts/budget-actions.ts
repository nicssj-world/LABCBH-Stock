'use server'

import { revalidatePath } from 'next/cache'
import { isAdministrator } from '@/lib/auth/access'
import { requireActor } from '@/lib/auth/actor'
import {
  contractExpenseInputSchema,
  responsibleUsersInputSchema,
} from '@/lib/contracts/schema'
import type { ContractExpenseInput, ResponsibleUsersInput } from '@/lib/contracts/types'
import { supabaseAdmin } from '@/lib/supabase/admin'

function unwrap(operation: string, result: { error: { message: string } | null }) {
  if (result.error) throw new Error(`${operation}ไม่สำเร็จ: ${result.error.message}`)
}

function revalidateContract(contractId: number) {
  revalidatePath(`/contracts/${contractId}`)
  revalidatePath('/contracts')
  revalidatePath('/dashboard')
}

/**
 * Authorisation deliberately lives in the RPC rather than here. It is the only
 * place that can read the contract's responsible users in the same transaction
 * as the write, and the same lock that enforces the budget ceiling.
 */
export async function recordContractExpense(input: ContractExpenseInput) {
  const actor = await requireActor()
  const parsed = contractExpenseInputSchema.parse(input)

  const result = await supabaseAdmin.rpc('record_contract_expense', {
    p_actor_id: actor.id,
    p_contract_id: parsed.contractId,
    p_amount: parsed.amount,
    p_usage_month: parsed.usageMonth,
    p_usage_date: parsed.usageDate ?? null,
    p_note: parsed.note ?? null,
  })
  unwrap('บันทึกค่าใช้จ่าย', result)

  revalidateContract(parsed.contractId)
}

export async function deleteContractExpense(contractId: number, usageId: number) {
  const actor = await requireActor()

  const result = await supabaseAdmin.rpc('delete_contract_expense', {
    p_actor_id: actor.id,
    p_usage_id: usageId,
  })
  unwrap('ลบค่าใช้จ่าย', result)

  revalidateContract(contractId)
}

export async function setResponsibleUsers(input: ResponsibleUsersInput) {
  const actor = await requireActor()
  if (!isAdministrator(actor)) throw new Error('ไม่มีสิทธิ์กำหนดผู้รับผิดชอบสัญญา')
  const parsed = responsibleUsersInputSchema.parse(input)

  const result = await supabaseAdmin.rpc('set_contract_responsible_users', {
    p_actor_id: actor.id,
    p_contract_id: parsed.contractId,
    p_profile_ids: parsed.profileIds,
    p_note: parsed.note ?? null,
  })
  unwrap('บันทึกผู้รับผิดชอบ', result)

  revalidateContract(parsed.contractId)
}
