import 'server-only'

import { cache } from 'react'
import { z } from 'zod'
import { bangkokIsoDate } from '@/lib/date/thai'
import { rankLotsForFifo } from '@/lib/requisitions/fifo'
import { createClient } from '@/lib/supabase/server'
import {
  DEFAULT_MINIMUM_STOCK_MONTHS,
  MINIMUM_STOCK_WINDOW_MONTHS,
  MOVEMENT_TYPES,
  calculateSuggestedMinimum,
  classifyLotExpiry,
  classifyStockLevel,
  isProjectedBelowMinimum,
  resolveMinimumStock,
  roundQuantity,
} from './balance'
import { EMPTY_STOCK_CHECK_STATUS, getStockCheckWeekStart, type StockCheckStatus } from './checklist'
import type {
  InventoryCatalogEntry,
  InventoryExportFilters,
  InventoryExportItemRecord,
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
  minimum_stock_override: numericSchema.nullable(),
  is_active: z.boolean(),
  note: z.string().nullable(),
})

const balanceRowSchema = z.object({
  inventory_item_id: z.string().uuid(),
  on_hand: numericSchema,
})

const movementPresenceRowSchema = z.object({
  inventory_item_id: z.string().uuid(),
  has_movements: z.boolean(),
})

const openRequestRowSchema = z.object({
  inventory_item_id: z.string().uuid(),
})

const stockCheckRowSchema = z.object({
  inventory_item_id: z.string().uuid(),
  checked_at: z.string(),
  week_start: z.string(),
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
  is_active: z.boolean(),
})

const exportLotRowSchema = lotRowSchema.extend({
  inventory_item_id: z.string().uuid(),
})

