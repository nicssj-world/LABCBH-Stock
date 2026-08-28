import 'server-only'

import { z } from 'zod'
import { PURCHASE_METHODS, PURCHASE_METHODS_BY_PURPOSE } from '@/lib/pr/schema'
import type { PurchaseMethodKind } from '@/lib/pr/schema'
import { canClassifyExecutivePurchaseReceipt } from '@/lib/dashboard/purchase-classification'
import { fiscalYearRange } from '@/lib/service-procurement/domain'
import { createClient } from '@/lib/supabase/server'
import { GOODS_RECEIPT_STATUSES } from './schema'
import type {
  GoodsReceiptItemRecord,
  GoodsReceiptRecord,
  ReceivablePurchaseRequest,
} from './types'

const numericSchema = z.union([z.number(), z.string()]).transform(Number).refine(Number.isFinite)

const itemRowSchema = z.object({
  id: z.string().uuid(),
  line_number: z.number().int().positive(),
  inventory_item_id: z.string().uuid(),
  lot_number: z.string(),
  expiry_date: z.string().nullable(),
  quantity: numericSchema,
  unit: z.string(),
  storage_location: z.string().nullable(),
  inventory_lot_id: z.string().uuid().nullable(),
  inventory_items: z.object({ ls_code: z.string(), name: z.string() }).nullable(),
})

const receiptRowSchema = z.object({
  id: z.string().uuid(),
  fiscal_year: z.number().int(),
  purchase_request_id: z.string().uuid().nullable(),
  po_number: z.string().nullable(),
  department: z.string(),
  received_date: z.string(),
  receiver_name: z.string(),
  status: z.enum(GOODS_RECEIPT_STATUSES),
  note: z.string().nullable(),
  posted_at: z.string().nullable(),
  cancelled_at: z.string().nullable(),
  cancellation_note: z.string().nullable(),
  created_at: z.string(),
  purchase_requests: z.object({ document_number: z.string(), po_number: z.string().nullable() }).nullable(),
  poster: z.object({ name: z.string().nullable() }).nullable(),
  canceller: z.object({ name: z.string().nullable() }).nullable(),
  goods_receipt_items: z.array(itemRowSchema).nullable().default([]),
})

const contractItemRelationSchema = z.object({
  contract_id: numericSchema.pipe(z.number().int().positive()),
})

const qualityPurchaseItemRowSchema = z.object({
  purchase_request_id: z.string().uuid(),
  inventory_item_id: z.string().uuid(),
  unit_price: numericSchema.nullable(),
  contract_item_id: z.string().nullable(),
  contract_items: z.union([
    contractItemRelationSchema,
    z.array(contractItemRelationSchema),
  ]).nullable().optional(),
})

const qualityPurchaseRequestRowSchema = z.object({
  id: z.string().uuid(),
  purchase_method: z.enum(PURCHASE_METHODS),
})

const qualityContractRowSchema = z.object({
  id: numericSchema.pipe(z.number().int().positive()),
  contract_type: z.string().nullable(),
})

const RECEIPT_SELECT = `
  id,
  fiscal_year,
  purchase_request_id,
  po_number,
  department,
  received_date,
  receiver_name,
  status,
  note,
  posted_at,
  cancelled_at,
  cancellation_note,
  created_at,
  purchase_requests!goods_receipts_purchase_request_id_fkey (document_number, po_number),
  poster:profiles!goods_receipts_posted_by_fkey (name),
  canceller:profiles!goods_receipts_cancelled_by_fkey (name),
  goods_receipt_items (
    id,
    line_number,
    inventory_item_id,
    lot_number,
    expiry_date,
    quantity,
    unit,
    storage_location,
    inventory_lot_id,
    inventory_items (ls_code, name)
  )
`

export interface GoodsReceiptFilters {
  status?: (typeof GOODS_RECEIPT_STATUSES)[number]
  search?: string
  department?: string
  fiscalYear?: number
  dataQualityOnly?: boolean
}

function mapItem(row: z.infer<typeof itemRowSchema>): GoodsReceiptItemRecord {
  return {
    id: row.id,
    lineNumber: row.line_number,
    inventoryItemId: row.inventory_item_id,
    lsCode: row.inventory_items?.ls_code ?? '—',
    name: row.inventory_items?.name ?? '—',
    lotNumber: row.lot_number,
    expiryDate: row.expiry_date,
    quantity: row.quantity,
    unit: row.unit,
    storageLocation: row.storage_location,
    inventoryLotId: row.inventory_lot_id,
  }
}

