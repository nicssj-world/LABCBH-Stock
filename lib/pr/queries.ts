import 'server-only'

import { z } from 'zod'
import { roundQuantity } from '@/lib/inventory/balance'
import { createClient } from '@/lib/supabase/server'
import { PURCHASE_METHODS, PURCHASE_REQUEST_STATUSES } from './schema'
import type { PurchaseRequestRecord, PurchaseRequestItemRecord } from './types'

const numericSchema = z.union([z.number(), z.string()]).transform(Number).refine(Number.isFinite)

const itemRowSchema = z.object({
  id: z.string().uuid(),
  line_number: z.number().int().positive(),
  inventory_item_id: z.string().uuid(),
  contract_item_id: z.string().uuid().nullable(),
  monthly_usage_snapshot: numericSchema,
  on_hand_snapshot: numericSchema,
  requested_quantity: numericSchema,
  unit: z.string(),
  unit_price: numericSchema,
  line_total: numericSchema,
  inventory_items: z.object({ ls_code: z.string(), name: z.string() }).nullable(),
  contract_items: z
    .object({
      id: z.string().uuid(),
      quantity: numericSchema,
      contracts: z.object({ display_name: z.string().nullable(), product: z.string() }).nullable(),
      contract_item_allocations: z.array(z.object({ quantity: numericSchema })).nullable().default([]),
    })
    .nullable(),
})

const requestRowSchema = z.object({
  id: z.string().uuid(),
  fiscal_year: z.number().int(),
  sequence_number: z.number().int(),
  document_number: z.string(),
  requester_id: z.string().uuid().nullable(),
  department: z.string(),
  head_name: z.string(),
  requested_date: z.string(),
  purchase_method: z.enum(PURCHASE_METHODS),
  method_details: z.record(z.unknown()).nullable().default({}),
  status: z.enum(PURCHASE_REQUEST_STATUSES),
  po_number: z.string().nullable(),
  note: z.string().nullable(),
  acknowledged_by: z.string().uuid().nullable(),
  acknowledged_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string().nullable(),
  requester: z.object({ name: z.string().nullable() }).nullable(),
  acknowledger: z.object({ name: z.string().nullable() }).nullable(),
  purchase_request_items: z.array(itemRowSchema).nullable().default([]),
})

const REQUEST_SELECT = `
  id,
  fiscal_year,
  sequence_number,
  document_number,
  requester_id,
  department,
  head_name,
  requested_date,
  purchase_method,
  method_details,
  status,
  po_number,
  note,
  acknowledged_by,
  acknowledged_at,
  created_at,
  updated_at,
  requester:profiles!purchase_requests_requester_id_fkey (name),
  acknowledger:profiles!purchase_requests_acknowledged_by_fkey (name),
  purchase_request_items (
    id,
    line_number,
    inventory_item_id,
    contract_item_id,
    monthly_usage_snapshot,
    on_hand_snapshot,
    requested_quantity,
    unit,
    unit_price,
    line_total,
    inventory_items (ls_code, name),
    contract_items (
      id,
      quantity,
      contracts (display_name, product),
      contract_item_allocations (quantity)
    )
  )
`

export interface PurchaseRequestFilters {
  status?: (typeof PURCHASE_REQUEST_STATUSES)[number]
  search?: string
}

function mapItem(row: z.infer<typeof itemRowSchema>): PurchaseRequestItemRecord {
  const contractItem = row.contract_items
  const allocated = (contractItem?.contract_item_allocations ?? []).reduce(
    (sum, allocation) => sum + allocation.quantity,
    0,
  )

  return {
    id: row.id,
    lineNumber: row.line_number,
    inventoryItemId: row.inventory_item_id,
    lsCode: row.inventory_items?.ls_code ?? '—',
    name: row.inventory_items?.name ?? '—',
    contractItemId: row.contract_item_id,
    contractDisplayName: contractItem?.contracts
      ? contractItem.contracts.display_name?.trim() || contractItem.contracts.product
      : null,
    contractRemaining: contractItem ? roundQuantity(contractItem.quantity - allocated) : null,
    monthlyUsageSnapshot: row.monthly_usage_snapshot,
    onHandSnapshot: row.on_hand_snapshot,
    requestedQuantity: row.requested_quantity,
    unit: row.unit,
    unitPrice: row.unit_price,
    lineTotal: row.line_total,
  }
}

function mapRequest(row: z.infer<typeof requestRowSchema>): PurchaseRequestRecord {
  const items = (row.purchase_request_items ?? [])
    .sort((left, right) => left.line_number - right.line_number)
    .map(mapItem)

  return {
    id: row.id,
    fiscalYear: row.fiscal_year,
    sequenceNumber: row.sequence_number,
    documentNumber: row.document_number,
    requesterId: row.requester_id,
    requesterName: row.requester?.name ?? null,
    department: row.department,
    headName: row.head_name,
    requestedDate: row.requested_date,
    purchaseMethod: row.purchase_method,
    methodDetails: row.method_details ?? {},
    status: row.status,
    poNumber: row.po_number,
    acknowledgedBy: row.acknowledged_by,
    acknowledgedByName: row.acknowledger?.name ?? null,
    acknowledgedAt: row.acknowledged_at,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    items,
    total: items.reduce((sum, item) => sum + item.lineTotal, 0),
  }
}

