import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireActor } from '@/lib/auth/actor'
import { DEPARTMENTS } from '@/lib/organization/departments'
import { canCreateServicePurchaseRequest } from '@/lib/service-procurement/authorization'
import { listServiceCatalogItems, listServiceCommitteeCandidates, listServicePlans } from '@/lib/service-procurement/queries'
import { ServicePurchaseRequestForm } from '@/components/service-procurement/ServicePurchaseRequestForm'

export default async function NewServicePurchaseRequestPage() {
  const actor = await requireActor()
  if (!canCreateServicePurchaseRequest(actor)) redirect('/service-procurement/purchase-requests')
  const [plans, catalog, candidates] = await Promise.all([listServicePlans(), listServiceCatalogItems(), listServiceCommitteeCandidates()])
  const requesterDepartment = actor.department?.trim() || DEPARTMENTS[0]
  const departments = (DEPARTMENTS as readonly string[]).includes(requesterDepartment) ? DEPARTMENTS : [requesterDepartment, ...DEPARTMENTS]
  return <div className="route-stack"><header className="page-heading"><div><Link className="back-link" href="/service-procurement/purchase-requests">← ใบ PR (งานจ้าง)</Link><p className="section-kicker">NEW SERVICE PURCHASE REQUEST</p><h1>สร้างใบ PR (งานจ้าง)</h1><p>ระบบจะสำรองวงเงินแผนเมื่อส่งคำขอ และตัดยอดจริงเมื่อมีการใช้</p></div></header><ServicePurchaseRequestForm department={requesterDepartment} departments={departments} requesterName={actor.name?.trim() || (actor.ephisId ? `E-Phis ${actor.ephisId}` : actor.id)} plans={plans} catalog={catalog} candidates={candidates} /></div>
}
