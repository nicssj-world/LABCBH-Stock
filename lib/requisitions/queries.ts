import 'server-only'

import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { bangkokToday } from '@/lib/inventory/queries'
import { isLotSelectable, rankLotsForFifo } from '@/lib/requisitions/fifo'
import { REQUISITION_STATUSES } from './schema'
import type {
  RequisitionItemRecord,
  RequisitionRecord,
  SelectableLot,
} from './types'

const numericSchema = z.union([z.number(), z.string()]).transform(Number).refine(Number.isFinite)

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
  requester_name: z.string(),
  department: z.string(),
  desired_date: z.string(),
  status: z.enum(REQUISITION_STATUSES),
  note: z.string().nullable(),
  fulfilled_at: z.string().nullable(),
  created_at: z.string(),
  fulfiller: z.object({ name: z.string().nullable() }).nullable(),
  requisition_items: z.array(itemRowSchema).nullable().default([]),
})

const REQUISITION_SELECT = `
  id,
  fiscal_year,
  sequence_number,
  document_number,
  requester_name,
  department,
  desired_date,
  status,
  note,
  fulfilled_at,
  created_at,
  fulfiller:profiles!requisitions_fulfilled_by_fkey (name),
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
    requesterName: row.requester_name,
    department: row.department,
    desiredDate: row.desired_date,
    status: row.status,
    note: row.note,
    fulfilledAt: row.fulfilled_at,
    fulfilledByName: row.fulfiller?.name ?? null,
    createdAt: row.created_at,
    items: (row.requisition_items ?? [])
      .sort((left, right) => left.line_number - right.line_number)
      .map(mapItem),
  }
}

export interface RequisitionFilters {
  status?: (typeof REQUISITION_STATUSES)[number]
  search?: string
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
    .select('id, inventory_item_id, lot_number, expiry_date, received_date, storage_location')
    .in('inventory_item_id', inventoryItemIds)

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
