'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { hasAppRole } from '@/lib/auth/access'
import { requireActor } from '@/lib/auth/actor'
import { assertStockOperator } from '@/lib/inventory/authorization'
import { getInventoryItem } from '@/lib/inventory/queries'
import {
  createInventoryItemInputSchema,
  inventoryMinimumStockSettingsInputSchema,
  minimumStockInputSchema,
  setInventoryItemActiveInputSchema,
  setInventoryLotActiveInputSchema,
  stockBalanceInputSchema,
  stockAdjustmentInputSchema,
  updateInventoryItemInputSchema,
} from '@/lib/inventory/schema'
import type {
  CreateInventoryItemInput,
  InventoryMinimumStockSettingsInput,
  MinimumStockInput,
  SetInventoryLotActiveInput,
  SetInventoryItemActiveInput,
  StockBalanceInput,
  StockAdjustmentInput,
  UpdateInventoryItemInput,
  InventoryItemSummary,
} from '@/lib/inventory/types'
import { supabaseAdmin } from '@/lib/supabase/admin'

const inventoryItemIdSchema = z.string().uuid()

async function requireStockOperator() {
  const actor = await requireActor()
  assertStockOperator(actor)
  return actor
}

function unwrapMutation(
  operation: string,
  result: { data: unknown; error: { message: string } | null },
) {
  if (result.error) throw new Error(`${operation}ไม่สำเร็จ: ${result.error.message}`)
  return z.object({ id: z.string().uuid() }).passthrough().parse(result.data)
}

export async function createInventoryItem(input: CreateInventoryItemInput) {
  const actor = await requireStockOperator()
  const parsed = createInventoryItemInputSchema.parse(input)

  const result = await supabaseAdmin.rpc('create_inventory_item', {
    p_ls_code: parsed.lsCode,
    p_name: parsed.name,
    p_base_unit: parsed.baseUnit,
    p_responsible_department: parsed.responsibleDepartment ?? null,
    p_default_unit_price: parsed.defaultUnitPrice ?? null,
    p_minimum_stock_months: parsed.minimumStockMonths,
    p_note: parsed.note ?? null,
    p_actor_id: actor.id,
  })

  if (result.error) {
    if (result.error.message.toLowerCase().includes('inventory_items_ls_code_normalized_key')) {
      throw new Error('สร้างรายการน้ำยาไม่สำเร็จ: รหัสพัสดุนี้มีอยู่ในคลังแล้ว')
    }
    throw new Error(`สร้างรายการน้ำยาไม่สำเร็จ: ${result.error.message}`)
  }

  const created = z.object({ id: z.string().uuid() }).passthrough().parse(result.data)
  revalidatePath('/inventory')
  revalidatePath('/purchase-requests/new')
  revalidatePath('/receipts/new')
  revalidatePath('/requisitions/new')
  return created
}

export async function updateInventoryItem(itemId: string, input: UpdateInventoryItemInput) {
  const actor = await requireStockOperator()
  const parsedItemId = inventoryItemIdSchema.parse(itemId)
  const parsed = updateInventoryItemInputSchema.parse(input)

  const result = await supabaseAdmin.rpc('update_inventory_item', {
    p_inventory_item_id: parsedItemId,
    p_actor_id: actor.id,
    p_name: parsed.name,
    p_base_unit: parsed.baseUnit,
    p_responsible_department: parsed.responsibleDepartment ?? null,
    p_default_unit_price: parsed.defaultUnitPrice ?? null,
    p_note: parsed.note ?? null,
  })

  const updated = unwrapMutation('บันทึกการแก้ไขรายการน้ำยา', result)
  revalidatePath('/inventory')
  revalidatePath(`/inventory/${parsedItemId}`)
  return updated
}

export async function setInventoryItemActive(itemId: string, input: SetInventoryItemActiveInput) {
  const actor = await requireStockOperator()
  const parsedItemId = inventoryItemIdSchema.parse(itemId)
  const parsed = setInventoryItemActiveInputSchema.parse(input)

  const result = await supabaseAdmin.rpc('set_inventory_item_active', {
    p_inventory_item_id: parsedItemId,
    p_actor_id: actor.id,
    p_is_active: parsed.isActive,
  })

  const updated = unwrapMutation(
    parsed.isActive ? 'เปิดใช้งานรายการน้ำยา' : 'ปิดใช้งานรายการน้ำยา',
    result,
  )
  revalidatePath('/inventory')
  revalidatePath(`/inventory/${parsedItemId}`)
  return updated
}

export async function setInventoryLotActive(
  lotId: string,
  inventoryItemId: string,
  input: SetInventoryLotActiveInput,
) {
  const actor = await requireStockOperator()
  const parsedLotId = inventoryItemIdSchema.parse(lotId)
  const parsedItemId = inventoryItemIdSchema.parse(inventoryItemId)
  const parsed = setInventoryLotActiveInputSchema.parse(input)

  const result = await supabaseAdmin.rpc('set_inventory_lot_active', {
    p_inventory_lot_id: parsedLotId,
    p_actor_id: actor.id,
    p_is_active: parsed.isActive,
  })

  const updated = unwrapMutation(
    parsed.isActive ? 'เปิดใช้งาน Lot' : 'ปิดใช้งาน Lot',
    result,
  )
  revalidatePath('/inventory')
  revalidatePath(`/inventory/${parsedItemId}`)
  revalidatePath('/requisitions')
  revalidatePath('/requisitions/[id]', 'page')
  revalidatePath('/dashboard')
  return updated
}

