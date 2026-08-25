import Link from 'next/link'
import { AnnualPlanGrid } from '@/components/annual-plans/AnnualPlanGrid'
import { canOperateStock } from '@/lib/auth/access'
import { requireActor } from '@/lib/auth/actor'
import { listAnnualPlanSlots } from '@/lib/annual-plans/queries'

export default async function AnnualPlansPage() {
  const actor = await requireActor()
  let groups = [] as Awaited<ReturnType<typeof listAnnualPlanSlots>>
  let error: string | null = null

  try {
    groups = await listAnnualPlanSlots(actor)
  } catch (caught) {
    error = caught instanceof Error ? caught.message : 'อ่านแผนประจำปีไม่สำเร็จ'
  }

  return (
    <div className="route-stack">
      <header className="page-heading">
        <div>
          <p className="section-kicker">ANNUAL PLANS</p>
          <h1>แผนประจำปี</h1>
          <p>รวมแผนจัดซื้อและแผนจัดจ้างของหน่วยงาน เปิดดูเอกสารในหน้านี้หรือดาวน์โหลดเก็บไว้ได้</p>
        </div>
      </header>

      {error ? (
        <section className="error-state" role="alert">
          <h2>ไม่สามารถแสดงแผนประจำปีได้</h2>
          <p>{error}</p>
          <Link className="text-link" href="/annual-plans">ลองโหลดข้อมูลอีกครั้ง</Link>
        </section>
      ) : (
        <AnnualPlanGrid groups={groups} canManage={canOperateStock(actor)} />
      )}
    </div>
  )
}