export async function listPurchaseRequests(
  filters: PurchaseRequestFilters = {},
): Promise<PurchaseRequestRecord[]> {
  const supabase = await createClient()
  let query = supabase
    .from('purchase_requests')
    .select(REQUEST_SELECT)
    .order('requested_date', { ascending: false })
    .order('sequence_number', { ascending: false })

  if (filters.status) query = query.eq('status', filters.status)

  const search = filters.search?.trim().replace(/[,%()]/g, ' ')
  if (search) {
    // Officers search by PO, PR, LS code, or reagent name. The first two live on
    // the header; the last two are resolved separately and merged below.
    query = query.or(`document_number.ilike.%${search}%,po_number.ilike.%${search}%`)
  }

  const { data, error } = await query
  if (error) throw new Error(`อ่านรายการใบ PR ไม่สำเร็จ: ${error.message}`)

  const headerMatches = requestRowSchema.array().parse(data ?? []).map(mapRequest)
  if (!search) return headerMatches

  const lineMatches = await findRequestsByLine(search, filters.status)
  const byId = new Map(headerMatches.map((request) => [request.id, request]))
  for (const request of lineMatches) byId.set(request.id, request)

  return [...byId.values()].sort(
    (left, right) =>
      right.requestedDate.localeCompare(left.requestedDate) ||
      right.sequenceNumber - left.sequenceNumber,
  )
}

async function findRequestsByLine(
  search: string,
  status?: (typeof PURCHASE_REQUEST_STATUSES)[number],
): Promise<PurchaseRequestRecord[]> {
  const supabase = await createClient()

  const { data: matchedItems, error: itemError } = await supabase
    .from('inventory_items')
    .select('id')
    .or(`ls_code.ilike.%${search}%,name.ilike.%${search}%`)

  if (itemError) throw new Error(`ค้นหาน้ำยาไม่สำเร็จ: ${itemError.message}`)

  const itemIds = z.object({ id: z.string().uuid() }).array().parse(matchedItems ?? []).map((row) => row.id)
  if (itemIds.length === 0) return []

  const { data: matchedLines, error: lineError } = await supabase
    .from('purchase_request_items')
    .select('purchase_request_id')
    .in('inventory_item_id', itemIds)

  if (lineError) throw new Error(`ค้นหารายการในใบ PR ไม่สำเร็จ: ${lineError.message}`)

  const requestIds = [
    ...new Set(
      z
        .object({ purchase_request_id: z.string().uuid() })
        .array()
        .parse(matchedLines ?? [])
        .map((row) => row.purchase_request_id),
    ),
  ]
  if (requestIds.length === 0) return []

  let query = supabase.from('purchase_requests').select(REQUEST_SELECT).in('id', requestIds)
  if (status) query = query.eq('status', status)

  const { data, error } = await query
  if (error) throw new Error(`อ่านรายการใบ PR ไม่สำเร็จ: ${error.message}`)

  return requestRowSchema.array().parse(data ?? []).map(mapRequest)
}

export async function getPurchaseRequest(id: string): Promise<PurchaseRequestRecord | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('purchase_requests')
    .select(REQUEST_SELECT)
    .eq('id', id)
    .maybeSingle()

  if (error) throw new Error(`อ่านข้อมูลใบ PR ไม่สำเร็จ: ${error.message}`)
  if (!data) return null

  return mapRequest(requestRowSchema.parse(data))
}

export interface ContractItemOption {
  id: string
  contractId: number
  contractName: string
  lsCode: string
  name: string
  unit: string
  unitPrice: number
  contractedQuantity: number
  remainingQuantity: number
}

const contractItemOptionRowSchema = z.object({
  id: z.string().uuid(),
  contract_id: numericSchema.pipe(z.number().int().positive()),
  ls_code: z.string(),
  name: z.string(),
  unit: z.string(),
  quantity: numericSchema,
  unit_price: numericSchema,
  contracts: z.object({ display_name: z.string().nullable(), product: z.string() }).nullable(),
  contract_item_allocations: z.array(z.object({ quantity: numericSchema })).nullable().default([]),
})

/**
 * Contract lines with quantity still available, for the PR item picker. Omit
 * the contract to load every active contract's lines for the picker at once.
 */
export async function listContractItemOptions(contractId?: number): Promise<ContractItemOption[]> {
  const supabase = await createClient()
  let query = supabase
    .from('contract_items')
    .select(`
      id,
      contract_id,
      ls_code,
      name,
      unit,
      quantity,
      unit_price,
      contracts (display_name, product),
      contract_item_allocations (quantity)
    `)
    .order('line_number')

  if (contractId !== undefined) query = query.eq('contract_id', contractId)

  const { data, error } = await query

  if (error) throw new Error(`อ่านรายการในสัญญาไม่สำเร็จ: ${error.message}`)

  return contractItemOptionRowSchema
    .array()
    .parse(data ?? [])
    .map((row) => {
      const allocated = (row.contract_item_allocations ?? []).reduce(
        (sum, allocation) => sum + allocation.quantity,
        0,
      )
      return {
        id: row.id,
        contractId: row.contract_id,
        contractName: row.contracts?.display_name?.trim() || row.contracts?.product || 'ไม่ระบุสัญญา',
        lsCode: row.ls_code,
        name: row.name,
        unit: row.unit,
        unitPrice: row.unit_price,
        contractedQuantity: row.quantity,
        remainingQuantity: roundQuantity(row.quantity - allocated),
      }
    })
}