export async function setMinimumStock(itemId: string, input: MinimumStockInput) {
  const actor = await requireStockOperator()
  const parsedItemId = inventoryItemIdSchema.parse(itemId)
  const parsed = minimumStockInputSchema.parse(input)

  // Reserve months is a system-wide setting now (setInventoryMinimumStockMonths
  // below); passing null here leaves the item's stored value untouched.
  const result = await supabaseAdmin.rpc('set_inventory_minimum_stock', {
    p_inventory_item_id: parsedItemId,
    p_actor_id: actor.id,
    p_minimum_stock_override: parsed.minimumStockOverride,
    p_minimum_stock_months: null,
    p_reason: parsed.reason ?? null,
  })

  const updated = unwrapMutation('บันทึกค่าขั้นต่ำ', result)
  revalidatePath('/inventory')
  revalidatePath(`/inventory/${parsedItemId}`)
  revalidatePath('/dashboard')
  return updated
}

/** Admin-only: one reserve-months value drives every item's suggested minimum. */
export async function setInventoryMinimumStockMonths(input: InventoryMinimumStockSettingsInput) {
  const actor = await requireActor()
  if (!hasAppRole(actor, 'admin')) throw new Error('เฉพาะผู้ดูแลระบบเท่านั้นที่ตั้งค่านี้ได้')
  const parsed = inventoryMinimumStockSettingsInputSchema.parse(input)

  const result = await supabaseAdmin.rpc('set_inventory_minimum_stock_months', {
    p_actor_id: actor.id,
    p_minimum_stock_months: parsed.minimumStockMonths,
  })

  if (result.error) throw new Error(`บันทึกจำนวนเดือนสำรองไม่สำเร็จ: ${result.error.message}`)
  const updated = z
    .object({ minimum_stock_months: z.union([z.number(), z.string()]).transform(Number) })
    .passthrough()
    .parse(result.data)
  revalidatePath('/inventory')
  revalidatePath('/dashboard')
  return updated
}

export async function recordStockAdjustment(itemId: string, input: StockAdjustmentInput) {
  const actor = await requireStockOperator()
  const parsedItemId = inventoryItemIdSchema.parse(itemId)
  const parsed = stockAdjustmentInputSchema.parse(input)

  // The database guard is the real authority: it locks the item row and rejects
  // any movement that would push the lot or item on-hand below zero.
  const result = await supabaseAdmin.rpc('record_stock_adjustment', {
    p_inventory_item_id: parsedItemId,
    p_actor_id: actor.id,
    p_quantity: parsed.quantity,
    p_reason: parsed.reason,
    p_inventory_lot_id: parsed.inventoryLotId,
    p_occurred_on: parsed.occurredOn ?? null,
  })

  const movement = unwrapMutation('ปรับยอดคงคลัง', result)
  revalidatePath('/inventory')
  revalidatePath(`/inventory/${parsedItemId}`)
  revalidatePath('/dashboard')
  return movement
}

/** Read the compact catalogue summary on demand, without loading every lot into the list page. */
export async function getInventoryItemSummary(itemId: string): Promise<InventoryItemSummary | null> {
  await requireActor()
  const parsedItemId = inventoryItemIdSchema.parse(itemId)
  const item = await getInventoryItem(parsedItemId)
  if (!item) return null

  return {
    id: item.id,
    lsCode: item.lsCode,
    name: item.name,
    baseUnit: item.baseUnit,
    responsibleDepartment: item.responsibleDepartment,
    note: item.note,
    defaultUnitPrice: item.defaultUnitPrice,
    isActive: item.isActive,
    onHand: item.onHand,
    minimumStock: item.minimumStock,
    stockLevel: item.stockLevel,
    lots: item.lots,
  }
}

/** Set a counted balance; the RPC derives the signed adjustment under lock. */
export async function setStockBalance(itemId: string, input: StockBalanceInput) {
  const actor = await requireStockOperator()
  const parsedItemId = inventoryItemIdSchema.parse(itemId)
  const parsed = stockBalanceInputSchema.parse(input)

  const result = await supabaseAdmin.rpc('set_stock_balance', {
    p_inventory_item_id: parsedItemId,
    p_actor_id: actor.id,
    p_target_quantity: parsed.targetQuantity,
    p_reason: parsed.reason,
    p_inventory_lot_id: parsed.inventoryLotId,
    p_lot_number: parsed.lotNumber,
    p_expiry_date: parsed.expiryDate,
    p_occurred_on: parsed.occurredOn ?? null,
  })

  const movement = unwrapMutation('ปรับยอดคงคลัง', result)
  revalidatePath('/inventory')
  revalidatePath(`/inventory/${parsedItemId}`)
  revalidatePath('/dashboard')
  return movement
}
