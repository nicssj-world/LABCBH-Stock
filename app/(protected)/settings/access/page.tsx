import Link from 'next/link'
import { redirect } from 'next/navigation'
import { AccessMatrix } from '@/components/settings/AccessMatrix'
import { canAdministerMemberships } from '@/lib/access/authorization'
import { listMemberships, type LabStockRoleName, type MembershipProfile } from '@/lib/access/queries'
import { LAB_STOCK_ROLES } from '@/lib/access/schema'
import { requireActor } from '@/lib/auth/actor'

interface AccessSettingsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)

export default async function AccessSettingsPage({ searchParams }: AccessSettingsPageProps) {
  const actor = await requireActor()
  if (!canAdministerMemberships(actor)) redirect('/dashboard')

  const params = await searchParams
  const search = first(params.search)?.trim() ?? ''
  const roleValue = first(params.role)
  const role = LAB_STOCK_ROLES.find((value) => value === roleValue) as LabStockRoleName | undefined

  let profiles: MembershipProfile[] = []
  let error: string | null = null

  try {
    profiles = await listMemberships({ search, role })
  } catch (caught) {
    error = caught instanceof Error ? caught.message : 'อ่านรายชื่อผู้ใช้งานไม่สำเร็จ'
  }

  return (
    <div className="route-stack">
      <header className="page-heading">
        <div>
          <p className="section-kicker">ACCESS SETTINGS</p>
          <h1>สิทธิ์การใช้งานระบบคลัง</h1>
          <p>
            ปรับสิทธิ์ได้ตลอดเวลา การเปลี่ยนแปลงมีผลในคำขอถัดไปและถูกบันทึกไว้ตรวจสอบย้อนหลังทุกครั้ง
          </p>
        </div>
      </header>

      {error ? (
        <section className="error-state" role="alert">
          <h2>ไม่สามารถแสดงรายชื่อผู้ใช้งานได้</h2>
          <p>{error}</p>
          <Link className="text-link" href="/settings/access">ลองโหลดข้อมูลอีกครั้ง</Link>
        </section>
      ) : (
        <section className="bench-panel" aria-labelledby="access-matrix-title">
          <div className="bench-panel__header">
            <div>
              <p className="section-kicker">MEMBERSHIPS</p>
              <h2 id="access-matrix-title">ตารางสิทธิ์ผู้ใช้งาน</h2>
            </div>
            <p>{profiles.length} คน</p>
          </div>
          <AccessMatrix profiles={profiles} search={search} activeRole={role ?? null} />
        </section>
      )}
    </div>
  )
}
