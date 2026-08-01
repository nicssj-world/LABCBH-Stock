import 'server-only'

import { z } from 'zod'
import { budgetSnapshot, type BudgetSnapshot } from '@/lib/contracts/budget'
import { supabaseAdmin } from '@/lib/supabase/admin'

const amountSchema = z
  .union([z.number(), z.string()])
  .transform(Number)
  .refine(Number.isFinite)

const expenseRowSchema = z.object({
  id: z.union([z.number(), z.string()]).transform(Number),
  amount: amountSchema,
  note: z.string().nullable(),
  recorded_by: z.string().nullable(),
  usage_date: z.string().nullable(),
  usage_month: z.string().nullable(),
  created_at: z.string(),
})

export interface ContractExpenseRecord {
  id: number
  amount: number
  note: string | null
  recordedBy: string | null
  usageDate: string | null
  usageMonth: string | null
  createdAt: string
}

export interface ContractBudget {
  entries: ContractExpenseRecord[]
  snapshot: BudgetSnapshot
}

export async function fetchContractBudget(
  contractId: number,
  total: number | null,
): Promise<ContractBudget> {
  const { data, error } = await supabaseAdmin
    .from('contract_usage')
    .select('id,amount,note,recorded_by,usage_date,usage_month,created_at')
    .eq('contract_id', contractId)
    .order('usage_month', { ascending: false, nullsFirst: false })
    .order('usage_date', { ascending: false, nullsFirst: false })

  if (error) throw new Error(`โหลดค่าใช้จ่ายไม่สำเร็จ: ${error.message}`)

  const entries: ContractExpenseRecord[] = (data ?? []).map((row) => {
    const parsed = expenseRowSchema.parse(row)
    return {
      id: parsed.id,
      amount: parsed.amount,
      note: parsed.note,
      recordedBy: parsed.recorded_by,
      usageDate: parsed.usage_date,
      usageMonth: parsed.usage_month,
      createdAt: parsed.created_at,
    }
  })

  return { entries, snapshot: budgetSnapshot({ total, entries }) }
}