function mapReceipt(row: z.infer<typeof receiptRowSchema>): GoodsReceiptRecord {
  const items = (row.goods_receipt_items ?? [])
    .sort((left, right) => left.line_number - right.line_number)
    .map(mapItem)

  return {
    id: row.id,
    fiscalYear: row.fiscal_year,
    purchaseRequestId: row.purchase_request_id,
    purchaseRequestNumber: row.purchase_requests?.document_number ?? null,
    poNumber: row.purchase_requests?.po_number ?? row.po_number,
    department: row.department,
    receivedDate: row.received_date,
    receiverName: row.receiver_name,
    status: row.status,
    note: row.note,
    postedAt: row.posted_at,
    postedByName: row.poster?.name ?? null,
    cancelledAt: row.cancelled_at,
    cancelledByName: row.canceller?.name ?? null,
    cancellationNote: row.cancellation_note,
    createdAt: row.created_at,
    items,
  }
}

function relationContractId(
  relation: z.infer<typeof contractItemRelationSchema> | z.infer<typeof contractItemRelationSchema>[] | null | undefined,
): number | null {
  if (!relation) return null
  const row = Array.isArray(relation) ? relation[0] : relation
  return row?.contract_id ?? null
}

async function findDataQualityReceiptIds(receipts: GoodsReceiptRecord[]): Promise<Set<string>> {
  const candidates = receipts.filter((receipt) => receipt.status === 'posted')
  if (candidates.length === 0) return new Set()

  const requestIds = [...new Set(candidates
    .map((receipt) => receipt.purchaseRequestId)
    .filter((id): id is string => Boolean(id)))]
  const supabase = await createClient()
  const [purchaseItemsResult, purchaseRequestsResult] = await Promise.all([
    requestIds.length
      ? supabase
        .from('purchase_request_items')
        .select('purchase_request_id, inventory_item_id, unit_price, contract_item_id, contract_items (contract_id)')
        .in('purchase_request_id', requestIds)
      : Promise.resolve({ data: [], error: null }),
    requestIds.length
      ? supabase
        .from('purchase_requests')
        .select('id, purchase_method')
        .in('id', requestIds)
      : Promise.resolve({ data: [], error: null }),
  ])

  if (purchaseItemsResult.error) throw new Error(`อ่านรายการ PR เพื่อตรวจสอบใบรับเข้าไม่สำเร็จ: ${purchaseItemsResult.error.message}`)
  if (purchaseRequestsResult.error) throw new Error(`อ่านวิธีจัดซื้อของ PR เพื่อตรวจสอบใบรับเข้าไม่สำเร็จ: ${purchaseRequestsResult.error.message}`)

  const purchaseItems = qualityPurchaseItemRowSchema.array().parse(purchaseItemsResult.data ?? [])
  const purchaseRequests = qualityPurchaseRequestRowSchema.array().parse(purchaseRequestsResult.data ?? [])
  const purchaseMethodsByRequestId = new Map<string, PurchaseMethodKind>(
    purchaseRequests.map((request) => [request.id, request.purchase_method]),
  )
  const sourceByKey = new Map(purchaseItems.map((item) => [
    `${item.purchase_request_id}:${item.inventory_item_id}`,
    item,
  ]))
  const contractIds = [...new Set(purchaseItems
    .map((item) => relationContractId(item.contract_items))
    .filter((id): id is number => id !== null))]
  const contractsResult = contractIds.length
    ? await supabase.from('contracts').select('id, contract_type').in('id', contractIds)
    : { data: [], error: null }

  if (contractsResult.error) throw new Error(`อ่านประเภทสัญญาเพื่อตรวจสอบใบรับเข้าไม่สำเร็จ: ${contractsResult.error.message}`)

  const contractTypes = new Map(
    qualityContractRowSchema.array().parse(contractsResult.data ?? []).map((contract) => [contract.id, contract.contract_type]),
  )
  const flaggedIds = new Set<string>()

  for (const receipt of candidates) {
    const purchaseRequestId = receipt.purchaseRequestId

    if (!purchaseRequestId || receipt.items.length === 0) {
      flaggedIds.add(receipt.id)
      continue
    }

    const needsReview = receipt.items.some((item) => {
      const source = sourceByKey.get(`${purchaseRequestId}:${item.inventoryItemId}`)
      if (!source || source.unit_price === null) return true

      const contractId = relationContractId(source.contract_items)
      const contractType = contractId === null ? null : contractTypes.get(contractId)
      const purchaseMethod = purchaseMethodsByRequestId.get(purchaseRequestId)
      return !canClassifyExecutivePurchaseReceipt(purchaseMethod, contractId, contractType)
    })
    if (needsReview) flaggedIds.add(receipt.id)
  }

  return flaggedIds
}

