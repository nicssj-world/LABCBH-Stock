import 'server-only'

import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { bangkokToday, listInventoryItems } from '@/lib/inventory/queries'
import type { InventoryItemRecord } from '@/lib/inventory/types'
import { isLotSelectable, rankLotsForFifo } from '@/lib/requisitions/fifo'
import { REQUISITION_STATUSES } from './schema'
import type {
  RequisitionItemRecord,
  RequisitionRecord,
  SelectableLot,
} from './types'

const numericSchema = z.union([z.number(), z.string()]).transform(Number).refine(Number.isFinite)

const requisitionAvailabilityRowSchema = z.object({
  inventory_item_id: z.string().uuid(),
  usable_on_hand: numericSchema,
  waiting_reserved: numericSchema,
  available_to_request: numericSchema,
})

const allocationRowSchema = z.object({
  id: z.string().uuid(),
  inventory_lot_id: z.string().uuid(),
  quantity: numericSchema,
  is_fifo_override: z.boolean(),
  override_reason: z.string().nullable(),
  inventory_lots: z.object({ lot_number: z.string(), expiry_date: z.string().nullable() }).nullable(),
})

const itemRowSchema = z.object({
  id: z.string().uuid(),
  line_number: z.number().int().positive(),
  inventory_item_id: z.string().uuid(),
  requested_quantity: numericSchema,
  fulfilled_quantity: numericSchema.nullable(),
  unit: z.string(),
  note: z.string().nullable(),
  inventory_items: z.object({ ls_code: z.string(), name: z.string() }).nullable(),
  requisition_lot_allocations: z.array(allocationRowSchema).nullable().default([]),
})

const requisitionRowSchema = z.object({
  id: z.string().uuid(),
  fiscal_year: z.number().int(),
  sequence_number: z.number().int(),
  document_number: z.string(),
  requester_id: z.string().uuid().nullable(),
  requester_name: z.string(),
  department: z.string(),
  desired_date: z.string(),
  status: z.enum(REQUISITION_STATUSES),
  note: z.string().nullable(),
  fulfilled_at: z.string().nullable(),
  fulfilled_by_name: z.string().nullable(),
  received_by_name: z.string().nullable(),
  signature: z.string().nullable(),
  signed_at: z.string().nullable(),
  created_at: z.string(),
  requisition_items: z.array(itemRowSchema).nullable().default([]),
})

const REQUISITION_SELECT = `
  id,
  fiscal_year,
  sequence_number,
  document_number,
  requester_id,
  requester_name,
  department,
  desired_date,
  status,
  note,
  fulfilled_at,
  fulfilled_by_name,
  received_by_name,
  signature,
  signed_at,
  created_at,
  requisition_items (
    id,
    line_number,
    inventory_item_id,
    requested_quantity,
    fulfilled_quantity,
    unit,
    note,
    inventory_items (ls_code, name),
    requisition_lot_allocations (
      id,
      inventory_lot_id,
      quantity,
      is_fifo_override,
      override_reason,
      inventory_lots (lot_number, expiry_date)
    )
  )
`

function mapItem(row: z.infer<typeof itemRowSchema>): RequisitionItemRecord {
  return {
    id: row.id,
    lineNumber: row.line_number,
    inventoryItemId: row.inventory_item_id,
    lsCode: row.inventory_items?.ls_code ?? '—',
    name: row.inventory_items?.name ?? '—',
    requestedQuantity: row.requested_quantity,
    fulfilledQuantity: row.fulfilled_quantity,
    unit: row.unit,
    note: row.note,
    allocations: (row.requisition_lot_allocations ?? []).map((allocation) => ({
      id: allocation.id,
      inventoryLotId: allocation.inventory_lot_id,
      lotNumber: allocation.inventory_lots?.lot_number ?? '—',
      expiryDate: allocation.inventory_lots?.expiry_date ?? null,
      quantity: allocation.quantity,
      isFifoOverride: allocation.is_fifo_override,
      overrideReason: allocation.override_reason,
    })),
  }
}

function mapRequisition(row: z.infer<typeof requisitionRowSchema>): RequisitionRecord {
  return {
    id: row.id,
    fiscalYear: row.fiscal_year,
    sequenceNumber: row.sequence_number,
    documentNumber: row.document_number,
    requesterId: row.requester_id,
    requesterName: row.requester_name,
    department: row.department,
    desiredDate: row.desired_date,
    status: row.status,
    note: row.note,
    fulfilledAt: row.fulfilled_at,
    fulfilledByName: row.fulfilled_by_name?.trim() || null,
    receivedByName: row.received_by_name,
    signature: row.signature,
    signedAt: row.signed_at,
    createdAt: row.created_at,
    items: (row.requisition_items ?? [])
      .sort((left, right) => left.line_number - right.line_number)
      .map(mapItem),
  }
}

export interface RequisitionFilters {
  status?: (typeof REQUISITION_STATUSES)[number]
  search?: string
  department?: string
}

export type RequisitionCatalogItem = InventoryItemRecord & {
  usableOnHand: number
  waitingReserved: number
  availableToRequest: number
}

