import 'server-only'

import { z } from 'zod'
import { canOperateStock } from '@/lib/auth/access'
import type { Actor } from '@/lib/auth/actor'
import { supabaseAdmin } from '@/lib/supabase/admin'
import type { PurchaseRequestLineNotificationSummary } from './types'

const requestIdSchema = z.string().uuid()
const statusSchema = z.enum(['pending', 'succeeded', 'failed', 'unknown'])
const rowSchema = z.object({
  id: z.string().uuid(),
  status: statusSchema,
  sent_by: z.string().uuid(),
  created_at: z.string(),
  completed_at: z.string().nullable(),
  po_number: z.string(),
  error_message: z.string().nullable(),
  sender: z.object({ name: z.string().nullable() }).nullable(),
})

export async function getLatestPurchaseRequestLineNotification(
  purchaseRequestId: string,
  actor: Actor,
): Promise<PurchaseRequestLineNotificationSummary | null> {
  if (!canOperateStock(actor)) return null

  const parsedId = requestIdSchema.parse(purchaseRequestId)
  const { data, error } = await supabaseAdmin
    .from('purchase_request_line_notifications')
    .select(`
      id,
      status,
      sent_by,
      created_at,
      completed_at,
      po_number,
      error_message,
      sender:profiles!purchase_request_line_notifications_sent_by_fkey (name)
    `)
    .eq('purchase_request_id', parsedId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(`อ่านประวัติการแจ้ง LINE ไม่สำเร็จ: ${error.message}`)
  if (!data) return null

  const row = rowSchema.parse(data)
  return {
    id: row.id,
    status: row.status,
    sentByName: row.sender?.name?.trim() || null,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    poNumber: row.po_number,
    errorMessage: row.error_message,
  }
}
