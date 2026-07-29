import 'server-only'

import { z } from 'zod'
import { roundQuantity } from '@/lib/inventory/balance'
import { createClient } from '@/lib/supabase/server'
import { GOODS_RECEIPT_STATUSES } from './schema'
import type { GoodsReceiptItemRecord, GoodsReceiptRecord } from './types'

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
  po_image_path: z.string().nullable(),
  status: z.enum(GOODS_RECEIPT_STATUSES),
  note: z.string().nullable(),
  posted_at: z.string().nullable(),
  created_at: z.string(),
  purchase_requests: z.object({ document_number: z.string() }).nullable(),
  poster: z.object({ name: z.string().nullable() }).nullable(),
  goods_receipt_items: z.array(itemRowSchema).nullable().default([]),
})

const RECEIPT_SELECT = `
  id,
  fiscal_year,
  purchase_request_id,
  po_number,
  department,
  received_date,
  receiver_name,
  po_image_path,
  status,
  note,
  posted_at,
  created_at,
  purchase_requests (document_number),
  poster:profiles!goods_receipts_posted_by_fkey (name),
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
    poNumber: row.po_number,
    department: row.department,
    receivedDate: row.received_date,
    receiverName: row.receiver_name,
    poImagePath: row.po_image_path,
    status: row.status,
    note: row.note,
    postedAt: row.posted_at,
    postedByName: row.poster?.name ?? null,
    createdAt: row.created_at,
    items,
    totalQuantity: roundQuantity(items.reduce((sum, item) => sum + item.quantity, 0)),
  }
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

  const search = filters.search?.trim().replace(/[,%()]/g, ' ')
  if (search) {
    query = query.or(`po_number.ilike.%${search}%,receiver_name.ilike.%${search}%`)
  }

  const { data, error } = await query
  if (error) throw new Error(`อ่านรายการรับเข้าไม่สำเร็จ: ${error.message}`)

  const headerMatches = receiptRowSchema.array().parse(data ?? []).map(mapReceipt)
  if (!search) return headerMatches

  const lineMatches = await findReceiptsByLine(search, filters.status)
  const byId = new Map(headerMatches.map((receipt) => [receipt.id, receipt]))
  for (const receipt of lineMatches) byId.set(receipt.id, receipt)

  return [...byId.values()].sort((left, right) =>
    right.receivedDate.localeCompare(left.receivedDate),
  )
}

/** Officers also search by PR number, LS code, or reagent name. */
async function findReceiptsByLine(
  search: string,
  status?: (typeof GOODS_RECEIPT_STATUSES)[number],
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
  Array<{ id: string; documentNumber: string; poNumber: string | null }>
> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('purchase_requests')
    .select('id, document_number, po_number')
    .eq('status', 'completed')
    .order('sequence_number', { ascending: false })

  if (error) throw new Error(`อ่านรายการใบ PR ไม่สำเร็จ: ${error.message}`)

  return z
    .object({
      id: z.string().uuid(),
      document_number: z.string(),
      po_number: z.string().nullable(),
    })
    .array()
    .parse(data ?? [])
    .map((row) => ({ id: row.id, documentNumber: row.document_number, poNumber: row.po_number }))
}