/**
 * Catalogue for the requisition form. Physical on-hand remains useful for
 * context, but the picker must use the reservation-aware amount so one waiting
 * requisition cannot silently consume another requester's stock.
 */
export async function listRequisitionCatalog(): Promise<RequisitionCatalogItem[]> {
  const supabase = await createClient()
  const [{ data, error }, inventoryItems] = await Promise.all([
    supabase
      .from('inventory_item_requisition_availability')
      .select('inventory_item_id, usable_on_hand, waiting_reserved, available_to_request'),
    listInventoryItems({}),
  ])

  if (error) throw new Error(`อ่านยอดที่เบิกได้ไม่สำเร็จ: ${error.message}`)

  const availabilityByItem = new Map(
    requisitionAvailabilityRowSchema
      .array()
      .parse(data ?? [])
      .map((row) => [
        row.inventory_item_id,
        {
          usableOnHand: row.usable_on_hand,
          waitingReserved: row.waiting_reserved,
          availableToRequest: row.available_to_request,
        },
      ] as const),
  )

  return inventoryItems.map((item) => ({
    ...item,
    usableOnHand: availabilityByItem.get(item.id)?.usableOnHand ?? 0,
    waitingReserved: availabilityByItem.get(item.id)?.waitingReserved ?? 0,
    availableToRequest: availabilityByItem.get(item.id)?.availableToRequest ?? 0,
  }))
}

export async function listRequisitions(
  filters: RequisitionFilters = {},
): Promise<RequisitionRecord[]> {
  const supabase = await createClient()
  let query = supabase
    .from('requisitions')
    .select(REQUISITION_SELECT)
    .order('desired_date', { ascending: false })
    .order('sequence_number', { ascending: false })

  if (filters.status) query = query.eq('status', filters.status)
  if (filters.department) query = query.eq('department', filters.department)

  const search = filters.search?.trim().replace(/[,%()]/g, ' ')
  if (search) {
    query = query.or(
      `document_number.ilike.%${search}%,requester_name.ilike.%${search}%,department.ilike.%${search}%`,
    )
  }

  const { data, error } = await query
  if (error) throw new Error(`อ่านรายการใบเบิกไม่สำเร็จ: ${error.message}`)

  return requisitionRowSchema.array().parse(data ?? []).map(mapRequisition)
}

export async function getRequisition(id: string): Promise<RequisitionRecord | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('requisitions')
    .select(REQUISITION_SELECT)
    .eq('id', id)
    .maybeSingle()

  if (error) throw new Error(`อ่านข้อมูลใบเบิกไม่สำเร็จ: ${error.message}`)
  if (!data) return null

  return mapRequisition(requisitionRowSchema.parse(data))
}

const lotRowSchema = z.object({
  id: z.string().uuid(),
  inventory_item_id: z.string().uuid(),
  lot_number: z.string(),
  expiry_date: z.string().nullable(),
  received_date: z.string(),
  storage_location: z.string().nullable(),
  is_active: z.boolean(),
})

const lotBalanceRowSchema = z.object({
  inventory_lot_id: z.string().uuid(),
  balance: numericSchema,
})

/**
 * Lots for each requested item, already in issue order. Expired and empty lots
 * are returned but marked unselectable so the officer can see why they are not
 * an option rather than wondering where they went.
 */
export async function listSelectableLots(
  inventoryItemIds: string[],
): Promise<Map<string, SelectableLot[]>> {
  const byItem = new Map<string, SelectableLot[]>()
  if (inventoryItemIds.length === 0) return byItem

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('inventory_lots')
    .select('id, inventory_item_id, lot_number, expiry_date, received_date, storage_location, is_active')
    .in('inventory_item_id', inventoryItemIds)
    .eq('is_active', true)

  if (error) throw new Error(`อ่านข้อมูลล็อตไม่สำเร็จ: ${error.message}`)

  const lots = lotRowSchema.array().parse(data ?? [])
  if (lots.length === 0) return byItem

  const { data: balanceData, error: balanceError } = await supabase
    .from('inventory_lot_balances')
    .select('inventory_lot_id, balance')
    .in('inventory_lot_id', lots.map((lot) => lot.id))

  if (balanceError) throw new Error(`อ่านยอดคงเหลือรายล็อตไม่สำเร็จ: ${balanceError.message}`)

  const balances = new Map(
    lotBalanceRowSchema.array().parse(balanceData ?? []).map((row) => [row.inventory_lot_id, row.balance]),
  )
  const today = bangkokToday()

  for (const itemId of inventoryItemIds) {
    const itemLots = lots
      .filter((lot) => lot.inventory_item_id === itemId)
      .filter((lot) => lot.is_active)
      .map((lot) => ({
        id: lot.id,
        lotNumber: lot.lot_number,
        expiryDate: lot.expiry_date,
        receivedAt: lot.received_date,
        balance: balances.get(lot.id) ?? 0,
        storageLocation: lot.storage_location,
      }))

    byItem.set(
      itemId,
      rankLotsForFifo(itemLots).map((lot) => ({
        ...lot,
        selectable: isLotSelectable(lot, today),
      })),
    )
  }

  return byItem
}
