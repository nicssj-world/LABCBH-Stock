import { redirect } from 'next/navigation'
import { BackupConsole } from '@/components/settings/BackupConsole'
import { canManageBackups } from '@/lib/backup/authorization'
import { getBackupDashboard } from '@/lib/backup/queries'
import type { BackupDashboard } from '@/lib/backup/types'
import { requireActor } from '@/lib/auth/actor'

export const dynamic = 'force-dynamic'

export default async function BackupSettingsPage() {
  const actor = await requireActor()
  if (!canManageBackups(actor)) redirect('/dashboard')

  let dashboard: BackupDashboard | null = null
  let loadError: unknown = null
  try {
    dashboard = await getBackupDashboard(actor)
  } catch (cause) {
    loadError = cause
  }

  if (loadError || !dashboard) {
    return (
      <div className="route-stack">
        <header className="page-heading">
          <div><h1>สำรองฐานข้อมูล</h1><p>ติดตามการสำรองฐานข้อมูลลงเครื่อง Local</p></div>
        </header>
        <section className="error-state" role="alert">
          <h2>ยังโหลดระบบสำรองข้อมูลไม่ได้</h2>
          <p>{loadError instanceof Error ? loadError.message : 'ไม่สามารถอ่านสถานะ backup ได้'}</p>
          <p>ตรวจสอบว่า migration ระบบ backup ถูกนำไปใช้กับ Supabase แล้ว แล้วลองโหลดหน้านี้อีกครั้ง</p>
        </section>
      </div>
    )
  }

  return (
    <div className="route-stack">
      <header className="page-heading backup-page-heading">
        <div>
          <h1>สำรองฐานข้อมูล</h1>
          <p>ควบคุมการสำรองข้อมูลของ LAB-CBH จากเครื่อง Local พร้อมติดตามผลและตรวจสอบย้อนหลังในหน้าเดียว</p>
        </div>
        <div className="backup-page-heading__meta">
          <span className="status-chip status-chip--info">เฉพาะเจ้าหน้าที่คลัง</span>
          <span className="identifier">{dashboard.projectRef}</span>
        </div>
      </header>
      <BackupConsole dashboard={dashboard} />
    </div>
  )
}
