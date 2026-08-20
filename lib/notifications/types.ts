export type NotificationEventType = 'purchase_request_created' | 'requisition_created'
export type NotificationEntityType = 'purchase_request' | 'requisition'

export interface NotificationItem {
  id: string
  eventType: NotificationEventType
  entityType: NotificationEntityType
  entityId: string
  documentNumber: string
  title: string
  body: string
  href: string
  readAt: string | null
  resolvedAt: string | null
  createdAt: string
}

export interface NotificationSnapshot {
  enabled: boolean
  pendingPurchaseRequests: number
  waitingRequisitions: number
  unreadCount: number
  notifications: NotificationItem[]
}

export const EMPTY_NOTIFICATION_SNAPSHOT: NotificationSnapshot = {
  enabled: false,
  pendingPurchaseRequests: 0,
  waitingRequisitions: 0,
  unreadCount: 0,
  notifications: [],
}
