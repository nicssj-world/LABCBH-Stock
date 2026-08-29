import Link from 'next/link'
import { requireActor } from '@/lib/auth/actor'
import { DEPARTMENTS } from '@/lib/organization/departments'
import { bangkokIsoDate } from '@/lib/date/thai'
import { SERVICE_REQUEST_FILTER_STATUSES, fiscalYearFromDate, isServiceRequestDisplayStatus } from '@/lib/service-procurement/domain'
import { listServicePurchaseRequests } from '@/lib/service-procurement/queries'
import { canCreateServicePurchaseRequest } from '@/lib/service-procurement/authorization'
import { serviceRequestDisplayStatusLabel } from '@/lib/service-procurement/presenter'
import { AutoFilterBench } from '@/components/ui/AutoFilterBench'
import { ServicePurchaseRequestTable } from '@/components/service-procurement/ServicePurchaseRequestTable'

interface Props { searchParams: Promise<Record<string, string | string[] | undefined>> }
const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value

export default async function ServicePurchaseRequestsPage({ searchParams }: Props) {
  const actor = await requireActor()
  const params = await searchParams
  const currentFiscalYear = fiscalYearFromDate(bangkokIsoDate())
  const requested = Number(first(params.fiscalYear) ?? currentFiscalYear)
  const fiscalYear = Number.isInteger(requested) && requested >= 2500 && requested <= 3000 ? requested : currentFiscalYear
  const department = first(params.department) ?? ''
  const requestedStatus = first(params.status)
  const status = isServiceRequestDisplayStatus(requestedStatus) ? requestedStatus : undefined
  const requests = await listServicePurchaseRequests({ fiscalYear, department: department || undefined, status, search: first(params.search) })
  return <div className="route-stack"><header className="page-heading page-heading--actions"><div><p className="section-kicker">SERVICE PROCUREMENT · PR</p><h1>ใบ PR (งานจ้าง)</h1><p>ติดตามการขอจ้าง ตั้งแต่ส่ง PR จนถึงการใช้จริงและการปิด PO</p></div><div className="page-heading__actions">{canCreateServicePurchaseRequest(actor) && <Link className="lab-link-button lab-link-button--primary" href="/service-procurement/purchase-requests/new">สร้างใบ PR งานจ้าง</Link>}</div></header><section className="bench-panel service-register-toolbar"><AutoFilterBench ariaLabel="ตัวกรองใบ PR งานจ้าง" className="service-register-filters" showClear={false} fields={[{ type: 'select', name: 'fiscalYear', label: 'ปีงบประมาณ', value: String(fiscalYear), options: [{ value: String(currentFiscalYear), label: `${currentFiscalYear} (ปัจจุบัน)` }, ...Array.from({ length: 6 }, (_, index) => currentFiscalYear - index - 1).map((year) => ({ value: String(year), label: String(year) }))] }, { type: 'search', name: 'search', label: 'ค้นหา', value: first(params.search) ?? '', placeholder: 'เลข SPR / PO / PR จาก E-Phis / Invoice / รายการตรวจ / หน่วยงาน / ผู้ขอ' }, { type: 'select', name: 'department', label: 'หน่วยงาน', value: department, options: [{ value: '', label: 'ทุกหน่วยงาน' }, ...DEPARTMENTS.map((value) => ({ value, label: value }))] }, { type: 'select', name: 'status', label: 'สถานะ', value: status ?? '', options: [{ value: '', label: 'ทุกสถานะ' }, ...SERVICE_REQUEST_FILTER_STATUSES.map((value) => ({ value, label: serviceRequestDisplayStatusLabel(value) }))] }]} /><p className="service-register-toolbar__note">แสดงปีงบประมาณ {fiscalYear}{fiscalYear !== currentFiscalYear ? ' · ประวัติย้อนหลัง' : ' · ปัจจุบัน'}</p></section>{requests.length === 0 ? <section className="empty-state empty-state--panel"><h2>ยังไม่มีใบ PR งานจ้าง</h2><p>สร้างใบ PR ใหม่เพื่อเริ่มกระบวนการจ้าง</p></section> : <section className="bench-panel"><div className="bench-panel__header"><div><p className="section-kicker">REQUEST REGISTER</p><h2>รายการใบ PR</h2></div><p>{requests.length} ใบ</p></div><ServicePurchaseRequestTable requests={requests} /></section>}</div>
}
