/*
THESIS: A calm laboratory control bench puts live work paths before decoration.
OWN-WORLD: Deep navy rail, cool instrument surfaces, crisp borders, amber state cues.
STORY: Staff identify their work area, enter a queue, and act with traceable context.
FIRST VIEWPORT: Labeled navigation at left; actor context above a full working canvas.
FORM: Established Laboratory Control Bench, dense Operate mode, user-approved direction.
*/
import Link from 'next/link'
import type { ReactNode } from 'react'
import type { Actor } from '@/lib/auth/actor'

type BenchIconName = 'overview' | 'contract' | 'pr' | 'receipt' | 'issue' | 'inventory'

const navigation: Array<{ href: string; label: string; icon: BenchIconName }> = [
  { href: '/dashboard', label: 'ภาพรวม', icon: 'overview' },
  { href: '/contracts', label: 'สัญญา', icon: 'contract' },
  { href: '/purchase-requests', label: 'ใบ PR', icon: 'pr' },
  { href: '/receipts', label: 'รับเข้า', icon: 'receipt' },
  { href: '/requisitions', label: 'เบิกจ่าย', icon: 'issue' },
  { href: '/inventory', label: 'คงคลัง', icon: 'inventory' },
]

function BenchIcon({ name }: { name: BenchIconName }) {
  const paths: Record<BenchIconName, ReactNode> = {
    overview: <><path d="M4 13h6V4H4v9Z" /><path d="M14 20h6V11h-6v9Z" /><path d="M4 20h6v-3H4v3Z" /><path d="M14 7h6V4h-6v3Z" /></>,
    contract: <><path d="M6 3h9l3 3v15H6V3Z" /><path d="M14 3v4h4" /><path d="M9 12h6M9 16h6" /></>,
    pr: <><path d="M5 4h14v16H5V4Z" /><path d="M8 8h8M8 12h5M8 16h3" /></>,
    receipt: <><path d="M4 7h16v13H4V7Z" /><path d="M7 3h10v4H7V3Z" /><path d="M12 10v6m-3-3 3 3 3-3" /></>,
    issue: <><path d="M4 5h16v14H4V5Z" /><path d="M12 15V9m-3 3 3-3 3 3" /></>,
    inventory: <><path d="m4 7 8-4 8 4-8 4-8-4Z" /><path d="m4 7 8 4 8-4v10l-8 4-8-4V7Z" /><path d="M12 11v10" /></>,
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
          {navigation.map((item) => (
            <Link key={item.href} href={item.href} className="bench-nav__link">
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
          <div className="actor-badge" aria-label={`ผู้ใช้งาน ${actorLabel}`}>
            <span className="actor-badge__initial" aria-hidden="true">
              {actorLabel.slice(0, 1).toUpperCase()}
            </span>
            <span>
              <strong>{actorLabel}</strong>
              <small>{actor.profileRole ?? 'LABCBH Stock'}</small>
            </span>
          </div>
        </header>
        <main id="main-content" className="workbench-main" tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  )
}
