import 'server-only'

import { z } from 'zod'
import { budgetSnapshot, type BudgetSnapshot } from '@/lib/contracts/budget'
import { PROCUREMENT_STAGES } from '@/lib/contracts/stages'
import { missingUsagePeriods } from '@/lib/out-lab/fiscal'
import { OUT_LAB_CADENCES, OUT_LAB_DEPARTMENTS, OUT_LAB_KINDS } from '@/lib/out-lab/schema'
import type {
  OutLabContractListRecord,
  OutLabContractRecord,
  OutLabUsageRecord,
} from '@/lib/out-lab/types'
import { createClient } from '@/lib/supabase/server'

const numericSchema = z
  .union([z.number(), z.string()])
  .transform(Number)
  .refine(Number.isFinite)

const outLabUsageAmountRowSchema = z.object({
  usage_month: z.string(),
  amount: numericSchema,
})

const outLabUsageReadRowSchema = z.object({
  id: z.string().uuid(),
  usage_month: z.string(),
  amount: numericSchema,
  note: z.string().nullable(),
  recorded_by: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
})

const outLabStageHistoryReadRowSchema = z.object({
  id: z.string().uuid(),
  from_stage: z.enum(PROCUREMENT_STAGES).nullable(),
  to_stage: z.enum(PROCUREMENT_STAGES),
  effective_date: z.string(),
  contract_number_snapshot: z.string().nullable(),
  note: z.string().nullable(),
  source: z.string(),
  created_at: z.string(),
})

const OUT_LAB_SCALAR_READ_SELECT = `
  id,
  kind,
  entry_cadence,
  fiscal_year,
  display_name,
  vendor,
  department,
  contract_number,
  total,
  start_date,
  end_date,
  procurement_stage,
  status,
  is_archived,
  archive_reason,
  responsible_user_ids,
  file_url,
  note,
  created_at,
  updated_at`

const OUT_LAB_STAGE_HISTORY_READ_SELECT = `
  out_lab_contract_stage_history (
    id,
    from_stage,
    to_stage,
    effective_date,
    contract_number_snapshot,
    note,
    source,
    created_at
  )`

// The register needs the amount and the month of every entry: the month drives
// the overdue-period chip, the amount drives the balance. Nothing else from
// the ledger is rendered in a list row.
const OUT_LAB_USAGE_SUMMARY_SELECT = `
  out_lab_monthly_usage (usage_month, amount)`

const outLabContractReadRowSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(OUT_LAB_KINDS),
  entry_cadence: z.enum(OUT_LAB_CADENCES),
  fiscal_year: z.number().int(),
  display_name: z.string(),
  vendor: z.string().nullable(),
  department: z.enum(OUT_LAB_DEPARTMENTS).nullable(),
  contract_number: z.string().nullable(),
  total: numericSchema.nullable(),
  start_date: z.string(),
  end_date: z.string(),
  procurement_stage: z.enum(PROCUREMENT_STAGES).nullable(),
  status: z.enum(['pending', 'active', 'expired', 'cancelled']),
  is_archived: z.boolean(),
  archive_reason: z.string().nullable(),
  responsible_user_ids: z.array(z.string().uuid()).nullable().default([]),
  file_url: z.string().nullable(),
  note: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  out_lab_contract_stage_history: z
    .array(outLabStageHistoryReadRowSchema)
    .nullable()
    .default([]),
  out_lab_monthly_usage: z.array(outLabUsageAmountRowSchema).nullable().default([]),
})

type OutLabContractReadRow = z.infer<typeof outLabContractReadRowSchema>

export interface OutLabFilters {
  fiscalYear?: number
  kind?: (typeof OUT_LAB_KINDS)[number]
  entryCadence?: (typeof OUT_LAB_CADENCES)[number]
  department?: (typeof OUT_LAB_DEPARTMENTS)[number]
  search?: string
  includeArchived?: boolean
}

function mapOutLabRow(row: OutLabContractReadRow): OutLabContractRecord {
  return {
    id: row.id,
    kind: row.kind,
    entryCadence: row.entry_cadence,
    fiscalYear: row.fiscal_year,
    displayName: row.display_name,
    vendor: row.vendor,
    department: row.department,
    contractNumber: row.contract_number,
    total: row.total,
    startDate: row.start_date,
    endDate: row.end_date,
    procurementStage: row.procurement_stage,
    status: row.status,
    isArchived: row.is_archived,
    archiveReason: row.archive_reason,
    responsibleUserIds: row.responsible_user_ids ?? [],
    fileUrl: row.file_url,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    stageHistory: (row.out_lab_contract_stage_history ?? [])
      .sort((left, right) => left.effective_date.localeCompare(right.effective_date))
      .map((history) => ({
        id: history.id,
        fromStage: history.from_stage,
        toStage: history.to_stage,
        effectiveDate: history.effective_date,
        contractNumberSnapshot: history.contract_number_snapshot,
        note: history.note,
        source: history.source,
        createdAt: history.created_at,
      })),
  }
}

