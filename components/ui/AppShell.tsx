/*
THESIS: A calm laboratory control bench puts live work paths before decoration.
OWN-WORLD: Deep navy rail, cool instrument surfaces, crisp borders, amber state cues.
STORY: Staff identify their work area, enter a queue, and act with traceable context.
FIRST VIEWPORT: Labeled navigation at left; actor context above a full working canvas.
FORM: Established Laboratory Control Bench, dense Operate mode, user-approved direction.
*/
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import { LogoutButton } from '@/components/ui/LogoutButton'
import type { Actor } from '@/lib/auth/actor'

type BenchIconName = 'overview' | 'contract' | 'pr' | 'receipt' | 'issue' | 'inventory' | 'settings'

const navigation: Array<{ href: string; label: string; icon: BenchIconName }> = [
  { href: '/dashboard', label: 'ภาพรวม', icon: 'overview' },
  { href: '/contracts', label: 'สัญญา', icon: 'contract' },
  { href: '/purchase-requests', label: 'ใบ PR', icon: 'pr' },
  { href: '/receipts', label: 'รับเข้า', icon: 'receipt' },
  { href: '/requisitions', label: 'เบิกจ่าย', icon: 'issue' },
  { href: '/inventory', label: 'คงคลัง', icon: 'inventory' },
]

// Kept out of the main list because the route redirects anyone else away; a
// visible link that always bounced would be worse than no link.
const adminNavigation: Array<{ href: string; label: string; icon: BenchIconName }> = [
  { href: '/settings/access', label: 'สิทธิ์ผู้ใช้งาน', icon: 'settings' },
]

function BenchIcon({ name }: { name: BenchIconName }) {
  const paths: Record<BenchIconName, ReactNode> = {
    overview: <><path d="M4 13h6V4H4v9Z" /><path d="M14 20h6V11h-6v9Z" /><path d="M4 20h6v-3H4v3Z" /><path d="M14 7h6V4h-6v3Z" /></>,
    contract: <><path d="M6 3h9l3 3v15H6V3Z" /><path d="M14 3v4h4" /><path d="M9 12h6M9 16h6" /></>,
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

export interface AppShellProps {
  actor: Actor
  children: ReactNode
}

export function AppShell({ actor, children }: AppShellProps) {
  const pathname = usePathname()
  const actorLabel = actor.name ?? (actor.ephisId ? `E-Phis ${actor.ephisId}` : 'ผู้ใช้งาน')

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">ข้ามไปยังเนื้อหาหลัก</a>
      <aside className="bench-rail" aria-label="เมนูหลัก">
        <div className="bench-brand">
          <span className="bench-brand__mark" aria-hidden="true">LC</span>
          <span>
            <strong>LABCBH Stock</strong>
            <small>Laboratory Control Bench</small>
          </span>
        </div>
        <nav className="bench-nav">
          {[...navigation, ...(actor.appRoles.includes('admin') ? adminNavigation : [])].map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="bench-nav__link"
              aria-current={pathname === item.href || pathname.startsWith(`${item.href}/`) ? 'page' : undefined}
            >
              <BenchIcon name={item.icon} />
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>
        <div className="bench-rail__footer">
          <span className="bench-rail__signal" aria-hidden="true" />
          <span>ระบบคลังกลาง</span>
        </div>
      </aside>
      <div className="workbench">
        <header className="workbench-header">
          <div>
            <p className="workbench-header__eyebrow">กลุ่มงานเทคนิคการแพทย์</p>
            <p className="workbench-header__hospital">โรงพยาบาลชลบุรี</p>
          </div>
          <div className="workbench-header__actions">
            <div className="actor-badge" aria-label={`ผู้ใช้งาน ${actorLabel}`}>
              <span className="actor-badge__initial" aria-hidden="true">
                {actorLabel.slice(0, 1).toUpperCase()}
              </span>
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
  )
}
