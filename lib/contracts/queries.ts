import 'server-only'

import { z } from 'zod'
import { contractRemainingPercent, contractSupplyBalance } from '@/lib/contracts/budget'
import { CONTRACT_DEPARTMENTS, CONTRACT_TYPES } from '@/lib/contracts/schema'
import { PROCUREMENT_STAGES } from '@/lib/contracts/stages'
import type { ContractOpeningBalanceHistoryEntry, ContractRecord } from '@/lib/contracts/types'
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
  contract_item_allocations: z.array(z.object({ quantity: numericSchema, allocation_kind: z.string() })).nullable().default([]),
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
  archived_at: z.string().nullable(),
  archive_reason: z.string().nullable(),
  total: numericSchema.nullable(),
  responsible_user_ids: z.array(z.string().uuid()).nullable().default([]),
  file_url: z.string().nullable(),
  contract_items: z.array(contractItemReadRowSchema).nullable().default([]),
  contract_usage: z.array(contractUsageReadRowSchema).nullable().default([]),
  contract_stage_history: z.array(contractStageHistoryReadRowSchema).nullable().default([]),
})

const CONTRACT_SCALAR_READ_SELECT = `
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
  archived_at,
  archive_reason,
  total,
  responsible_user_ids,
  file_url`

const CONTRACT_ITEMS_READ_SELECT = `
  contract_items (
    id,
    line_number,
    ls_code,
    name,
    quantity,
    unit,
    unit_price,
    line_total,
    contract_item_allocations (quantity, allocation_kind)
  )`

const CONTRACT_USAGE_READ_SELECT = `
  contract_usage (amount)`

const CONTRACT_STAGE_HISTORY_READ_SELECT = `
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
  )`

// The register only needs balances and summary fields. Stage history is kept
// for the detail view, where it is actually rendered.
const CONTRACT_LIST_READ_SELECT = `
  ${CONTRACT_SCALAR_READ_SELECT},
  ${CONTRACT_ITEMS_READ_SELECT},
  ${CONTRACT_USAGE_READ_SELECT}
`

const CONTRACT_READ_SELECT = `
  ${CONTRACT_SCALAR_READ_SELECT},
  ${CONTRACT_ITEMS_READ_SELECT},
  ${CONTRACT_USAGE_READ_SELECT},
  ${CONTRACT_STAGE_HISTORY_READ_SELECT}
`

const CONTRACT_FORM_OPTION_READ_SELECT = `
  id,
  product,
  contract_type,
  department,
  procurement_stage,
  status,
  display_name,
  contract_number,
  end_date
`

const contractFormOptionReadRowSchema = z.object({
  id: numericSchema.pipe(z.number().int().positive()),
  product: z.string(),
  contract_type: z.enum(CONTRACT_TYPES).nullable(),
  department: z.enum(CONTRACT_DEPARTMENTS).nullable(),
  procurement_stage: z.enum(PROCUREMENT_STAGES).nullable(),
  status: z.enum(['active', 'expired', 'cancelled', 'pending']).nullable(),
  display_name: z.string().nullable(),
  contract_number: z.string().nullable(),
  end_date: z.string().nullable(),
})

export interface ContractFilters {
  fiscalYear?: number
  contractType?: (typeof CONTRACT_TYPES)[number]
  department?: (typeof CONTRACT_DEPARTMENTS)[number]
  procurementStage?: (typeof PROCUREMENT_STAGES)[number]
  search?: string
  includeArchived?: boolean
}

