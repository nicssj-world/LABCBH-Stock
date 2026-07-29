'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { setMembership } from '@/lib/access/actions'
import { LAB_STOCK_ROLES } from '@/lib/access/schema'
import type { LabStockRoleName, MembershipProfile } from '@/lib/access/queries'

export const ROLE_LABELS: Record<LabStockRoleName, string> = {
  admin: 'ผู้ดูแลระบบ',
  head: 'หัวหน้ากลุ่มงาน',
  stock_officer: 'เจ้าหน้าที่คลัง',
  viewer: 'ผู้ดูข้อมูล',
  reporter: 'ผู้ออกรายงาน',
}

export interface AccessMatrixProps {
  profiles: MembershipProfile[]
  search: string
  activeRole: LabStockRoleName | null
}

export function AccessMatrix({ profiles, search: initialSearch, activeRole }: AccessMatrixProps) {
  const router = useRouter()
  const [search, setSearch] = useState(initialSearch)
  const [savedKey, setSavedKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const applyFilters = (nextRole: LabStockRoleName | null, nextSearch: string) => {
    const params = new URLSearchParams()
    if (nextSearch.trim()) params.set('search', nextSearch.trim())
    if (nextRole) params.set('role', nextRole)
    router.push(`/settings/access${params.size > 0 ? `?${params}` : ''}`)
  }

  const toggle = (profile: MembershipProfile, role: LabStockRoleName, next: boolean) => {
    setError(null)
    setSavedKey(null)

    startTransition(async () => {
      try {
        await setMembership({ profileId: profile.profileId, role, active: next })
        setSavedKey(`${profile.profileId}:${role}`)
        router.refresh()
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'บันทึกสิทธิ์ไม่สำเร็จ')
      }
    })
  }

  return (
    <div className="access-matrix">
      <form
        className="filter-bench"
        aria-label="ตัวกรองผู้ใช้งาน"
        onSubmit={(event) => {
          event.preventDefault()
          applyFilters(activeRole, search)
        }}
      >
        <label className="filter-bench__search">
          ค้นหา
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="ชื่อผู้ใช้งาน หรือรหัส E-Phis"
          />
        </label>
        <button className="lab-button lab-button--primary" type="submit">แสดงผล</button>
      </form>

      {/* Filters are buttons, not tabs: they narrow one list rather than
          switching between panels. */}
      <div className="role-filters">
        <button
          type="button"
          className="role-filter"
          aria-pressed={activeRole === null}
          onClick={() => applyFilters(null, search)}
        >
          ทุกสิทธิ์
        </button>
        {LAB_STOCK_ROLES.map((role) => (
          <button
            key={role}
            type="button"
            className="role-filter"
            aria-pressed={activeRole === role}
            onClick={() => applyFilters(role, search)}
          >
            {ROLE_LABELS[role]}
          </button>
        ))}
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}

      {profiles.length === 0 ? (
        <p className="empty-state">ไม่พบผู้ใช้งานตามเงื่อนไขที่เลือก</p>
      ) : (
        <div className="detail-items-table">
          <table className="data-table">
            <thead>
              <tr>
                <th>ผู้ใช้งาน</th>
                <th>สิทธิ์ในระบบพอร์ทัล</th>
                {LAB_STOCK_ROLES.map((role) => <th key={role}>{ROLE_LABELS[role]}</th>)}
              </tr>
            </thead>
            <tbody>
              {profiles.map((profile) => (
                <tr key={profile.profileId}>
                  <td>
                    <strong>{profile.name ?? 'ไม่ระบุชื่อ'}</strong>
                    <small className="identifier">{profile.ephisId ?? '—'}</small>
                  </td>
                  <td>
                    {profile.portalRole ?? 'ไม่ระบุ'}
                    {profile.intrinsicRoles.length > 0 && (
                      <small>
                        ได้สิทธิ์จากพอร์ทัล: {profile.intrinsicRoles.map((role) => ROLE_LABELS[role]).join(', ')}
                      </small>
                    )}
                  </td>
                  {LAB_STOCK_ROLES.map((role) => {
                    const key = `${profile.profileId}:${role}`
                    const intrinsic = profile.intrinsicRoles.includes(role)
                    const checked = profile.roles.includes(role) || intrinsic

                    return (
                      <td key={role}>
                        <label className="access-toggle">
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={isPending || intrinsic}
                            aria-label={`${ROLE_LABELS[role]} ของ ${profile.name ?? profile.ephisId ?? 'ผู้ใช้งาน'}`}
                            onChange={(event) => toggle(profile, role, event.target.checked)}
                          />
                          {intrinsic && <small>สิทธิ์ติดตัว</small>}
                          {savedKey === key && <small className="access-toggle__saved">บันทึกแล้ว</small>}
                        </label>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
