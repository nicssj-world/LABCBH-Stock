import 'server-only'

import { z } from 'zod'
import { contractRemainingPercent, contractSupplyBalance } from '@/lib/contracts/budget'
import { CONTRACT_DEPARTMENTS, CONTRACT_TYPES } from '@/lib/contracts/schema'
import { PROCUREMENT_STAGES } from '@/lib/contracts/stages'
import type { ContractRecord } from '@/lib/contracts/types'
import { createClient } from '@/lib/supabase/server'

const numericSchema = z
  .union([z.number(), z.string()])
  .transform(Number)
  .refine(Number.isFinite)

const contractItemReadRowSchema = z.object({
  id: z.string().uuid(),
  line_number: z.number().int().positive(),
  ls_code: z.string(),
  name: z.string(),
  quantity: numericSchema,
  unit: z.string(),
  unit_price: numericSchema,
  line_total: numericSchema,
  contract_item_allocations: z.array(z.object({ quantity: numericSchema })).nullable().default([]),
})

const contractUsageReadRowSchema = z.object({ amount: numericSchema })

const contractStageHistoryReadRowSchema = z.object({
  id: z.string().uuid(),
  from_stage: z.enum(PROCUREMENT_STAGES).nullable(),
  to_stage: z.enum(PROCUREMENT_STAGES),
  effective_date: z.string(),
  contract_number_snapshot: z.string().nullable(),
  note: z.string().nullable(),
  source: z.string(),
  actor_id: z.string().uuid().nullable(),
  created_at: z.string(),
})

const contractStageHistoryCorrectionReadRowSchema = z.object({
  history_id: z.string().uuid(),
  effective_date: z.string(),
  reason: z.string(),
  created_at: z.string(),
})

export const contractReadRowSchema = z.object({
  id: numericSchema.pipe(z.number().int().positive()),
  product: z.string(),
  fiscal_year: z.number().int().nullable(),
  contract_type: z.enum(CONTRACT_TYPES).nullable(),
  department: z.enum(CONTRACT_DEPARTMENTS).nullable(),
  procurement_stage: z.enum(PROCUREMENT_STAGES).nullable(),
  status: z.enum(['active', 'expired', 'cancelled', 'pending']).nullable(),
  display_name: z.string().nullable(),
  contract_number: z.string().nullable(),
  vendor: z.string().nullable(),
  start_date: z.string().nullable(),
  end_date: z.string().nullable(),
  updated_at: z.string().nullable(),
  is_archived: z.boolean().nullable(),
  total: numericSchema.nullable(),
  responsible_user_ids: z.array(z.string().uuid()).nullable().default([]),
  file_url: z.string().nullable(),
  contract_items: z.array(contractItemReadRowSchema).nullable().default([]),
  contract_usage: z.array(contractUsageReadRowSchema).nullable().default([]),
  contract_stage_history: z.array(contractStageHistoryReadRowSchema).nullable().default([]),
})

const CONTRACT_READ_SELECT = `
  id,
  product,
  fiscal_year,
  contract_type,
  department,
  procurement_stage,
  status,
  display_name,
  contract_number,
  vendor,
  start_date,
  end_date,
  updated_at,
  is_archived,
  total,
  responsible_user_ids,
  file_url,
  contract_items (
    id,
    line_number,
    ls_code,
    name,
    quantity,
    unit,
    unit_price,
    line_total,
    contract_item_allocations (quantity)
  ),
  contract_usage (amount),
  contract_stage_history (
    id,
    from_stage,
    to_stage,
    effective_date,
    contract_number_snapshot,
    note,
    source,
    actor_id,
    created_at
  )
`

export interface ContractFilters {
  fiscalYear?: number
  contractType?: (typeof CONTRACT_TYPES)[number]
  department?: (typeof CONTRACT_DEPARTMENTS)[number]
  procurementStage?: (typeof PROCUREMENT_STAGES)[number]
  search?: string
}

