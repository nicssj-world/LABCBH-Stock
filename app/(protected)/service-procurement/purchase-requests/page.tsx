import Link from 'next/link'
import { requireActor } from '@/lib/auth/actor'
import { bangkokIsoDate } from '@/lib/date/thai'
import { fiscalYearFromDate } from '@/lib/service-procurement/domain'
import { listServicePurchaseRequests } from '@/lib/service-procurement/queries'
import { canCreateServicePurchaseRequest } from '@/lib/service-procurement/authorization'
import { ServicePurchaseRequestTable } from '@/components/service-procurement/ServicePurchaseRequestTable'

interface Props { searchParams: Promise<Record<string, string | string[] | undefined>> }
const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value

export default async function ServicePurchaseRequestsPage({ searchParams }: Props) {
  const actor = await requireActor()
  const params = await searchParams
  const currentFiscalYear = fiscalYearFromDate(bangkokIsoDate())
  const requested = Number(first(params.fiscalYear) ?? currentFiscalYear)
  const fiscalYear = Number.isInteger(requested) && requested >= 2500 && requested <= 3000 ? requested : currentFiscalYear
  const requests = await listServicePurchaseRequests({ fiscalYear, status: first(params.status), search: first(params.search) })
  return <div className="route-stack"><header className="page-heading page-heading--actions"><div><p className="section-kicker">SERVICE PROCUREMENT · PR</p><h1>ใบ PR (งานจ้าง)</h1><p>ติดตามการขอจ้าง ตั้งแต่ส่ง PR จนถึงการใช้จริงและการปิด PO</p></div><div className="page-heading__actions">{canCreateServicePurchaseRequest(actor) && <Link className="lab-link-button lab-link-button--primary" href="/service-procurement/purchase-requests/new">สร้างใบ PR งานจ้าง</Link>}</div></header><section className="bench-panel service-register-toolbar"><form method="get"><div className="form-grid"><label><span>ปีงบประมาณ</span><select name="fiscalYear" defaultValue={String(fiscalYear)}><option value={String(currentFiscalYear)}>{currentFiscalYear} (ปัจจุบัน)</option>{Array.from({ length: 6 }, (_, index) => currentFiscalYear - index - 1).map((year) => <option key={year}>{year}</option>)}</select></label><label><span>ค้นหา</span><input name="search" defaultValue={first(params.search) ?? ''} placeholder="เลข SPR / หน่วยงาน / ผู้ขอ" /></label><label><span>สถานะ</span><select name="status" defaultValue={first(params.status) ?? ''}><option value="">ทุกสถานะ</option><option value="pending">รอคลังยืนยัน</option><option value="confirmed">ยืนยันแล้ว</option><option value="closed">ปิดแล้ว</option><option value="cancelled">ยกเลิก</option></select></label></div><div className="service-register-toolbar__actions"><button className="lab-button lab-button--secondary" type="submit">กรองรายการ</button></div><p className="service-register-toolbar__note">แสดงปีงบประมาณ {fiscalYear}{fiscalYear !== currentFiscalYear ? ' · ประวัติย้อนหลัง' : ' · ปัจจุบัน'}</p></form></section>{requests.length === 0 ? <section className="empty-state empty-state--panel"><h2>ยังไม่มีใบ PR งานจ้าง</h2><p>สร้างใบ PR ใหม่เพื่อเริ่มกระบวนการจ้าง</p></section> : <section className="bench-panel"><div className="bench-panel__header"><div><p className="section-kicker">REQUEST REGISTER</p><h2>รายการใบ PR</h2></div><p>{requests.length} ใบ</p></div><ServicePurchaseRequestTable requests={requests} /></section>}</div>
}
