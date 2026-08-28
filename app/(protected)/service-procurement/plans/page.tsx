import Link from 'next/link'
import { requireActor } from '@/lib/auth/actor'
import { DEPARTMENTS } from '@/lib/organization/departments'
import { bangkokIsoDate } from '@/lib/date/thai'
import { fiscalYearFromDate } from '@/lib/service-procurement/domain'
import { SERVICE_PLAN_TYPES, SERVICE_PLAN_TYPE_LABELS } from '@/lib/service-procurement/schema'
import { listServicePlans } from '@/lib/service-procurement/queries'
import { canManageServicePlans } from '@/lib/service-procurement/authorization'
import { AutoFilterBench } from '@/components/ui/AutoFilterBench'
import { ServicePlanTable } from '@/components/service-procurement/ServicePlanTable'

interface Props { searchParams: Promise<Record<string, string | string[] | undefined>> }
const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value

export default async function ServicePlansPage({ searchParams }: Props) {
  const actor = await requireActor()
  const params = await searchParams
  const currentFiscalYear = fiscalYearFromDate(bangkokIsoDate())
  const requestedYear = Number(first(params.fiscalYear) ?? currentFiscalYear)
  const fiscalYear = Number.isInteger(requestedYear) && requestedYear >= 2500 && requestedYear <= 3000 ? requestedYear : currentFiscalYear
  const search = first(params.search)?.trim() ?? ''
  const department = first(params.department) ?? ''
  const type = SERVICE_PLAN_TYPES.find((value) => value === first(params.type))
  const legacyNotice = first(params.notice) === 'legacy-out-lab'
  const plans = await listServicePlans({ fiscalYear, department: department || undefined, type, search })
  const showingHistory = fiscalYear !== currentFiscalYear

  return (
    <div className="route-stack">
      <header className="page-heading page-heading--actions">
        <div><p className="section-kicker">SERVICE PROCUREMENT · PLANS</p><h1>แผนงานจ้าง</h1><p>แสดงวงเงิน รายการส่งตรวจ และ PR/PO ที่อ้างอิง ยอดใช้จริงจะเกิดเมื่อปิด PO</p></div>
        <div className="page-heading__actions">
          {canManageServicePlans(actor) && <Link className="lab-link-button lab-link-button--primary" href="/service-procurement/plans/new">เพิ่มแผนงานจ้าง</Link>}
        </div>
      </header>
      {legacyNotice && <p className="service-budget-callout" role="status">โมดูลเดิมถูกแทนที่แล้ว ข้อมูล Out Lab เดิมไม่ถูกใช้งาน โปรดดำเนินการต่อใน “งานจ้าง”</p>}
      <section className="bench-panel service-register-toolbar">
        <AutoFilterBench
          ariaLabel="ตัวกรองแผนงานจ้าง"
          className="service-register-filters"
          showClear={false}
          fields={[
            { type: 'select', name: 'fiscalYear', label: 'ปีงบประมาณ', value: String(fiscalYear), options: [{ value: String(currentFiscalYear), label: `${currentFiscalYear} (ปัจจุบัน)` }, ...Array.from({ length: 7 }, (_, index) => currentFiscalYear - index - 1).map((year) => ({ value: String(year), label: String(year) }))] },
            { type: 'search', name: 'search', label: 'ค้นหาแผน', value: search, placeholder: 'ชื่อแผน' },
            { type: 'select', name: 'department', label: 'หน่วยงาน', value: department, options: [{ value: '', label: 'ทุกหน่วยงาน' }, ...DEPARTMENTS.map((value) => ({ value, label: value }))] },
            { type: 'select', name: 'type', label: 'ประเภท', value: type ?? '', options: [{ value: '', label: 'ทุกประเภท' }, ...SERVICE_PLAN_TYPES.map((value) => ({ value, label: SERVICE_PLAN_TYPE_LABELS[value] }))] },
          ]}
        />
      </section>
      {plans.length === 0 ? <section className="empty-state empty-state--panel"><h2>{showingHistory ? `ยังไม่มีแผนในปีงบประมาณ ${fiscalYear}` : 'ยังไม่มีแผนงานจ้างในปีงบประมาณนี้'}</h2><p>{canManageServicePlans(actor) ? 'กด “เพิ่มแผนงานจ้าง” เพื่อเริ่มติดตามวงเงิน' : 'เมื่อมีการสร้างแผนแล้ว รายการจะแสดงที่หน้านี้'}</p></section> : <section className="bench-panel"><div className="bench-panel__header"><div><p className="section-kicker">FISCAL YEAR {fiscalYear}</p><h2>{showingHistory ? 'ประวัติแผนงานจ้าง' : 'แผนที่ใช้งานอยู่'}</h2></div><p>{plans.length} แผน</p></div><ServicePlanTable plans={plans} /></section>}
    </div>
  )
}
