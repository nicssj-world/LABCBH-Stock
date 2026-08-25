import 'server-only'

import { z } from 'zod'
import { roundQuantity } from '@/lib/inventory/balance'
import { GOODS_RECEIPT_STATUSES } from '@/lib/receipts/schema'
import { createClient } from '@/lib/supabase/server'
import { PURCHASE_METHODS, PURCHASE_REQUEST_STATUSES } from './schema'
import type {
  PurchaseRequestRecord,
  PurchaseRequestItemRecord,
  PurchaseRequestReceiptItemRecord,
  PurchaseRequestReceiptRecord,
} from './types'

const numericSchema = z.union([z.number(), z.string()]).transform(Number).refine(Number.isFinite)

const itemRowSchema = z.object({
  id: z.string().uuid(),
  line_number: z.number().int().positive(),
  inventory_item_id: z.string().uuid(),
  contract_item_id: z.string().uuid().nullable(),
  monthly_usage_snapshot: numericSchema,
  on_hand_snapshot: numericSchema,
  requested_quantity: numericSchema,
  received_quantity: numericSchema,
  remaining_quantity: numericSchema,
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
  po_number_released_by: z.string().uuid().nullable(),
  po_number_released_at: z.string().nullable(),
  po_number_release_reason: z.string().nullable(),
  po_file_path: z.string().nullable(),
  po_file_name: z.string().nullable(),
  po_file_mime_type: z.string().nullable(),
  po_file_size_bytes: numericSchema.nullable(),
  po_file_checksum: z.string().nullable(),
  po_file_uploaded_by: z.string().uuid().nullable(),
  po_file_uploaded_at: z.string().nullable(),
  po_file_deleted_by: z.string().uuid().nullable(),
  po_file_deleted_at: z.string().nullable(),
  po_file_deletion_reason: z.enum(['received', 'closed_short']).nullable(),
  po_file_deleted_receipt_id: z.string().uuid().nullable(),
  ephis_pr_number: z.string().nullable(),
  created_contract_id: z.number().int().nullable(),
  checklist_policy_version: z.number().int().nullable(),
  checklist_completed_at: z.string().nullable(),
  note: z.string().nullable(),
  acknowledged_by: z.string().uuid().nullable(),
  acknowledged_at: z.string().nullable(),
  outside_stock_received_by: z.string().uuid().nullable(),
  outside_stock_received_at: z.string().nullable(),
  outside_stock_received_note: z.literal('หน่วยงานรับของเอง').nullable(),
  reversed_by: z.string().uuid().nullable(),
  reversed_at: z.string().nullable(),
  reversal_reason: z.string().nullable(),
  closed_short_by: z.string().uuid().nullable(),
  closed_short_at: z.string().nullable(),
  closed_short_reason: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string().nullable(),
  requester: z.object({ name: z.string().nullable() }).nullable(),
  acknowledger: z.object({ name: z.string().nullable() }).nullable(),
  outside_stock_receiver: z.object({ name: z.string().nullable() }).nullable(),
  reverser: z.object({ name: z.string().nullable() }).nullable(),
  short_closer: z.object({ name: z.string().nullable() }).nullable(),
  updater: z.object({ name: z.string().nullable() }).nullable(),
  po_uploader: z.object({ name: z.string().nullable() }).nullable(),
  po_deleter: z.object({ name: z.string().nullable() }).nullable(),
  po_number_releaser: z.object({ name: z.string().nullable() }).nullable(),
  purchase_request_items: z.array(itemRowSchema).nullable().default([]),
})

const receiptHistoryItemSchema = z.object({
  id: z.string().uuid(),
  line_number: z.number().int().positive(),
  inventory_item_id: z.string().uuid(),
  lot_number: z.string(),
  expiry_date: z.string().nullable(),
  quantity: numericSchema,
  unit: z.string(),
  inventory_items: z.object({ ls_code: z.string(), name: z.string() }).nullable(),
})