function mapContractRow(
  row: z.infer<typeof contractReadRowSchema>,
  correctionsByHistoryId = new Map<string, z.infer<typeof contractStageHistoryCorrectionReadRowSchema>[]>(),
): ContractRecord {
  const contractItems = [...(row.contract_items ?? [])]
    .sort((left, right) => left.line_number - right.line_number)
  const supplyBalance = contractSupplyBalance(contractItems.map((item) => ({
    quantity: item.quantity,
    unitPrice: item.unit_price,
    allocations: item.contract_item_allocations ?? [],
  })))

  return {
    id: row.id,
    product: row.product,
    fiscalYear: row.fiscal_year,
    contractType: row.contract_type,
    department: row.department,
    procurementStage: row.procurement_stage,
    status: row.status,
    displayName: row.display_name,
    contractNumber: row.contract_number,
    vendor: row.vendor,
    startDate: row.start_date,
    endDate: row.end_date,
    updatedAt: row.updated_at,
    isArchived: row.is_archived,
    total: row.total,
    remainingPercent: contractRemainingPercent({
      contractType: row.contract_type,
      total: row.total,
      usage: row.contract_usage ?? [],
      items: (row.contract_items ?? []).map((item) => ({
        quantity: item.quantity,
        unitPrice: item.unit_price,
        allocations: item.contract_item_allocations ?? [],
      })),
    }),
    responsibleUserIds: row.responsible_user_ids ?? [],
    fileUrl: row.file_url,
    items: contractItems.map((item, index) => {
      const balance = supplyBalance.items[index]
      return {
        id: item.id,
        lineNumber: item.line_number,
        lsCode: item.ls_code,
        name: item.name,
        quantity: item.quantity,
        unit: item.unit,
        unitPrice: item.unit_price,
        lineTotal: item.line_total,
        allocatedQuantity: balance.allocatedQuantity,
        remainingQuantity: balance.remainingQuantity,
        remainingValue: balance.remainingValue,
        remainingPercent: balance.remainingPercent,
      }
    }),
    stageHistory: (row.contract_stage_history ?? [])
      .sort((left, right) => left.effective_date.localeCompare(right.effective_date))
      .map((history) => {
        const correction = [...(correctionsByHistoryId.get(history.id) ?? [])]
          .sort((left, right) => right.created_at.localeCompare(left.created_at))[0]
        return {
          id: history.id,
          fromStage: history.from_stage,
          toStage: history.to_stage,
          effectiveDate: correction?.effective_date ?? history.effective_date,
          contractNumberSnapshot: history.contract_number_snapshot,
          note: history.note,
          source: history.source,
          actorId: history.actor_id,
          createdAt: history.created_at,
          correctedAt: correction?.created_at ?? null,
          correctionReason: correction?.reason ?? null,
        }
      }),
  }
}

function isMissingCorrectionSchema(error: { code?: string | null }): boolean {
  return error.code === '42P01' || error.code === 'PGRST205'
}

async function listStageHistoryCorrections(
  historyIds: string[],
  supabase: Awaited<ReturnType<typeof createClient>>,
) {
  if (historyIds.length === 0) return new Map<string, z.infer<typeof contractStageHistoryCorrectionReadRowSchema>[]>()

  const { data, error } = await supabase
    .from('contract_stage_history_corrections')
    .select('history_id, effective_date, reason, created_at')
    .in('history_id', historyIds)

  if (error) {
    if (isMissingCorrectionSchema(error)) return new Map<string, z.infer<typeof contractStageHistoryCorrectionReadRowSchema>[]>()
    throw new Error(`อ่านประวัติการแก้ไขขั้นตอนสัญญาไม่สำเร็จ: ${error.message}`)
  }

  return contractStageHistoryCorrectionReadRowSchema.array().parse(data ?? []).reduce((grouped, correction) => {
    const current = grouped.get(correction.history_id) ?? []
    current.push(correction)
    grouped.set(correction.history_id, current)
    return grouped
  }, new Map<string, z.infer<typeof contractStageHistoryCorrectionReadRowSchema>[]>())
}

export async function listContracts(filters: ContractFilters = {}): Promise<ContractRecord[]> {
  const supabase = await createClient()
  let query = supabase
    .from('contracts')
    .select(CONTRACT_READ_SELECT)
    .or('is_archived.eq.false,is_archived.is.null')
    .order('fiscal_year', { ascending: false, nullsFirst: false })
    .order('id', { ascending: false })

  if (filters.fiscalYear) query = query.eq('fiscal_year', filters.fiscalYear)
  if (filters.contractType) query = query.eq('contract_type', filters.contractType)
  if (filters.department) query = query.eq('department', filters.department)
  if (filters.procurementStage) query = query.eq('procurement_stage', filters.procurementStage)

  const search = filters.search?.trim().replace(/[,%()]/g, ' ')
  if (search) {
    query = query.or(
      `display_name.ilike.%${search}%,product.ilike.%${search}%,contract_number.ilike.%${search}%,vendor.ilike.%${search}%`,
    )
  }

  const { data, error } = await query
  if (error) throw new Error(`อ่านรายการสัญญาไม่สำเร็จ: ${error.message}`)

  return contractReadRowSchema.array().parse(data ?? []).map((row) => mapContractRow(row))
}

export async function getContract(
  contractId: number,
  options: { includeArchived?: boolean } = {},
): Promise<ContractRecord | null> {
  const supabase = await createClient()
  let query = supabase
    .from('contracts')
    .select(CONTRACT_READ_SELECT)
    .eq('id', contractId)

  if (!options.includeArchived) {
    query = query.or('is_archived.eq.false,is_archived.is.null')
  }

  const { data, error } = await query.maybeSingle()
  if (error) throw new Error(`อ่านข้อมูลสัญญาไม่สำเร็จ: ${error.message}`)
  if (!data) return null

  const row = contractReadRowSchema.parse(data)
  const corrections = await listStageHistoryCorrections(
    (row.contract_stage_history ?? []).map((history) => history.id),
    supabase,
  )
  return mapContractRow(row, corrections)
}
