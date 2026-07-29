import 'server-only'

import { z } from 'zod'
import { CONTRACT_TYPES } from '@/lib/contracts/schema'
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
})

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

export const contractReadRowSchema = z.object({
  id: numericSchema.pipe(z.number().int().positive()),
  product: z.string(),
  fiscal_year: z.number().int().nullable(),
  contract_type: z.enum(CONTRACT_TYPES).nullable(),
  procurement_stage: z.enum(PROCUREMENT_STAGES).nullable(),
  status: z.enum(['active', 'expired', 'cancelled', 'pending']).nullable(),
  display_name: z.string().nullable(),
  contract_number: z.string().nullable(),
  vendor: z.string().nullable(),
  start_date: z.string().nullable(),
  end_date: z.string().nullable(),
  updated_at: z.string().nullable(),
  is_archived: z.boolean().nullable(),
  contract_items: z.array(contractItemReadRowSchema).nullable().default([]),
  contract_stage_history: z.array(contractStageHistoryReadRowSchema).nullable().default([]),
})

const CONTRACT_READ_SELECT = `
  id,
  product,
  fiscal_year,
  contract_type,
  procurement_stage,
  status,
  display_name,
  contract_number,
  vendor,
  start_date,
  end_date,
  updated_at,
  is_archived,
  contract_items (
    id,
    line_number,
    ls_code,
    name,
    quantity,
    unit,
    unit_price,
    line_total
  ),
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
  procurementStage?: (typeof PROCUREMENT_STAGES)[number]
  search?: string
}

function mapContractRow(row: z.infer<typeof contractReadRowSchema>): ContractRecord {
  return {
    id: row.id,
    product: row.product,
    fiscalYear: row.fiscal_year,
    contractType: row.contract_type,
    procurementStage: row.procurement_stage,
    status: row.status,
    displayName: row.display_name,
    contractNumber: row.contract_number,
    vendor: row.vendor,
    startDate: row.start_date,
    endDate: row.end_date,
    updatedAt: row.updated_at,
    isArchived: row.is_archived,
    items: (row.contract_items ?? [])
      .sort((left, right) => left.line_number - right.line_number)
      .map((item) => ({
        id: item.id,
        lineNumber: item.line_number,
        lsCode: item.ls_code,
        name: item.name,
        quantity: item.quantity,
        unit: item.unit,
        unitPrice: item.unit_price,
        lineTotal: item.line_total,
      })),
    stageHistory: (row.contract_stage_history ?? [])
      .sort((left, right) => left.effective_date.localeCompare(right.effective_date))
      .map((history) => ({
        id: history.id,
        fromStage: history.from_stage,
        toStage: history.to_stage,
        effectiveDate: history.effective_date,
        contractNumberSnapshot: history.contract_number_snapshot,
        note: history.note,
        source: history.source,
        actorId: history.actor_id,
        createdAt: history.created_at,
      })),
  }
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
  if (filters.procurementStage) query = query.eq('procurement_stage', filters.procurementStage)

  const search = filters.search?.trim().replace(/[,%()]/g, ' ')
  if (search) {
    query = query.or(`display_name.ilike.%${search}%,product.ilike.%${search}%`)
  }

  const { data, error } = await query
  if (error) throw new Error(`อ่านรายการสัญญาไม่สำเร็จ: ${error.message}`)

  return contractReadRowSchema.array().parse(data ?? []).map(mapContractRow)
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

  return mapContractRow(contractReadRowSchema.parse(data))
}
