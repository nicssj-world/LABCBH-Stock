/*
THESIS: A calm laboratory workspace should feel related to the Lab Management Portal.
OWN-WORLD: Portal-blue navigation, stock-green signals, quiet surfaces, crisp data hierarchy.
STORY: Staff always know where they are, who is signed in, and which action matters next.
FIRST VIEWPORT: Compact navigation, persistent page context, and an uninterrupted work canvas.
FORM: Enterprise healthcare dashboard, dense enough for operations and comfortable for touch.
*/
'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { startTransition, useEffect, useState, type ReactNode } from 'react'
import { LogoutButton } from '@/components/ui/LogoutButton'
import { NotificationCenter } from '@/components/notifications/NotificationCenter'
import { RouteProgress } from '@/components/ui/RouteProgress'
import type { Actor } from '@/lib/auth/actor'
import { EMPTY_NOTIFICATION_SNAPSHOT, type NotificationSnapshot } from '@/lib/notifications/types'

type BenchIconName = 'overview' | 'contract' | 'outlab' | 'pr' | 'receipt' | 'issue' | 'inventory' | 'settings'
type NavTone = 'blue' | 'violet' | 'teal' | 'cyan' | 'amber' | 'rose' | 'green' | 'slate'
const PORTAL_DASHBOARD_URL = 'https://lab-management-cbh.vercel.app/staff/dashboard'

interface NavigationItem {
  href: string
  label: string
  icon: BenchIconName
  tone: NavTone
}

const navigation: NavigationItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: 'overview', tone: 'blue' },
  { href: '/contracts', label: 'สัญญา', icon: 'contract', tone: 'violet' },
  { href: '/out-lab', label: 'Out Lab', icon: 'outlab', tone: 'teal' },
  { href: '/purchase-requests', label: 'ใบ PR', icon: 'pr', tone: 'cyan' },
  { href: '/receipts', label: 'รับเข้า', icon: 'receipt', tone: 'amber' },
  { href: '/requisitions', label: 'เบิกจ่าย', icon: 'issue', tone: 'rose' },
  { href: '/inventory', label: 'คงคลัง', icon: 'inventory', tone: 'green' },
]

// The route itself remains the final authorization boundary. Showing this
// entry only to admins avoids navigation that immediately redirects other users.
const adminNavigation: NavigationItem[] = [
  { href: '/settings/access', label: 'สิทธิ์ผู้ใช้งาน', icon: 'settings', tone: 'slate' },
]

function BenchIcon({ name }: { name: BenchIconName }) {
  const paths: Record<BenchIconName, ReactNode> = {
    overview: <><path d="M4 13h6V4H4v9Z" /><path d="M14 20h6V11h-6v9Z" /><path d="M4 20h6v-3H4v3Z" /><path d="M14 7h6V4h-6v3Z" /></>,
    contract: <><path d="M6 3h9l3 3v15H6V3Z" /><path d="M14 3v4h4" /><path d="M9 12h6M9 16h6" /></>,
    outlab: <><path d="M9 3h5M10 3v10.5a3 3 0 1 0 4 0V3" /><path d="M10 9h4" /><path d="M17 4h4v4" /><path d="M21 4l-4.5 4.5" /></>,
    pr: <><path d="M5 4h14v16H5V4Z" /><path d="M8 8h8M8 12h5M8 16h3" /></>,
    receipt: <><path d="M4 7h16v13H4V7Z" /><path d="M7 3h10v4H7V3Z" /><path d="M12 10v6m-3-3 3 3 3-3" /></>,
    issue: <><path d="M4 5h16v14H4V5Z" /><path d="M12 15V9m-3 3 3-3 3 3" /></>,
    inventory: <><path d="m4 7 8-4 8 4-8 4-8-4Z" /><path d="m4 7 8 4 8-4v10l-8 4-8-4V7Z" /><path d="M12 11v10" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z" /></>,
  }

  return (
    <svg className="bench-icon" viewBox="0 0 24 24" aria-hidden="true">
      {paths[name]}
    </svg>
  )
}