function mapOutLabListRow(row: OutLabContractReadRow, now: Date): OutLabContractListRecord {
  const contract = mapOutLabRow(row)
  const entries = row.out_lab_monthly_usage ?? []
  const snapshot = budgetSnapshot({ total: contract.total, entries })

  return {
    ...contract,
    used: snapshot.used,
    remaining: snapshot.remaining,
    remainingPercent: snapshot.percentUsed === null ? null : 100 - snapshot.percentUsed,
    missingPeriodCount: missingUsagePeriods(
      {
        cadence: contract.entryCadence,
        startDate: contract.startDate,
        endDate: contract.endDate,
        entries: entries.map((entry) => ({ usageMonth: entry.usage_month })),
      },
      now,
    ).length,
  }
}

export async function listOutLabContracts(
  filters: OutLabFilters = {},
  now: Date = new Date(),
): Promise<OutLabContractListRecord[]> {
  const supabase = await createClient()
  let query = supabase
    .from('out_lab_contracts')
    .select(`${OUT_LAB_SCALAR_READ_SELECT}, ${OUT_LAB_USAGE_SUMMARY_SELECT}`)
    .order('fiscal_year', { ascending: false })
    .order('display_name', { ascending: true })

  // The archived toggle is a separate view, not an additional filter: an admin
  // looking to restore a mistakenly archived row needs exactly those rows, not
  // the normal register with a few extras mixed in.
  query = filters.includeArchived
    ? query.eq('is_archived', true)
    : query.eq('is_archived', false)

  if (filters.fiscalYear) query = query.eq('fiscal_year', filters.fiscalYear)
  if (filters.kind) query = query.eq('kind', filters.kind)
  if (filters.entryCadence) query = query.eq('entry_cadence', filters.entryCadence)
  if (filters.department) query = query.eq('department', filters.department)

  const search = filters.search?.trim().replace(/[,%()]/g, ' ')
  if (search) {
    query = query.or(
      `display_name.ilike.%${search}%,contract_number.ilike.%${search}%,vendor.ilike.%${search}%`,
    )
  }

  const { data, error } = await query
  if (error) throw new Error(`อ่านทะเบียนสัญญา Out Lab ไม่สำเร็จ: ${error.message}`)

  return outLabContractReadRowSchema
    .array()
    .parse(data ?? [])
    .map((row) => mapOutLabListRow(row, now))
}

export async function getOutLabContract(
  contractId: string,
  options: { includeArchived?: boolean } = {},
): Promise<OutLabContractRecord | null> {
  const supabase = await createClient()
  let query = supabase
    .from('out_lab_contracts')
    .select(
      `${OUT_LAB_SCALAR_READ_SELECT}, ${OUT_LAB_STAGE_HISTORY_READ_SELECT}, ${OUT_LAB_USAGE_SUMMARY_SELECT}`,
    )
    .eq('id', contractId)

  if (!options.includeArchived) query = query.eq('is_archived', false)

  const { data, error } = await query.maybeSingle()
  if (error) throw new Error(`อ่านข้อมูลสัญญา Out Lab ไม่สำเร็จ: ${error.message}`)
  if (!data) return null

  return mapOutLabRow(outLabContractReadRowSchema.parse(data))
}

export interface OutLabBudget {
  entries: OutLabUsageRecord[]
  snapshot: BudgetSnapshot
}

/**
 * The ledger for one contract, newest month first, with its balance already
 * derived. `budgetSnapshot` is the same helper the lease pages use — the
 * satang arithmetic that keeps an exactly-exhausted budget from showing a
 * fraction should not exist twice.
 */
export async function fetchOutLabUsage(
  contractId: string,
  total: number | null,
): Promise<OutLabBudget> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('out_lab_monthly_usage')
    .select('id,usage_month,amount,note,recorded_by,created_at,updated_at')
    .eq('out_lab_contract_id', contractId)
    .order('usage_month', { ascending: false })

  if (error) throw new Error(`อ่านยอดใช้จ่ายรายเดือนไม่สำเร็จ: ${error.message}`)

  const entries: OutLabUsageRecord[] = outLabUsageReadRowSchema
    .array()
    .parse(data ?? [])
    .map((row) => ({
      id: row.id,
      usageMonth: row.usage_month,
      amount: row.amount,
      note: row.note,
      recordedBy: row.recorded_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }))

  return { entries, snapshot: budgetSnapshot({ total, entries }) }
}