export async function listGoodsReceipts(
  filters: GoodsReceiptFilters = {},
): Promise<GoodsReceiptRecord[]> {
  const supabase = await createClient()
  let query = supabase
    .from('goods_receipts')
    .select(RECEIPT_SELECT)
    .order('received_date', { ascending: false })
    .order('created_at', { ascending: false })

  if (filters.status) query = query.eq('status', filters.status)
  if (filters.department) query = query.eq('department', filters.department)
  if (filters.fiscalYear) {
    const range = fiscalYearRange(filters.fiscalYear)
    query = query.gte('received_date', range.start).lte('received_date', range.end)
  }

  const search = filters.search?.trim().replace(/[,%()]/g, ' ')
  if (search) {
    query = query.or(`po_number.ilike.%${search}%,receiver_name.ilike.%${search}%`)
  }

  const { data, error } = await query
  if (error) throw new Error(`อ่านรายการรับเข้าไม่สำเร็จ: ${error.message}`)

  const headerMatches = receiptRowSchema.array().parse(data ?? []).map(mapReceipt)
  const receipts = !search
    ? headerMatches
    : await findReceiptsByLine(search, filters.status, filters.department, filters.fiscalYear).then((lineMatches) => {
      const byId = new Map(headerMatches.map((receipt) => [receipt.id, receipt]))
      for (const receipt of lineMatches) byId.set(receipt.id, receipt)
      return [...byId.values()].sort((left, right) => right.receivedDate.localeCompare(left.receivedDate))
    })

  if (!filters.dataQualityOnly) return receipts

  const flaggedIds = await findDataQualityReceiptIds(receipts)
  return receipts.filter((receipt) => flaggedIds.has(receipt.id))
}

/** Officers also search by PR number, LS code, or reagent name. */
async function findReceiptsByLine(
  search: string,
  status?: (typeof GOODS_RECEIPT_STATUSES)[number],
  department?: string,
  fiscalYear?: number,
): Promise<GoodsReceiptRecord[]> {
  const supabase = await createClient()

  const [itemResult, requestResult] = await Promise.all([
    supabase.from('inventory_items').select('id').or(`ls_code.ilike.%${search}%,name.ilike.%${search}%`),
    supabase.from('purchase_requests').select('id').ilike('document_number', `%${search}%`),
  ])

  if (itemResult.error) throw new Error(`ค้นหาน้ำยาไม่สำเร็จ: ${itemResult.error.message}`)
  if (requestResult.error) throw new Error(`ค้นหาใบ PR ไม่สำเร็จ: ${requestResult.error.message}`)

  const idSchema = z.object({ id: z.string().uuid() }).array()
  const itemIds = idSchema.parse(itemResult.data ?? []).map((row) => row.id)
  const requestIds = idSchema.parse(requestResult.data ?? []).map((row) => row.id)

  const receiptIds = new Set<string>()

  if (itemIds.length > 0) {
    const { data, error } = await supabase
      .from('goods_receipt_items')
      .select('goods_receipt_id')
      .in('inventory_item_id', itemIds)

    if (error) throw new Error(`ค้นหารายการรับเข้าไม่สำเร็จ: ${error.message}`)
    for (const row of z.object({ goods_receipt_id: z.string().uuid() }).array().parse(data ?? [])) {
      receiptIds.add(row.goods_receipt_id)
    }
  }

  if (receiptIds.size === 0 && requestIds.length === 0) return []

  let query = supabase.from('goods_receipts').select(RECEIPT_SELECT)
  query =
    receiptIds.size > 0 && requestIds.length > 0
      ? query.or(`id.in.(${[...receiptIds].join(',')}),purchase_request_id.in.(${requestIds.join(',')})`)
      : receiptIds.size > 0
        ? query.in('id', [...receiptIds])
        : query.in('purchase_request_id', requestIds)

  if (status) query = query.eq('status', status)
  if (department) query = query.eq('department', department)
  if (fiscalYear) {
    const range = fiscalYearRange(fiscalYear)
    query = query.gte('received_date', range.start).lte('received_date', range.end)
  }

  const { data, error } = await query
  if (error) throw new Error(`อ่านรายการรับเข้าไม่สำเร็จ: ${error.message}`)

  return receiptRowSchema.array().parse(data ?? []).map(mapReceipt)
}