function UtilityIcon({ name, dark }: { name: 'menu' | 'appearance' | 'portal'; dark?: boolean }) {
  return (
    <svg className="utility-icon" viewBox="0 0 24 24" aria-hidden="true">
      {name === 'menu' && <><path d="M4 7h16M4 12h16M4 17h16" /></>}
      {name === 'appearance' && (dark ? (
        <path d="M20.2 15.2A8.5 8.5 0 0 1 8.8 3.8 8.5 8.5 0 1 0 20.2 15.2Z" />
      ) : (
        <><circle cx="12" cy="12" r="3.5" /><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" /></>
      ))}
      {name === 'portal' && <><path d="M14 4h5v5M19 4l-8 8" /><path d="M19 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5" /></>}
    </svg>
  )
}

export interface AppShellProps {
  actor: Actor
  children: ReactNode
  notificationSnapshot?: NotificationSnapshot
}

export function AppShell({ actor, children, notificationSnapshot = EMPTY_NOTIFICATION_SNAPSHOT }: AppShellProps) {
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [dark, setDark] = useState(false)
  const [notificationState, setNotificationState] = useState(notificationSnapshot)
  const actorLabel = actor.name ?? (actor.ephisId ? `E-Phis ${actor.ephisId}` : 'ผู้ใช้งาน')
  const visibleNavigation = [...navigation, ...(actor.appRoles.includes('admin') ? adminNavigation : [])]
  const currentItem = visibleNavigation.find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))

  useEffect(() => {
    startTransition(() => setNotificationState(notificationSnapshot))
  }, [notificationSnapshot])

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const savedTheme = localStorage.getItem('labcbh-theme') === 'dark'
      setDark(savedTheme)
      document.documentElement.dataset.theme = savedTheme ? 'dark' : 'light'
    })
    return () => window.cancelAnimationFrame(frame)
  }, [])

  useEffect(() => {
    if (!mobileOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [mobileOpen])

  useEffect(() => {
    // Scrolling over a focused number input must scroll the page, not silently
    // increment/decrement the value. Blurring preserves the native wheel
    // scroll and still leaves keyboard entry and the stepper controls intact.
    const blurNumberInputOnWheel = (event: WheelEvent) => {
      const target = event.target
      if (!(target instanceof HTMLInputElement) || target.type !== 'number') return
      target.blur()
    }

    document.addEventListener('wheel', blurNumberInputOnWheel, { passive: true })
    return () => document.removeEventListener('wheel', blurNumberInputOnWheel)
  }, [])

  function toggleTheme() {
    const nextDark = !dark
    setDark(nextDark)
    document.documentElement.dataset.theme = nextDark ? 'dark' : 'light'
    localStorage.setItem('labcbh-theme', nextDark ? 'dark' : 'light')
  }

  return (
    <RouteProgress>
      <div className="app-shell">
        <a className="skip-link" href="#main-content">ข้ามไปยังเนื้อหาหลัก</a>
        <button
          className={`bench-rail-overlay${mobileOpen ? ' is-open' : ''}`}
          type="button"
          aria-label="ปิดเมนูหลัก"
          tabIndex={mobileOpen ? 0 : -1}
          onClick={() => setMobileOpen(false)}
        />
        <aside className={`bench-rail${collapsed ? ' is-collapsed' : ''}${mobileOpen ? ' is-open' : ''}`} aria-label="เมนูหลัก">
          <div className="bench-brand">
            <Image
              className="bench-brand__logo"
              src="/images/cbh-lab-logo-v3.png"
              alt="CBH Lab"
              width={44}
              height={44}
              sizes="44px"
              preload
            />
            <span className="bench-brand__copy">
              <strong>LABCBH Stock</strong>
              <small>Laboratory Management</small>
            </span>
          </div>
          <p className="bench-nav__section">งานคลังและสัญญา</p>
          <nav className="bench-nav">
            {visibleNavigation.map((item) => (
              (() => {
                const count = item.href === '/purchase-requests'
                  ? notificationState.pendingPurchaseRequests
                  : item.href === '/requisitions'
                    ? notificationState.waitingRequisitions
                    : 0
                const countLabel = count > 0 ? ` มี ${count} รายการรอดำเนินการ` : ''

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="bench-nav__link"
                    aria-current={pathname === item.href || pathname.startsWith(`${item.href}/`) ? 'page' : undefined}
                    aria-label={collapsed ? `${item.label}${countLabel}` : undefined}
                    title={collapsed ? item.label : undefined}
                    onClick={() => setMobileOpen(false)}
                  >
                    <span className="bench-nav__icon" data-nav-tone={item.tone}>
                      <BenchIcon name={item.icon} />
                    </span>
                    <span className="bench-nav__label">{item.label}</span>
                    {count > 0 && (
                      <span className="bench-nav__count" aria-label={countLabel.trim()}>
                        {count > 99 ? '99+' : count}
                      </span>
                    )}
                  </Link>
                )
              })()
            ))}
          </nav>
          <div className="bench-rail__footer">
            <span className="bench-rail__signal" aria-hidden="true" />
            <span className="bench-rail__footer-copy"><strong>ระบบพร้อมใช้งาน</strong><small>คลังกลาง · LABCBH</small></span>
          </div>
        </aside>
        <div className="workbench">
          <header className="workbench-header">
            <div className="workbench-header__context">
              <button
                className="utility-button sidebar-toggle"
                type="button"
                aria-label={collapsed ? 'ขยายเมนูหลัก' : 'ย่อเมนูหลัก'}
                aria-expanded={!collapsed}
                title={collapsed ? 'ขยาย side menu' : 'ย่อ side menu'}
                onClick={() => setCollapsed((value) => !value)}
              >
                <UtilityIcon name="menu" />
              </button>
              <button
                className="utility-button menu-button"
                type="button"
                aria-label="เปิดเมนูหลัก"
                aria-expanded={mobileOpen}
                onClick={() => setMobileOpen((open) => !open)}
              >
                <UtilityIcon name="menu" />
              </button>
              <div>
                <p className="workbench-header__eyebrow">LABCBH STOCK</p>
                <p className="workbench-header__hospital">{currentItem?.label ?? 'ระบบคลังกลาง'}</p>
              </div>
            </div>
            <div className="workbench-header__actions">
              <NotificationCenter
                actorId={actor.id}
                snapshot={notificationState}
                onSnapshotChange={setNotificationState}
              />
              <button
                className="utility-button utility-button--theme"
                type="button"
                aria-label="เปลี่ยนธีม"
                aria-pressed={dark}
                title={dark ? 'ใช้ธีมสว่าง' : 'ใช้ธีมมืด'}
                onClick={toggleTheme}
              >
                <UtilityIcon name="appearance" dark={dark} />
              </button>
              <a className="portal-return" href={PORTAL_DASHBOARD_URL} title="กลับไป Lab Management Portal">
                <UtilityIcon name="portal" />
                <span>Lab Management</span>
              </a>
              <div className="actor-badge" aria-label={`ผู้ใช้งาน ${actorLabel}`}>
                {actor.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="actor-badge__avatar" src={actor.avatarUrl} alt={`รูปโปรไฟล์ของ ${actorLabel}`} />
                ) : (
                  <span className="actor-badge__initial" aria-hidden="true">
                    {actorLabel.slice(0, 1).toUpperCase()}
                  </span>
                )}
                <span>
                  <strong>{actorLabel}</strong>
                  <small>{actor.profileRole ?? 'LABCBH Stock'}</small>
                </span>
              </div>
              <LogoutButton />
            </div>
          </header>
          <main id="main-content" className="workbench-main" tabIndex={-1}>
            {children}
          </main>
        </div>
      </div>
    </RouteProgress>
  )
}