const receiptHistorySchema = z.object({
  id: z.string().uuid(),
  po_number: z.string().nullable(),
  received_date: z.string(),
  status: z.enum(GOODS_RECEIPT_STATUSES),
  posted_at: z.string().nullable(),
  cancellation_note: z.string().nullable(),
  created_at: z.string(),
  goods_receipt_items: z.array(receiptHistoryItemSchema).nullable().default([]),
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
  po_number_released_by,
  po_number_released_at,
  po_number_release_reason,
  po_file_path,
  po_file_name,
  po_file_mime_type,
  po_file_size_bytes,
  po_file_checksum,
  po_file_uploaded_by,
  po_file_uploaded_at,
  po_file_deleted_by,
  po_file_deleted_at,
  po_file_deletion_reason,
  po_file_deleted_receipt_id,
  ephis_pr_number,
  created_contract_id,
  checklist_policy_version,
  checklist_completed_at,
  note,
  acknowledged_by,
  acknowledged_at,
  outside_stock_received_by,
  outside_stock_received_at,
  outside_stock_received_note,
  reversed_by,
  reversed_at,
  reversal_reason,
  closed_short_by,
  closed_short_at,
  closed_short_reason,
  created_at,
  updated_at,
  requester:profiles!purchase_requests_requester_id_fkey (name),
  acknowledger:profiles!purchase_requests_acknowledged_by_fkey (name),
  outside_stock_receiver:profiles!purchase_requests_outside_stock_received_by_fkey (name),
  reverser:profiles!purchase_requests_reversed_by_fkey (name),
  short_closer:profiles!purchase_requests_closed_short_by_fkey (name),
  updater:profiles!purchase_requests_updated_by_fkey (name),
  po_uploader:profiles!purchase_requests_po_file_uploaded_by_fkey (name),
  po_deleter:profiles!purchase_requests_po_file_deleted_by_fkey (name),
  po_number_releaser:profiles!purchase_requests_po_number_released_by_fkey (name),
  purchase_request_items (
    id,
    line_number,
    inventory_item_id,
    contract_item_id,
    monthly_usage_snapshot,
    on_hand_snapshot,
    requested_quantity,
    received_quantity,
    remaining_quantity,
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
  department?: string
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
    receivedQuantity: row.received_quantity,
    remainingQuantity: row.remaining_quantity,
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
    // The requester profile can be hidden by the shared profiles RLS policy
    // for users who are allowed to read the PR but not every profile. Keep the
    // immutable name snapshot on the PR as the display fallback.
    requesterName: row.requester?.name?.trim() || row.head_name.trim() || null,
    department: row.department,
    headName: row.head_name,
    requestedDate: row.requested_date,
    purchaseMethod: row.purchase_method,
    methodDetails: row.method_details ?? {},
    status: row.status,
    poNumber: row.po_number,
    poNumberReleasedBy: row.po_number_released_by,
    poNumberReleasedByName: row.po_number_releaser?.name?.trim() || null,
    poNumberReleasedAt: row.po_number_released_at,
    poNumberReleaseReason: row.po_number_release_reason,
    poFile: {
      path: row.po_file_path,
      fileName: row.po_file_name,
      mimeType: row.po_file_mime_type,
      sizeBytes: row.po_file_size_bytes,
      checksum: row.po_file_checksum,
      uploadedAt: row.po_file_uploaded_at,
      uploadedByName: row.po_uploader?.name?.trim() || null,
      deletedAt: row.po_file_deleted_at,
      deletedByName: row.po_deleter?.name?.trim() || null,
      deletionReason: row.po_file_deletion_reason,
      deletedReceiptId: row.po_file_deleted_receipt_id,
    },
    ephisPrNumber: row.ephis_pr_number,
    createdContractId: row.created_contract_id,
    checklistPolicyVersion: row.checklist_policy_version,
    checklistCompletedAt: row.checklist_completed_at,
    acknowledgedBy: row.acknowledged_by,
    acknowledgedByName: row.acknowledger?.name ?? null,
    acknowledgedAt: row.acknowledged_at,
    outsideStockReceivedBy: row.outside_stock_received_by,
    outsideStockReceivedByName: row.outside_stock_receiver?.name?.trim() || null,
    outsideStockReceivedAt: row.outside_stock_received_at,
    outsideStockReceivedNote: row.outside_stock_received_note,
    reversedBy: row.reversed_by,
    reversedByName: row.reverser?.name ?? null,
    reversedAt: row.reversed_at,
    reversalReason: row.reversal_reason,
    closedShortBy: row.closed_short_by,
    closedShortByName: row.short_closer?.name ?? null,
    closedShortAt: row.closed_short_at,
    closedShortReason: row.closed_short_reason,
    updatedByName: row.updater?.name ?? null,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    items,
    receiptHistory: [],
    total: items.reduce((sum, item) => sum + item.lineTotal, 0),
  }
}

function mapReceiptHistoryItem(
  row: z.infer<typeof receiptHistoryItemSchema>,
): PurchaseRequestReceiptItemRecord {
  return {
    id: row.id,
    lineNumber: row.line_number,
    inventoryItemId: row.inventory_item_id,
    lsCode: row.inventory_items?.ls_code ?? '—',
    name: row.inventory_items?.name ?? 'ไม่ระบุรายการ',
    lotNumber: row.lot_number,
    expiryDate: row.expiry_date,
    quantity: row.quantity,
    unit: row.unit,
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
  if (filters.department) query = query.eq('department', filters.department)

  const search = filters.search?.trim().replace(/[,%()]/g, ' ')
  if (search) {
    // Officers search by PO, PR, LS code, or reagent name. The first two live on
    // the header; the last two are resolved separately and merged below.
    query = query.or(
      `document_number.ilike.%${search}%,po_number.ilike.%${search}%,ephis_pr_number.ilike.%${search}%`,
    )
  }

  const { data, error } = await query
  if (error) throw new Error(`อ่านรายการใบ PR ไม่สำเร็จ: ${error.message}`)

  const headerMatches = requestRowSchema.array().parse(data ?? []).map(mapRequest)
  if (!search) return headerMatches

  const lineMatches = await findRequestsByLine(search, filters.status, filters.department)
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
  department?: string,
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
  if (department) query = query.eq('department', department)

  const { data, error } = await query
  if (error) throw new Error(`อ่านรายการใบ PR ไม่สำเร็จ: ${error.message}`)

  return requestRowSchema.array().parse(data ?? []).map(mapRequest)
}

export async function getPurchaseRequest(id: string): Promise<PurchaseRequestRecord | null> {
  const supabase = await createClient()
  const [requestResult, receiptsResult] = await Promise.all([
    supabase
      .from('purchase_requests')
      .select(REQUEST_SELECT)
      .eq('id', id)
      .maybeSingle(),
    supabase
      .from('goods_receipts')
      .select(`
        id,
        po_number,
        received_date,
        status,
        posted_at,
        cancellation_note,
        created_at,
        goods_receipt_items (
          id,
          line_number,
          inventory_item_id,
          lot_number,
          expiry_date,
          quantity,
          unit,
          inventory_items (ls_code, name)
        )
      `)
      .eq('purchase_request_id', id)
      .order('received_date', { ascending: false })
      .order('created_at', { ascending: false }),
  ])

  if (requestResult.error) throw new Error(`อ่านข้อมูลใบ PR ไม่สำเร็จ: ${requestResult.error.message}`)
  if (receiptsResult.error) throw new Error(`อ่านประวัติรับเข้าของใบ PR ไม่สำเร็จ: ${receiptsResult.error.message}`)
  if (!requestResult.data) return null

  const receiptHistory: PurchaseRequestReceiptRecord[] = receiptHistorySchema
    .array()
    .parse(receiptsResult.data ?? [])
    .map((receipt) => {
      const items = (receipt.goods_receipt_items ?? [])
        .sort((left, right) => left.line_number - right.line_number)
        .map(mapReceiptHistoryItem)

      return {
        id: receipt.id,
        poNumber: receipt.po_number,
        receivedDate: receipt.received_date,
        status: receipt.status,
        postedAt: receipt.posted_at,
        cancellationNote: receipt.cancellation_note,
        items,
      }
    })

  return {
    ...mapRequest(requestRowSchema.parse(requestResult.data)),
    receiptHistory,
  }
}

/** Preview only: create_purchase_request recomputes this sequence under its transaction lock. */
export async function listNextContractPurchaseSequences(contractIds: readonly number[]): Promise<Record<number, number>> {
  const nextByContract = Object.fromEntries(contractIds.map((contractId) => [contractId, 1])) as Record<number, number>
  if (contractIds.length === 0) return nextByContract

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('purchase_requests')
    .select('status, method_details')
    .eq('purchase_method', 'contract')
    .not('status', 'in', '(cancelled,reversed)')

  if (error) throw new Error(`อ่านลำดับการซื้อในสัญญาไม่สำเร็จ: ${error.message}`)

  const rows = z.object({
    status: z.enum(PURCHASE_REQUEST_STATUSES),
    method_details: z.record(z.unknown()).nullable().transform((value) => value ?? {}),
  }).array().parse(data ?? [])

  for (const row of rows) {
    const contractId = Number(row.method_details.contractId)
    const purchaseSequence = Number(row.method_details.purchaseSequence)
    if (!Number.isInteger(contractId) || !Number.isInteger(purchaseSequence) || purchaseSequence < 1) continue
    if (!(contractId in nextByContract)) continue
    nextByContract[contractId] = Math.max(nextByContract[contractId], purchaseSequence + 1)
  }

  return nextByContract
}

/** Every "ซื้อในสัญญา" PR against one contract, newest purchase first. */
export async function listContractPurchaseHistory(contractId: number): Promise<PurchaseRequestRecord[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('purchase_requests')
    .select(REQUEST_SELECT)
    .eq('purchase_method', 'contract')

  if (error) throw new Error(`อ่านประวัติการซื้อไม่สำเร็จ: ${error.message}`)

  return requestRowSchema
    .array()
    .parse(data ?? [])
    .map(mapRequest)
    .filter((request) => Number(request.methodDetails.contractId) === contractId)
    .sort((left, right) => Number(right.methodDetails.purchaseSequence) - Number(left.methodDetails.purchaseSequence))
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
  purchase_request_items: z
    .array(
      z.object({
        requested_quantity: numericSchema,
        purchase_requests: z
          .object({ id: z.string().uuid(), status: z.enum(PURCHASE_REQUEST_STATUSES) })
          .nullable(),
      }),
    )
    .nullable()
    .default([]),
})

/**
 * Contract lines with quantity still available, for the PR item picker. Omit
 * the contract to load every active contract's lines for the picker at once.
 */
export async function listContractItemOptions(
  contractId?: number,
  excludePurchaseRequestId?: string,
  contractIds?: readonly number[],
): Promise<ContractItemOption[]> {
  if (contractIds && contractIds.length === 0) return []

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
      contract_item_allocations (quantity),
      purchase_request_items (
        requested_quantity,
        purchase_requests (id, status)
      )
    `)
    .order('line_number')

  if (contractId !== undefined) query = query.eq('contract_id', contractId)
  else if (contractIds) query = query.in('contract_id', [...contractIds])

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
      const pendingReserved = (row.purchase_request_items ?? [])
        .filter(
          (item) =>
            item.purchase_requests?.status === 'pending' &&
            item.purchase_requests.id !== excludePurchaseRequestId,
        )
        .reduce((sum, item) => sum + item.requested_quantity, 0)
      return {
        id: row.id,
        contractId: row.contract_id,
        contractName: row.contracts?.display_name?.trim() || row.contracts?.product || 'ไม่ระบุสัญญา',
        lsCode: row.ls_code,
        name: row.name,
        unit: row.unit,
        unitPrice: row.unit_price,
        contractedQuantity: row.quantity,
        remainingQuantity: roundQuantity(row.quantity - allocated - pendingReserved),
      }
    })
}
