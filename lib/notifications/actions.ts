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
  const { error } = await supabaseAdmin
    .from('lab_stock_notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', parsedId)
    .eq('recipient_id', actor.id)
    .is('read_at', null)

  if (error) throw new Error(`ทำเครื่องหมายการแจ้งเตือนไม่สำเร็จ: ${error.message}`)
  revalidateNotificationViews()
}

export async function markAllNotificationsRead(): Promise<void> {
  const actor = await requireActor()
  if (!canOperateStock(actor)) return

  const { error } = await supabaseAdmin
    .from('lab_stock_notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('recipient_id', actor.id)
    .is('read_at', null)

  if (error) throw new Error(`ทำเครื่องหมายการแจ้งเตือนทั้งหมดไม่สำเร็จ: ${error.message}`)
  revalidateNotificationViews()
}
