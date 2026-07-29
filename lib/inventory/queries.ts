import 'server-only'

import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import {
  MINIMUM_STOCK_WINDOW_MONTHS,
  MOVEMENT_TYPES,
  calculateSuggestedMinimum,
  classifyLotExpiry,
  classifyStockLevel,
  isProjectedBelowMinimum,
  resolveMinimumStock,
  roundQuantity,
} from './balance'
import type {
  InventoryFilters,
  InventoryItemDetail,
  InventoryItemRecord,
  InventoryLotRecord,
} from './types'

const numericSchema = z.union([z.number(), z.string()]).transform(Number).refine(Number.isFinite)

const itemRowSchema = z.object({
  id: z.string().uuid(),
  ls_code: z.string(),
  name: z.string(),
  base_unit: z.string(),
  responsible_department: z.string().nullable(),
  default_unit_price: numericSchema.nullable(),
  minimum_stock_months: numericSchema,
  minimum_stock_override: numericSchema.nullable(),
  is_active: z.boolean(),
  note: z.string().nullable(),
})

const balanceRowSchema = z.object({
  inventory_item_id: z.string().uuid(),
  on_hand: numericSchema,
})

const monthlyIssueRowSchema = z.object({
  inventory_item_id: z.string().uuid(),
  issue_month: z.string(),
  issued_quantity: numericSchema,
})

const lotRowSchema = z.object({
  id: z.string().uuid(),
  lot_number: z.string(),
  expiry_date: z.string().nullable(),
  received_date: z.string(),
  original_quantity: numericSchema,
  storage_location: z.string().nullable(),
})

const lotBalanceRowSchema = z.object({
  inventory_lot_id: z.string().uuid(),
  balance: numericSchema,
})

const aliasRowSchema = z.object({
  id: z.string().uuid(),
  alias_kind: z.enum(['name', 'unit', 'ls_code']),
  alias_value: z.string(),
  source: z.string(),
})

const movementRowSchema = z.object({
  id: z.string().uuid(),
  movement_type: z.enum(MOVEMENT_TYPES),
  quantity: numericSchema,
  occurred_on: z.string(),
  note: z.string().nullable(),
  created_at: z.string(),
  inventory_lots: z.object({ lot_number: z.string() }).nullable(),
})

const ITEM_SELECT = `
  id,
  ls_code,
  name,
  base_unit,
  responsible_department,
  default_unit_price,
  minimum_stock_months,
  minimum_stock_override,
  is_active,
  note
`

/** Hospital operations run on Bangkok dates, not the server's locale. */
export function bangkokToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

/**
 * The three months before the current one. The running month is excluded
 * because a partial month would understate the average and depress every
 * suggested minimum for the first weeks of each month.
 */
