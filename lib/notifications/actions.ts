'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { canOperateStock } from '@/lib/auth/access'
import { requireActor } from '@/lib/auth/actor'
import { supabaseAdmin } from '@/lib/supabase/admin'

const notificationIdSchema = z.string().uuid()

function revalidateNotificationViews() {
  revalidatePath('/dashboard')
  revalidatePath('/purchase-requests')
  revalidatePath('/requisitions')
}

export async function markNotificationRead(notificationId: string): Promise<void> {
  const actor = await requireActor()
  if (!canOperateStock(actor)) return

  const parsedId = notificationIdSchema.parse(notificationId)
  // The RPC re-checks the recipient itself. This call runs as the service
  // role, so that check has to live in the database rather than in the
  // filter chain of whichever caller happens to be writing next.
  const { error } = await supabaseAdmin.rpc('mark_lab_stock_notification_read', {
    p_actor_id: actor.id,
    p_notification_id: parsedId,
  })

  if (error) throw new Error(`ทำเครื่องหมายการแจ้งเตือนไม่สำเร็จ: ${error.message}`)
  revalidateNotificationViews()
}

export async function markAllNotificationsRead(): Promise<void> {
  const actor = await requireActor()
  if (!canOperateStock(actor)) return

  const { error } = await supabaseAdmin.rpc('mark_all_lab_stock_notifications_read', {
    p_actor_id: actor.id,
  })

  if (error) throw new Error(`ทำเครื่องหมายการแจ้งเตือนทั้งหมดไม่สำเร็จ: ${error.message}`)
  revalidateNotificationViews()
}
