'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { createClient } from '@/lib/supabase/client'
import { markAllNotificationsRead, markNotificationRead } from '@/lib/notifications/actions'
import type { NotificationEntityType, NotificationEventType, NotificationItem, NotificationSnapshot } from '@/lib/notifications/types'

interface NotificationCenterProps {
  actorId: string
  snapshot: NotificationSnapshot
  onSnapshotChange: Dispatch<SetStateAction<NotificationSnapshot>>
}

function BellIcon() {
  return (
    <svg className="utility-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Z" />
      <path d="M10 21h4" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg className="utility-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  )
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function asNullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : asString(value)
}

function toNotification(row: Record<string, unknown>): NotificationItem | null {
  const eventType = row.event_type
  const entityType = row.entity_type
  const id = asString(row.id)
  const entityId = asString(row.entity_id)
  const documentNumber = asString(row.document_number)
  const title = asString(row.title)
  const body = asString(row.body)
  const href = asString(row.href)
  const createdAt = asString(row.created_at)

  if (
    !['purchase_request_created', 'requisition_created', 'service_purchase_request_created', 'service_purchase_order_cancelled'].includes(String(eventType)) ||
    !['purchase_request', 'requisition', 'service_purchase_request'].includes(String(entityType)) ||
    !id ||
    !entityId ||
    !documentNumber ||
    !title ||
    !body ||
    !href?.startsWith('/') ||
    !createdAt
  ) {
    return null
  }

  return {
    id,
    eventType: eventType as NotificationEventType,
    entityType: entityType as NotificationEntityType,
    entityId,
    documentNumber,
    title,
    body,
    href,
    readAt: asNullableString(row.read_at),
    resolvedAt: asNullableString(row.resolved_at),
    dismissedAt: asNullableString(row.dismissed_at),
    createdAt,
  }
}

function formatNotificationTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'ไม่ทราบเวลา'
  return new Intl.DateTimeFormat('th-TH', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date)
}

function displayCount(count: number): string {
  return count > 99 ? '99+' : String(count)
}

