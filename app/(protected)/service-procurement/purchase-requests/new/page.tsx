import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireActor } from '@/lib/auth/actor'
import { DEPARTMENTS } from '@/lib/organization/departments'
import { bangkokIsoDate } from '@/lib/date/thai'
import { canCreateServicePurchaseRequest } from '@/lib/service-procurement/authorization'
import { fiscalYearFromDate } from '@/lib/service-procurement/domain'
import { listCurrentActiveServicePlansForPr, listServiceCommitteeCandidates } from '@/lib/service-procurement/queries'
import { ServicePurchaseRequestForm } from '@/components/service-procurement/ServicePurchaseRequestForm'

export default async function NewServicePurchaseRequestPage() {
  const actor = await requireActor()
  if (!canCreateServicePurchaseRequest(actor)) redirect('/service-procurement/purchase-requests')
  const currentFiscalYear = fiscalYearFromDate(bangkokIsoDate())
  const [plans, candidates] = await Promise.all([listCurrentActiveServicePlansForPr(), listServiceCommitteeCandidates()])
  const requesterDepartment = actor.department?.trim() || DEPARTMENTS[0]
  const departments = (DEPARTMENTS as readonly string[]).includes(requesterDepartment) ? DEPARTMENTS : [requesterDepartment, ...DEPARTMENTS]
  return <div className="route-stack"><header className="page-heading"><div><Link className="back-link" href="/service-procurement/purchase-requests">← ใบ PR (งานจ้าง)</Link><p className="section-kicker">NEW SERVICE PURCHASE REQUEST</p><h1>สร้างใบ PR (งานจ้าง)</h1><p>ระบบจะสำรองวงเงินเต็มจำนวนเมื่อส่ง PR และตัดยอดใช้จริงเมื่อผู้มีสิทธิ์ปิด PO</p></div></header><ServicePurchaseRequestForm fiscalYear={currentFiscalYear} department={requesterDepartment} departments={departments} requesterName={actor.name?.trim() || (actor.ephisId ? `E-Phis ${actor.ephisId}` : actor.id)} plans={plans} candidates={candidates} /></div>
}
