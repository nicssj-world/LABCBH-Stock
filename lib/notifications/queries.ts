import 'server-only'

import { canOperateStock } from '@/lib/auth/access'
import type { Actor } from '@/lib/auth/actor'
import { supabaseAdmin } from '@/lib/supabase/admin'
import type {
  NotificationEntityType,
  NotificationEventType,
  NotificationItem,
  NotificationSnapshot,
} from '@/lib/notifications/types'
import { EMPTY_NOTIFICATION_SNAPSHOT } from '@/lib/notifications/types'

const NOTIFICATION_SELECT =
  'id,event_type,entity_type,entity_id,document_number,title,body,href,read_at,resolved_at,created_at'

interface NotificationRow {
  id: string
  event_type: NotificationEventType
  entity_type: NotificationEntityType
  entity_id: string
  document_number: string
  title: string
  body: string
  href: string
  read_at: string | null
  resolved_at: string | null
  created_at: string
}

interface QueryError {
  message: string
  code?: string
}

function parseNotification(row: NotificationRow): NotificationItem {
  return {
    id: row.id,
    eventType: row.event_type,
    entityType: row.entity_type,
    entityId: row.entity_id,
    documentNumber: row.document_number,
    title: row.title,
    body: row.body,
    href: row.href,
    readAt: row.read_at,
    resolvedAt: row.resolved_at,
    createdAt: row.created_at,
  }
}

function throwQueryError(operation: string, error: QueryError | null): void {
  if (error) throw new Error(`${operation}ไม่สำเร็จ: ${error.message}`)
}

function isNotificationTableMissing(error: QueryError | null): boolean {
  return error?.code === '42P01' || error?.code === 'PGRST205'
}

export async function getNotificationSnapshot(actor: Actor): Promise<NotificationSnapshot> {
  if (!canOperateStock(actor)) return EMPTY_NOTIFICATION_SNAPSHOT

  const [purchaseRequests, requisitions, unread, recent] = await Promise.all([
    supabaseAdmin
      .from('purchase_requests')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending'),
    supabaseAdmin
      .from('requisitions')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'waiting'),
    supabaseAdmin
      .from('lab_stock_notifications')
      .select('id', { count: 'exact', head: true })
      .eq('recipient_id', actor.id)
      .is('read_at', null),
    supabaseAdmin
      .from('lab_stock_notifications')
      .select(NOTIFICATION_SELECT)
      .eq('recipient_id', actor.id)
      .order('created_at', { ascending: false })
      .limit(12),
  ])

  throwQueryError('อ่านจำนวน PR ที่รอดำเนินการ', purchaseRequests.error)
  throwQueryError('อ่านจำนวนใบเบิกที่รอจ่าย', requisitions.error)

  const notificationError = unread.error ?? recent.error
  if (isNotificationTableMissing(notificationError)) {
    return {
      enabled: false,
      pendingPurchaseRequests: purchaseRequests.count ?? 0,
      waitingRequisitions: requisitions.count ?? 0,
      unreadCount: 0,
      notifications: [],
    }
  }

  throwQueryError('อ่านจำนวนการแจ้งเตือนที่ยังไม่อ่าน', unread.error)
  throwQueryError('อ่านประวัติการแจ้งเตือน', recent.error)

  return {
    enabled: true,
    pendingPurchaseRequests: purchaseRequests.count ?? 0,
    waitingRequisitions: requisitions.count ?? 0,
    unreadCount: unread.count ?? 0,
    notifications: ((recent.data ?? []) as NotificationRow[]).map(parseNotification),
  }
}