export function completedMonthKeys(
  today: string,
  count: number = MINIMUM_STOCK_WINDOW_MONTHS,
): string[] {
  const [year, month] = today.split('-').map(Number)
  return Array.from({ length: count }, (_, index) => {
    const offset = count - index
    const date = new Date(Date.UTC(year, month - 1 - offset, 1))
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-01`
  })
}

function buildMonthlyIssues(
  monthKeys: string[],
  issuesByMonth: Map<string, number>,
): number[] {
  return monthKeys.map((month) => issuesByMonth.get(month) ?? 0)
}

async function readBalancesAndIssues(supabase: Awaited<ReturnType<typeof createClient>>, itemIds: string[]) {
  const today = bangkokToday()
  const monthKeys = completedMonthKeys(today)

  const [balanceResult, issueResult] = await Promise.all([
    supabase.from('inventory_item_balances').select('inventory_item_id, on_hand').in('inventory_item_id', itemIds),
    supabase
      .from('inventory_item_monthly_issues')
      .select('inventory_item_id, issue_month, issued_quantity')
      .in('inventory_item_id', itemIds)
      .gte('issue_month', monthKeys[0])
      .lte('issue_month', monthKeys[monthKeys.length - 1]),
  ])

  if (balanceResult.error) throw new Error(`อ่านยอดคงเหลือไม่สำเร็จ: ${balanceResult.error.message}`)
  if (issueResult.error) throw new Error(`อ่านประวัติการเบิกจ่ายไม่สำเร็จ: ${issueResult.error.message}`)

  const onHandByItem = new Map(
    balanceRowSchema.array().parse(balanceResult.data ?? []).map((row) => [row.inventory_item_id, row.on_hand]),
  )

  const issuesByItem = new Map<string, Map<string, number>>()
  for (const row of monthlyIssueRowSchema.array().parse(issueResult.data ?? [])) {
    const perMonth = issuesByItem.get(row.inventory_item_id) ?? new Map<string, number>()
    perMonth.set(row.issue_month, row.issued_quantity)
    issuesByItem.set(row.inventory_item_id, perMonth)
  }

  return { monthKeys, onHandByItem, issuesByItem }
}

function toItemRecord(
  row: z.infer<typeof itemRowSchema>,
  onHand: number,
  monthlyIssues: number[],
): InventoryItemRecord {
  const suggestedMinimum = calculateSuggestedMinimum(monthlyIssues, row.minimum_stock_months)
  const minimumStock = resolveMinimumStock(row.minimum_stock_override, suggestedMinimum)

  return {
    id: row.id,
    lsCode: row.ls_code,
    name: row.name,
    baseUnit: row.base_unit,
    responsibleDepartment: row.responsible_department,
    defaultUnitPrice: row.default_unit_price,
    minimumStockMonths: row.minimum_stock_months,
    minimumStockOverride: row.minimum_stock_override,
    isActive: row.is_active,
    onHand,
    suggestedMinimum,
    minimumStock,
    stockLevel: classifyStockLevel({ onHand, minimum: minimumStock }),
    monthlyIssues,
  }
}

export async function listInventoryItems(
  filters: InventoryFilters = {},
): Promise<InventoryItemRecord[]> {
  const supabase = await createClient()
  let query = supabase.from('inventory_items').select(ITEM_SELECT).order('ls_code')

  if (!filters.includeInactive) query = query.eq('is_active', true)
  if (filters.department) query = query.eq('responsible_department', filters.department)

  const search = filters.search?.trim().replace(/[,%()]/g, ' ')
  if (search) {
    query = query.or(`ls_code.ilike.%${search}%,name.ilike.%${search}%`)
  }

  const { data, error } = await query
  if (error) throw new Error(`อ่านรายการคลังไม่สำเร็จ: ${error.message}`)

  const rows = itemRowSchema.array().parse(data ?? [])
  if (rows.length === 0) return []

  const { monthKeys, onHandByItem, issuesByItem } = await readBalancesAndIssues(
    supabase,
    rows.map((row) => row.id),
  )

  return rows.map((row) =>
    toItemRecord(
      row,
      onHandByItem.get(row.id) ?? 0,
      buildMonthlyIssues(monthKeys, issuesByItem.get(row.id) ?? new Map()),
    ),
  )
}

export async function listInventoryDepartments(): Promise<string[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('inventory_items')
    .select('responsible_department')
    .not('responsible_department', 'is', null)

  if (error) throw new Error(`อ่านรายชื่อหน่วยงานไม่สำเร็จ: ${error.message}`)

  const departments = new Set(
    z
      .object({ responsible_department: z.string() })
      .array()
      .parse(data ?? [])
      .map((row) => row.responsible_department),
  )
  return [...departments].sort((left, right) => left.localeCompare(right, 'th'))
}

export async function getInventoryItem(itemId: string): Promise<InventoryItemDetail | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('inventory_items')
    .select(ITEM_SELECT)
    .eq('id', itemId)
    .maybeSingle()

  if (error) throw new Error(`อ่านข้อมูลรายการคลังไม่สำเร็จ: ${error.message}`)
  if (!data) return null

  const row = itemRowSchema.parse(data)
  const today = bangkokToday()

  const [balancesAndIssues, lotResult, aliasResult, movementResult] = await Promise.all([
    readBalancesAndIssues(supabase, [row.id]),
    supabase
      .from('inventory_lots')
      .select('id, lot_number, expiry_date, received_date, original_quantity, storage_location')
      .eq('inventory_item_id', row.id),
    supabase
      .from('inventory_item_aliases')
      .select('id, alias_kind, alias_value, source')
      .eq('inventory_item_id', row.id),
    supabase
      .from('stock_movements')
      .select('id, movement_type, quantity, occurred_on, note, created_at, inventory_lots (lot_number)')
      .eq('inventory_item_id', row.id)
      .order('occurred_on', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(50),
  ])

  if (lotResult.error) throw new Error(`อ่านข้อมูลล็อตไม่สำเร็จ: ${lotResult.error.message}`)
  if (aliasResult.error) throw new Error(`อ่านชื่อเรียกอื่นไม่สำเร็จ: ${aliasResult.error.message}`)
  if (movementResult.error) {
    throw new Error(`อ่านความเคลื่อนไหวคลังไม่สำเร็จ: ${movementResult.error.message}`)
  }

  const lotRows = lotRowSchema.array().parse(lotResult.data ?? [])
  const lotBalances = await readLotBalances(supabase, lotRows.map((lot) => lot.id))

  const lots: InventoryLotRecord[] = lotRows
    .map((lot) => ({
      id: lot.id,
      lotNumber: lot.lot_number,
      expiryDate: lot.expiry_date,
      receivedDate: lot.received_date,
      originalQuantity: lot.original_quantity,
      storageLocation: lot.storage_location,
      balance: lotBalances.get(lot.id) ?? 0,
      expiryStatus: classifyLotExpiry(lot.expiry_date, today),
    }))
    // FIFO order previews what Task 8 will issue: soonest expiry, then oldest receipt.
    .sort((left, right) => {
      const leftExpiry = left.expiryDate ?? '9999-12-31'
      const rightExpiry = right.expiryDate ?? '9999-12-31'
      return leftExpiry.localeCompare(rightExpiry) || left.receivedDate.localeCompare(right.receivedDate)
    })

  const { monthKeys, onHandByItem, issuesByItem } = balancesAndIssues

  return {
    ...toItemRecord(
      row,
      onHandByItem.get(row.id) ?? 0,
      buildMonthlyIssues(monthKeys, issuesByItem.get(row.id) ?? new Map()),
    ),
    note: row.note,
    lots,
    aliases: aliasRowSchema
      .array()
      .parse(aliasResult.data ?? [])
      .map((alias) => ({
        id: alias.id,
        aliasKind: alias.alias_kind,
        aliasValue: alias.alias_value,
        source: alias.source,
      })),
    recentMovements: movementRowSchema
      .array()
      .parse(movementResult.data ?? [])
      .map((movement) => ({
        id: movement.id,
        movementType: movement.movement_type,
        quantity: movement.quantity,
        occurredOn: movement.occurred_on,
        lotNumber: movement.inventory_lots?.lot_number ?? null,
        note: movement.note,
        createdAt: movement.created_at,
      })),
  }
}

async function readLotBalances(
  supabase: Awaited<ReturnType<typeof createClient>>,
  lotIds: string[],
): Promise<Map<string, number>> {
  if (lotIds.length === 0) return new Map()

  const { data, error } = await supabase
    .from('inventory_lot_balances')
    .select('inventory_lot_id, balance')
    .in('inventory_lot_id', lotIds)

  if (error) throw new Error(`อ่านยอดคงเหลือรายล็อตไม่สำเร็จ: ${error.message}`)

  return new Map(
    lotBalanceRowSchema.array().parse(data ?? []).map((row) => [row.inventory_lot_id, row.balance]),
  )
}

export async function getOnHand(itemId: string): Promise<number> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('inventory_item_balances')
    .select('inventory_item_id, on_hand')
    .eq('inventory_item_id', itemId)
    .maybeSingle()

  if (error) throw new Error(`อ่านยอดคงเหลือไม่สำเร็จ: ${error.message}`)
  return data ? roundQuantity(balanceRowSchema.parse(data).on_hand) : 0
}

export async function getLotBalance(lotId: string): Promise<number> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('inventory_lot_balances')
    .select('inventory_lot_id, balance')
    .eq('inventory_lot_id', lotId)
    .maybeSingle()

  if (error) throw new Error(`อ่านยอดคงเหลือรายล็อตไม่สำเร็จ: ${error.message}`)
  return data ? roundQuantity(lotBalanceRowSchema.parse(data).balance) : 0
}

export async function getSuggestedMinimum(itemId: string): Promise<number> {
  const item = await getInventoryItem(itemId)
  return item?.suggestedMinimum ?? 0
}

export async function projectedBelowMinimum(itemId: string, issueQuantity: number): Promise<boolean> {
  const item = await getInventoryItem(itemId)
  if (!item) return false
  return isProjectedBelowMinimum({
    onHand: item.onHand,
    minimum: item.minimumStock,
    issueQuantity,
  })
}