export function NotificationCenter({ actorId, snapshot, onSnapshotChange }: NotificationCenterProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [toast, setToast] = useState<NotificationItem | null>(null)
  const [busy, setBusy] = useState(false)
  const knownNotificationIds = useRef(new Set(snapshot.notifications.map((notification) => notification.id)))
  const panelId = `notification-center-${actorId}`
  const visibleNotifications = snapshot.notifications.filter(
    (notification) => !notification.resolvedAt && !notification.dismissedAt,
  )

  useEffect(() => {
    snapshot.notifications.forEach((notification) => knownNotificationIds.current.add(notification.id))
  }, [snapshot.notifications])

  useEffect(() => {
    if (!open) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [open])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 7000)
    return () => window.clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    if (!snapshot.enabled) return

    const supabase = createClient()
    const channel = supabase
      .channel(`lab-stock-notifications:${actorId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'lab_stock_notifications',
          filter: `recipient_id=eq.${actorId}`,
        },
        (payload) => {
          const notification = toNotification(payload.new)
          if (
            !notification ||
            notification.resolvedAt ||
            notification.dismissedAt ||
            knownNotificationIds.current.has(notification.id)
          ) return

          knownNotificationIds.current.add(notification.id)
          onSnapshotChange((current) => ({
            ...current,
            notifications: [notification, ...current.notifications].slice(0, 12),
            unreadCount: notification.readAt ? current.unreadCount : current.unreadCount + 1,
            pendingPurchaseRequests:
              notification.eventType === 'purchase_request_created'
                ? current.pendingPurchaseRequests + 1
                : current.pendingPurchaseRequests,
            waitingRequisitions:
              notification.eventType === 'requisition_created'
                ? current.waitingRequisitions + 1
                : current.waitingRequisitions,
          }))
          setToast(notification)
          router.refresh()
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'lab_stock_notifications',
          filter: `recipient_id=eq.${actorId}`,
        },
        (payload) => {
          const notification = toNotification(payload.new)
          if (!notification) return

          onSnapshotChange((current) => {
            const previous = current.notifications.find((item) => item.id === notification.id)
            if (!previous) return current

            const leavesQueue = Boolean(notification.resolvedAt || notification.dismissedAt)
            const unreadDelta = !previous.readAt && (notification.readAt || leavesQueue)
              ? -1
              : previous.readAt && !notification.readAt && !leavesQueue
                ? 1
                : 0
            const resolvedDelta = !previous.resolvedAt && notification.resolvedAt ? -1 : 0

            return {
              ...current,
              notifications: leavesQueue
                ? current.notifications.filter((item) => item.id !== notification.id)
                : current.notifications.map((item) => item.id === notification.id ? notification : item),
              unreadCount: Math.max(0, current.unreadCount + unreadDelta),
              pendingPurchaseRequests: notification.eventType === 'purchase_request_created'
                ? Math.max(0, current.pendingPurchaseRequests + resolvedDelta)
                : current.pendingPurchaseRequests,
              waitingRequisitions: notification.eventType === 'requisition_created'
                ? Math.max(0, current.waitingRequisitions + resolvedDelta)
                : current.waitingRequisitions,
            }
          })
          if (notification.resolvedAt || notification.dismissedAt) {
            setToast((current) => current?.id === notification.id ? null : current)
          }
          router.refresh()
        },
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [actorId, onSnapshotChange, router, snapshot.enabled])

  if (!snapshot.enabled) return null

  function optimisticallyMarkRead(notificationId: string) {
    onSnapshotChange((current) => {
      const notification = current.notifications.find((item) => item.id === notificationId)
      if (!notification || notification.readAt) return current
      return {
        ...current,
        notifications: current.notifications.map((item) => item.id === notificationId
          ? { ...item, readAt: new Date().toISOString() }
          : item),
        unreadCount: Math.max(0, current.unreadCount - 1),
      }
    })
    void markNotificationRead(notificationId).catch(() => router.refresh())
  }

  async function handleMarkAllRead() {
    if ((!snapshot.unreadCount && !visibleNotifications.length) || busy) return
    setBusy(true)
    onSnapshotChange((current) => ({
      ...current,
      notifications: [],
      unreadCount: 0,
    }))
    setToast(null)
    try {
      await markAllNotificationsRead()
      router.refresh()
    } catch {
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="notification-center">
      <button
        className="utility-button notification-center__trigger"
        type="button"
        aria-label={snapshot.unreadCount ? `การแจ้งเตือน มี ${snapshot.unreadCount} รายการที่ยังไม่ได้อ่าน` : 'การแจ้งเตือน'}
        aria-expanded={open}
        aria-controls={panelId}
        aria-haspopup="dialog"
        title="การแจ้งเตือน"
        onClick={() => setOpen((value) => !value)}
      >
        <BellIcon />
        {snapshot.unreadCount > 0 && (
          <span className="notification-center__badge" aria-hidden="true">{displayCount(snapshot.unreadCount)}</span>
        )}
      </button>

      {open && (
        <div className="notification-center__panel" id={panelId} role="dialog" aria-labelledby={`${panelId}-title`}>
          <div className="notification-center__panel-header">
            <div>
              <h2 id={`${panelId}-title`}>การแจ้งเตือน</h2>
            </div>
            <div className="notification-center__panel-actions">
              <button
                className="notification-center__mark-all"
                type="button"
                disabled={(!snapshot.unreadCount && !visibleNotifications.length) || busy}
                onClick={() => void handleMarkAllRead()}
              >
                อ่านทั้งหมด
              </button>
              <button className="notification-center__close" type="button" aria-label="ปิดการแจ้งเตือน" onClick={() => setOpen(false)}>
                <CloseIcon />
              </button>
            </div>
          </div>

          {visibleNotifications.length === 0 ? (
            <p className="notification-center__empty">ยังไม่มีการแจ้งเตือน</p>
          ) : (
            <ul className="notification-center__list">
              {visibleNotifications.map((notification) => (
                <li key={notification.id} className={`notification-center__item${notification.readAt ? '' : ' is-unread'}`}>
                  <Link
                    href={notification.href}
                    className="notification-center__item-link"
                    onClick={() => {
                      if (!notification.readAt) optimisticallyMarkRead(notification.id)
                      setOpen(false)
                    }}
                  >
                    <span className="notification-center__item-marker" aria-hidden="true" />
                    <span className="notification-center__item-copy">
                      <strong>{notification.title}</strong>
                      <span>{notification.body}</span>
                      <small>
                        {notification.documentNumber} · {formatNotificationTime(notification.createdAt)}
                      </small>
                    </span>
                    {!notification.readAt && <span className="visually-hidden">ยังไม่ได้อ่าน</span>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {toast && (
        <div className="notification-center__toast" role="status" aria-live="polite">
          <div className="notification-center__toast-copy">
            <p>การแจ้งเตือนใหม่</p>
            <strong>{toast.title}</strong>
            <span>{toast.documentNumber} · {toast.body}</span>
          </div>
          <div className="notification-center__toast-actions">
            <Link href={toast.href} onClick={() => { optimisticallyMarkRead(toast.id); setToast(null) }}>เปิดรายการ</Link>
            <button type="button" aria-label="ปิดการแจ้งเตือนใหม่" onClick={() => setToast(null)}>
              <CloseIcon />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
