'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireActor } from '@/lib/auth/actor'
import { assertStockOperator } from '@/lib/inventory/authorization'
import {
  createInventoryItemInputSchema,
  minimumStockInputSchema,
  stockAdjustmentInputSchema,
} from '@/lib/inventory/schema'
import type { CreateInventoryItemInput, MinimumStockInput, StockAdjustmentInput } from '@/lib/inventory/types'
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

export async function setMinimumStock(itemId: string, input: MinimumStockInput) {
  const actor = await requireStockOperator()
  const parsedItemId = inventoryItemIdSchema.parse(itemId)
  const parsed = minimumStockInputSchema.parse(input)

  const result = await supabaseAdmin.rpc('set_inventory_minimum_stock', {
    p_inventory_item_id: parsedItemId,
    p_actor_id: actor.id,
    p_minimum_stock_override: parsed.minimumStockOverride,
    p_minimum_stock_months: parsed.minimumStockMonths,
    p_reason: parsed.reason ?? null,
  })

  const updated = unwrapMutation('บันทึกค่าขั้นต่ำ', result)
  revalidatePath('/inventory')
  revalidatePath(`/inventory/${parsedItemId}`)
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