const lotBalanceRowSchema = z.object({
  inventory_lot_id: z.string().uuid(),
  balance: numericSchema,
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
  minimum_stock_override,
  is_active,
  note
`

export const INVENTORY_MOVEMENT_PREVIEW_SIZE = 5
export const INVENTORY_MOVEMENT_PAGE_SIZE = 20

/** Hospital operations run on Bangkok dates, not the server's locale. */
export function bangkokToday(): string {
  return bangkokIsoDate()
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

/**
 * Reads on-hand and the completed-month issue history.
 *
 * `itemIds` narrows both views; omitting it reads them whole. A list needs the
 * whole thing anyway and cannot know the ids until its own query returns, so
 * leaving the filter off is what lets the caller run this in parallel with the
 * item query instead of waiting a second round-trip for it. Both views carry
 * one row per item (per item-month over three months for issues), so reading
 * them whole stays proportional to the catalogue, and on staging it measured
 * faster than the filtered form — a 196-id `in` list alone is a ~7KB URL.
 */
async function readBalancesAndIssues(
  supabase: Awaited<ReturnType<typeof createClient>>,
  itemIds?: string[],
) {
  const today = bangkokToday()
  const monthKeys = completedMonthKeys(today)

  let balanceQuery = supabase.from('inventory_item_balances').select('inventory_item_id, on_hand')
  let issueQuery = supabase
    .from('inventory_item_monthly_issues')
    .select('inventory_item_id, issue_month, issued_quantity')
    .gte('issue_month', monthKeys[0])
    .lte('issue_month', monthKeys[monthKeys.length - 1])

  if (itemIds) {
    balanceQuery = balanceQuery.in('inventory_item_id', itemIds)
    issueQuery = issueQuery.in('inventory_item_id', itemIds)
  }

  const [balanceResult, issueResult] = await Promise.all([balanceQuery, issueQuery])

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
  minimumStockMonths: number,
  hasMovements = false,
  hasOpenRequest = false,
  stockCheck: StockCheckStatus = EMPTY_STOCK_CHECK_STATUS,
): InventoryItemRecord {
  const suggestedMinimum = calculateSuggestedMinimum(monthlyIssues, minimumStockMonths)
  const minimumStock = resolveMinimumStock(row.minimum_stock_override, suggestedMinimum)

  return {
    id: row.id,
    lsCode: row.ls_code,
    name: row.name,
    baseUnit: row.base_unit,
    responsibleDepartment: row.responsible_department,
    note: row.note,
    defaultUnitPrice: row.default_unit_price,
    minimumStockMonths,
    minimumStockOverride: row.minimum_stock_override,
    isActive: row.is_active,
    onHand,
    suggestedMinimum,
    minimumStock,
    stockLevel: classifyStockLevel({ onHand, minimum: minimumStock }),
    hasMovements,
    hasOpenRequest,
    monthlyIssues,
    lastStockCheckedAt: stockCheck.lastCheckedAt,
    isStockCheckedThisWeek: stockCheck.isCheckedThisWeek,
  }
}

async function readLatestStockChecks(
  supabase: Awaited<ReturnType<typeof createClient>>,
  itemIds?: string[],
): Promise<Map<string, StockCheckStatus>> {
  let query = supabase
    .from('inventory_item_latest_stock_checks')
    .select('inventory_item_id, checked_at, week_start')

  if (itemIds) query = query.in('inventory_item_id', itemIds)

  const { data, error } = await query
  if (error) throw new Error(`อ่านประวัติการตรวจนับไม่สำเร็จ: ${error.message}`)

  const currentWeekStart = getStockCheckWeekStart(bangkokToday())
  return new Map(
    stockCheckRowSchema.array().parse(data ?? []).map((row) => [
      row.inventory_item_id,
      {
        lastCheckedAt: row.checked_at,
        isCheckedThisWeek: row.week_start === currentWeekStart,
      },
    ]),
  )
}

/**
 * Which items have ledger history, and which are already covered by an open
 * purchase request. Both feed classifyStockAlert; neither changes an item's
 * stockLevel, only whether it belongs on the restock worklist.
 */
async function readAlertScope(
  supabase: Awaited<ReturnType<typeof createClient>>,
  itemIds?: string[],
): Promise<{ moved: Set<string>; requested: Set<string> }> {
  let presenceQuery = supabase
    .from('inventory_item_movement_presence')
    .select('inventory_item_id, has_movements')
  let requestQuery = supabase
    .from('inventory_item_open_requests')
    .select('inventory_item_id')

  if (itemIds) {
    presenceQuery = presenceQuery.in('inventory_item_id', itemIds)
    requestQuery = requestQuery.in('inventory_item_id', itemIds)
  }

  const [presenceResult, requestResult] = await Promise.all([presenceQuery, requestQuery])

  if (presenceResult.error) throw new Error(`อ่านประวัติการเคลื่อนไหวไม่สำเร็จ: ${presenceResult.error.message}`)
  if (requestResult.error) throw new Error(`อ่านใบขอซื้อที่ค้างอยู่ไม่สำเร็จ: ${requestResult.error.message}`)

  return {
    moved: new Set(
      movementPresenceRowSchema
        .array()
        .parse(presenceResult.data ?? [])
        .filter((r) => r.has_movements)
        .map((r) => r.inventory_item_id),
    ),
    requested: new Set(
      openRequestRowSchema.array().parse(requestResult.data ?? []).map((r) => r.inventory_item_id),
    ),
  }
}

const minimumStockSettingsRowSchema = z.object({ minimum_stock_months: numericSchema })

/**
 * One system-wide reserve-months value drives every item's suggested minimum.
 *
 * Cached per request the way requireActor() is: the inventory page reads this
 * for its own header and listInventoryItems reads it again to resolve each
 * item's minimum, which was two identical round-trips on every render.
 */
export const getInventoryMinimumStockMonths = cache(async (): Promise<number> => {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('inventory_minimum_stock_settings')
    .select('minimum_stock_months')
    .eq('id', true)
    .maybeSingle()

  if (error) throw new Error(`อ่านค่าจำนวนเดือนสำรองไม่สำเร็จ: ${error.message}`)
  return data ? minimumStockSettingsRowSchema.parse(data).minimum_stock_months : DEFAULT_MINIMUM_STOCK_MONTHS
})

const catalogRowSchema = itemRowSchema.pick({
  id: true,
  ls_code: true,
  name: true,
  base_unit: true,
})

/**
 * The active catalogue, for a picker that only needs to identify an item.
 *
 * listInventoryItems() answers the same question but also resolves on-hand,
 * three months of issue history and the reserve-months setting — four round
 * trips and roughly twice the payload — none of which a picker renders. Same
 * items in the same order, so a caller can move between the two freely.
 */
export async function listInventoryCatalog(): Promise<InventoryCatalogEntry[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('inventory_items')
    .select('id, ls_code, name, base_unit')
    .eq('is_active', true)
    .order('ls_code')

  if (error) throw new Error(`อ่านรายการคลังไม่สำเร็จ: ${error.message}`)

  return catalogRowSchema.array().parse(data ?? []).map((row) => ({
    id: row.id,
    lsCode: row.ls_code,
    name: row.name,
    baseUnit: row.base_unit,
  }))
}

export async function listInventoryItems(
  filters: InventoryFilters = {},
  options: { includeAlertScope?: boolean } = {},
): Promise<InventoryItemRecord[]> {
  const supabase = await createClient()
  let query = supabase.from('inventory_items').select(ITEM_SELECT).order('ls_code')

  if (!filters.includeInactive) query = query.eq('is_active', true)
  if (filters.department) query = query.eq('responsible_department', filters.department)

  const search = filters.search?.trim().replace(/[,%()]/g, ' ')
  if (search) {
    query = query.or(`ls_code.ilike.%${search}%,name.ilike.%${search}%`)
  }

  // All reads run together. Feeding the item ids into the balance read would
  // force it to wait for the item query to come back first, and that second
  // serial round-trip was most of the delay behind every keystroke in the
  // list's search box.
  // The PR form only needs stock metrics for its advisory picker. The
  // movement/open-request scope is used by the inventory restock worklist and
  // can be skipped until that page is rendered.
  const alertScopePromise = options.includeAlertScope === false
    ? Promise.resolve({ moved: new Set<string>(), requested: new Set<string>() })
    : readAlertScope(supabase)

  const [{ data, error }, { monthKeys, onHandByItem, issuesByItem }, alertScope, minimumStockMonths, stockChecks] =
    await Promise.all([
      query,
      readBalancesAndIssues(supabase),
      alertScopePromise,
      getInventoryMinimumStockMonths(),
      readLatestStockChecks(supabase),
    ])

  if (error) throw new Error(`อ่านรายการคลังไม่สำเร็จ: ${error.message}`)

  const rows = itemRowSchema.array().parse(data ?? [])
  if (rows.length === 0) return []

  return rows.map((row) =>
    toItemRecord(
      row,
      onHandByItem.get(row.id) ?? 0,
      buildMonthlyIssues(monthKeys, issuesByItem.get(row.id) ?? new Map()),
      minimumStockMonths,
      alertScope.moved.has(row.id),
      alertScope.requested.has(row.id),
      stockChecks.get(row.id),
    ),
  )
}

/**
 * Reads the complete, current catalogue shape needed by the stock report in
 * three batch queries. The report deliberately keeps the item total and every
 * lot balance together so a multi-lot item can be rendered as child rows
 * without making one round trip per item.
 */
export async function listInventoryExportItems(
  filters: InventoryExportFilters = { onlyInStock: false },
): Promise<InventoryExportItemRecord[]> {
  const supabase = await createClient()
  let itemQuery = supabase.from('inventory_items').select(ITEM_SELECT).eq('is_active', true).order('ls_code')

  if (filters.department) itemQuery = itemQuery.eq('responsible_department', filters.department)

  const { data, error } = await itemQuery
  if (error) throw new Error(`อ่านรายการคลังสำหรับรายงานไม่สำเร็จ: ${error.message}`)

  const itemRows = itemRowSchema.array().parse(data ?? [])
  if (itemRows.length === 0) return []

  const itemIds = itemRows.map((row) => row.id)
  const [balanceResult, lotResult, lotBalanceResult] = await Promise.all([
    supabase
      .from('inventory_item_balances')
      .select('inventory_item_id, on_hand')
      .in('inventory_item_id', itemIds),
    supabase
      .from('inventory_lots')
      .select('inventory_item_id, id, lot_number, expiry_date, received_date, original_quantity, storage_location, is_active')
      .in('inventory_item_id', itemIds),
    supabase
      .from('inventory_lot_balances')
      .select('inventory_lot_id, balance')
      .in('inventory_item_id', itemIds),
  ])

  if (balanceResult.error) throw new Error(`อ่านยอดคงเหลือสำหรับรายงานไม่สำเร็จ: ${balanceResult.error.message}`)
  if (lotResult.error) throw new Error(`อ่านข้อมูลล็อตสำหรับรายงานไม่สำเร็จ: ${lotResult.error.message}`)
  if (lotBalanceResult.error) throw new Error(`อ่านยอดคงเหลือรายล็อตสำหรับรายงานไม่สำเร็จ: ${lotBalanceResult.error.message}`)

  const onHandByItem = new Map(
    balanceRowSchema.array().parse(balanceResult.data ?? []).map((row) => [row.inventory_item_id, roundQuantity(row.on_hand)]),
  )
  const balanceByLot = new Map(
    lotBalanceRowSchema.array().parse(lotBalanceResult.data ?? []).map((row) => [row.inventory_lot_id, roundQuantity(row.balance)]),
  )
  const lotsByItem = new Map<string, Array<InventoryExportItemRecord['lots'][number] & { receivedAt: string }>>()

  for (const lot of exportLotRowSchema.array().parse(lotResult.data ?? [])) {
    const itemLots = lotsByItem.get(lot.inventory_item_id) ?? []
    itemLots.push({
      id: lot.id,
      lotNumber: lot.lot_number,
      expiryDate: lot.expiry_date,
      balance: balanceByLot.get(lot.id) ?? 0,
      isActive: lot.is_active,
      receivedAt: lot.received_date,
    })
    lotsByItem.set(lot.inventory_item_id, itemLots)
  }

  const items = itemRows.map((row) => ({
    id: row.id,
    lsCode: row.ls_code,
    name: row.name,
    baseUnit: row.base_unit,
    responsibleDepartment: row.responsible_department,
    note: row.note,
    onHand: onHandByItem.get(row.id) ?? 0,
    lots: rankLotsForFifo(
      lotsByItem.get(row.id) ?? [],
    ).map(({ id, lotNumber, expiryDate, balance, isActive }) => ({ id, lotNumber, expiryDate, balance, isActive })),
  }))

  return filters.onlyInStock ? items.filter((item) => item.onHand > 0) : items
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

export async function getInventoryItem(
  itemId: string,
  options: { movementPage?: number; movementPageSize?: number } = {},
): Promise<InventoryItemDetail | null> {
  const supabase = await createClient()
  const movementPageSize = options.movementPageSize === INVENTORY_MOVEMENT_PAGE_SIZE
    ? INVENTORY_MOVEMENT_PAGE_SIZE
    : INVENTORY_MOVEMENT_PREVIEW_SIZE
  const requestedMovementPage = Number.isInteger(options.movementPage) && (options.movementPage ?? 0) > 0
    ? options.movementPage!
    : 1
  const movementFrom = (requestedMovementPage - 1) * movementPageSize
  const { data, error } = await supabase
    .from('inventory_items')
    .select(ITEM_SELECT)
    .eq('id', itemId)
    .maybeSingle()

  if (error) throw new Error(`อ่านข้อมูลรายการคลังไม่สำเร็จ: ${error.message}`)
  if (!data) return null

  const row = itemRowSchema.parse(data)
  const today = bangkokToday()

  const [balancesAndIssues, lotResult, lotBalances, movementResult, minimumStockMonths, stockChecks] = await Promise.all([
    readBalancesAndIssues(supabase, [row.id]),
    supabase
      .from('inventory_lots')
      .select('id, lot_number, expiry_date, received_date, original_quantity, storage_location, is_active')
      .eq('inventory_item_id', row.id),
    // Reads by item rather than by the lot ids the query above returns, which
    // is what lets it run here instead of waiting a further round trip for
    // them. The view carries inventory_item_id, and this page always wants
    // every lot of the item, so the two forms select the same rows.
    readLotBalances(supabase, row.id),
    supabase
      .from('stock_movements')
      .select('id, movement_type, quantity, occurred_on, note, created_at, inventory_lots (lot_number)', { count: 'exact' })
      .eq('inventory_item_id', row.id)
      .order('occurred_on', { ascending: false })
      .order('created_at', { ascending: false })
      .range(movementFrom, movementFrom + movementPageSize - 1),
    getInventoryMinimumStockMonths(),
    readLatestStockChecks(supabase, [row.id]),
  ])

  if (lotResult.error) throw new Error(`อ่านข้อมูลล็อตไม่สำเร็จ: ${lotResult.error.message}`)
  if (movementResult.error) {
    throw new Error(`อ่านความเคลื่อนไหวคลังไม่สำเร็จ: ${movementResult.error.message}`)
  }

  const lotRows = lotRowSchema.array().parse(lotResult.data ?? [])

  // Shown in the same order fulfilment will actually issue them, using the one
  // ranking function so this preview cannot drift from the real thing.
  const lots: InventoryLotRecord[] = rankLotsForFifo(
    lotRows.map((lot) => ({
      id: lot.id,
      lotNumber: lot.lot_number,
      expiryDate: lot.expiry_date,
      receivedAt: lot.received_date,
      receivedDate: lot.received_date,
      originalQuantity: lot.original_quantity,
      storageLocation: lot.storage_location,
      balance: lotBalances.get(lot.id) ?? 0,
      isActive: lot.is_active,
      expiryStatus: classifyLotExpiry(lot.expiry_date, today),
    })),
  )

  const { monthKeys, onHandByItem, issuesByItem } = balancesAndIssues
  const movementTotalCount = movementResult.count ?? movementResult.data?.length ?? 0
  const movementPageCount = Math.max(1, Math.ceil(movementTotalCount / movementPageSize))
  const movementCurrentPage = Math.min(requestedMovementPage, movementPageCount)

  return {
    ...toItemRecord(
      row,
      onHandByItem.get(row.id) ?? 0,
      buildMonthlyIssues(monthKeys, issuesByItem.get(row.id) ?? new Map()),
      minimumStockMonths,
      false,
      false,
      stockChecks.get(row.id),
    ),
    note: row.note,
    lots,
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
    movementPagination: {
      currentPage: movementCurrentPage,
      pageCount: movementPageCount,
      totalCount: movementTotalCount,
      pageSize: movementPageSize,
      startIndex: (movementCurrentPage - 1) * movementPageSize,
    },
  }
}

async function readLotBalances(
  supabase: Awaited<ReturnType<typeof createClient>>,
  itemId: string,
): Promise<Map<string, number>> {
  const { data, error } = await supabase
    .from('inventory_lot_balances')
    .select('inventory_lot_id, balance')
    .eq('inventory_item_id', itemId)

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

/** Batch form of getOnHand, for a detail page listing several items at once. */
export async function listOnHand(itemIds: string[]): Promise<Record<string, number>> {
  if (itemIds.length === 0) return {}

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('inventory_item_balances')
    .select('inventory_item_id, on_hand')
    .in('inventory_item_id', itemIds)

  if (error) throw new Error(`อ่านยอดคงเหลือไม่สำเร็จ: ${error.message}`)

  return Object.fromEntries(
    balanceRowSchema.array().parse(data ?? []).map((row) => [row.inventory_item_id, roundQuantity(row.on_hand)]),
  )
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