export async function getGoodsReceipt(id: string): Promise<GoodsReceiptRecord | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('goods_receipts')
    .select(RECEIPT_SELECT)
    .eq('id', id)
    .maybeSingle()

  if (error) throw new Error(`อ่านข้อมูลใบรับเข้าไม่สำเร็จ: ${error.message}`)
  if (!data) return null

  return mapReceipt(receiptRowSchema.parse(data))
}

/** Confirmed PRs are what receiving is normally matched against. */
export async function listReceivablePurchaseRequests(): Promise<
  ReceivablePurchaseRequest[]
> {
  const supabase = await createClient()
  const [requestsResult, receiptsResult] = await Promise.all([
    supabase
      .from('purchase_requests')
      .select(`
        id,
        document_number,
        po_number,
        department,
        status,
        purchase_request_items (
          line_number,
          inventory_item_id,
          requested_quantity,
          received_quantity,
          remaining_quantity,
          unit,
          inventory_items (ls_code, name)
        )
      `)
      .in('status', ['completed', 'partially_received'])
      // A PR that opened a brand-new contract (specific_contract/e_bidding) has
      // no goods to receive against a PO — it already produced a contract, not
      // an order. Only the ordinary drawdown methods belong here.
      .in('purchase_method', PURCHASE_METHODS_BY_PURPOSE.purchase_order)
      .order('sequence_number', { ascending: false }),
    // Posted receipts no longer close a PR; only an unfinished draft prevents a
    // second officer from opening another draft for the same PR.
    supabase
      .from('goods_receipts')
      .select('purchase_request_id')
      .not('purchase_request_id', 'is', null)
      .eq('status', 'draft'),
  ])

  if (requestsResult.error) throw new Error(`อ่านรายการใบ PR ไม่สำเร็จ: ${requestsResult.error.message}`)
  if (receiptsResult.error) throw new Error(`อ่านใบ PR ที่ถูกอ้างอิงแล้วไม่สำเร็จ: ${receiptsResult.error.message}`)

  const rowSchema = z.object({
    id: z.string().uuid(),
    document_number: z.string(),
    po_number: z.string().nullable(),
    department: z.string(),
    status: z.enum(['completed', 'partially_received']),
    purchase_request_items: z.array(z.object({
      line_number: z.number().int().positive(),
      inventory_item_id: z.string().uuid(),
      requested_quantity: numericSchema,
      received_quantity: numericSchema,
      remaining_quantity: numericSchema,
      unit: z.string(),
      inventory_items: z.object({ ls_code: z.string(), name: z.string() }).nullable(),
    })).nullable().default([]),
  })

  const draftRequestIds = new Set(
    z.object({ purchase_request_id: z.string().uuid().nullable() })
      .array()
      .parse(receiptsResult.data ?? [])
      .flatMap((row) => row.purchase_request_id ? [row.purchase_request_id] : []),
  )

  return rowSchema.array().parse(requestsResult.data ?? [])
    .filter((row) => !draftRequestIds.has(row.id))
    .map((row) => ({
      id: row.id,
      documentNumber: row.document_number,
      poNumber: row.po_number,
      department: row.department,
      status: row.status,
      items: (row.purchase_request_items ?? [])
        .sort((left, right) => left.line_number - right.line_number)
        .map((item) => ({
          inventoryItemId: item.inventory_item_id,
          lsCode: item.inventory_items?.ls_code ?? '—',
          name: item.inventory_items?.name ?? 'ไม่ระบุรายการ',
          requestedQuantity: item.requested_quantity,
          receivedQuantity: item.received_quantity,
          remainingQuantity: item.remaining_quantity,
          unit: item.unit,
        })),
    }))
}