export interface ContractFormOption {
  id: number
  product: string
  contractType: (typeof CONTRACT_TYPES)[number] | null
  department: (typeof CONTRACT_DEPARTMENTS)[number] | null
  procurementStage: (typeof PROCUREMENT_STAGES)[number] | null
  status: 'active' | 'expired' | 'cancelled' | 'pending' | null
  displayName: string | null
  contractNumber: string | null
  endDate: string | null
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
    allocations: (item.contract_item_allocations ?? []).map((allocation) => ({
      quantity: allocation.quantity,
      allocationKind: allocation.allocation_kind,
    })),
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
    archivedAt: row.archived_at,
    archiveReason: row.archive_reason,
    total: row.total,
    remainingPercent: contractRemainingPercent({
      contractType: row.contract_type,
      total: row.total,
      usage: row.contract_usage ?? [],
      items: (row.contract_items ?? []).map((item) => ({
        quantity: item.quantity,
        unitPrice: item.unit_price,
        allocations: (item.contract_item_allocations ?? []).map((allocation) => ({
          quantity: allocation.quantity,
          allocationKind: allocation.allocation_kind,
        })),
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
        openingUsedQuantity: balance.openingUsedQuantity,
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
    .select(CONTRACT_LIST_READ_SELECT)
    .order('fiscal_year', { ascending: false, nullsFirst: false })
    .order('id', { ascending: false })

  // The archived toggle is a separate view, not an additional filter: an
  // admin looking to restore a mistakenly archived contract needs exactly
  // those rows, not the normal register with a few extras mixed in.
  query = filters.includeArchived
    ? query.eq('is_archived', true)
    : query.or('is_archived.eq.false,is_archived.is.null')

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

/**
 * The PR form only needs contract identity and lifecycle fields. Do not load
 * every contract's line items and usage ledger just to populate its selectors.
 */
export async function listContractFormOptions(): Promise<ContractFormOption[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('contracts')
    .select(CONTRACT_FORM_OPTION_READ_SELECT)
    .or('is_archived.eq.false,is_archived.is.null')
    .order('fiscal_year', { ascending: false, nullsFirst: false })
    .order('id', { ascending: false })

  if (error) throw new Error(`อ่านรายการสัญญาสำหรับใบ PR ไม่สำเร็จ: ${error.message}`)

  return contractFormOptionReadRowSchema.array().parse(data ?? []).map((row) => ({
    id: row.id,
    product: row.product,
    contractType: row.contract_type,
    department: row.department,
    procurementStage: row.procurement_stage,
    status: row.status,
    displayName: row.display_name,
    contractNumber: row.contract_number,
    endDate: row.end_date,
  }))
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

const openingBalanceMetadataSchema = z.object({
  effective_date: z.string().nullable().optional(),
  previous_quantity: z.number().optional(),
  target_quantity: z.number().optional(),
}).passthrough()

const openingBalanceAllocationRowSchema = z.object({
  quantity: numericSchema,
  allocation_kind: z.string(),
  note: z.string().nullable(),
  created_at: z.string(),
  source_metadata: openingBalanceMetadataSchema.nullable().default({}),
})

const openingBalanceItemRowSchema = z.object({
  ls_code: z.string(),
  name: z.string(),
  contract_item_allocations: z.array(openingBalanceAllocationRowSchema).nullable().default([]),
})

/**
 * Every call to set_contract_opening_balances (plus create_contract's fast
 * path) grouped back into one entry per call: every delta row it inserts
 * shares the same transaction timestamp, which is the only linking key the
 * ledger carries — there is no batch id.
 */
export async function listContractOpeningBalanceHistory(
  contractId: number,
): Promise<ContractOpeningBalanceHistoryEntry[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('contract_items')
    .select('ls_code, name, contract_item_allocations (quantity, allocation_kind, note, created_at, source_metadata)')
    .eq('contract_id', contractId)

  if (error) throw new Error(`อ่านประวัติยอดใช้ก่อนเข้าระบบไม่สำเร็จ: ${error.message}`)

  const rows = openingBalanceItemRowSchema.array().parse(data ?? [])
  const grouped = new Map<string, ContractOpeningBalanceHistoryEntry>()

  for (const item of rows) {
    for (const allocation of item.contract_item_allocations ?? []) {
      if (allocation.allocation_kind !== 'opening_balance') continue
      const entry = grouped.get(allocation.created_at) ?? {
        createdAt: allocation.created_at,
        effectiveDate: allocation.source_metadata?.effective_date ?? null,
        note: allocation.note ?? '',
        lines: [],
      }
      entry.lines.push({
        lsCode: item.ls_code,
        name: item.name,
        previousQuantity: allocation.source_metadata?.previous_quantity ?? 0,
        targetQuantity: allocation.source_metadata?.target_quantity ?? 0,
      })
      grouped.set(allocation.created_at, entry)
    }
  }

  return [...grouped.values()].sort((left, right) => right.createdAt.localeCompare(left.createdAt))
}
