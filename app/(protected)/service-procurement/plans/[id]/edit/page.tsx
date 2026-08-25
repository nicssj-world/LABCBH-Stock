import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { requireActor } from '@/lib/auth/actor'
import { canManageServicePlans } from '@/lib/service-procurement/authorization'
import { getServicePlan, listServiceCommitteeCandidates } from '@/lib/service-procurement/queries'
import { ServicePlanForm } from '@/components/service-procurement/ServicePlanForm'
import { DEPARTMENTS } from '@/lib/organization/departments'

export default async function EditServicePlanPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor()
  if (!canManageServicePlans(actor)) redirect('/access-denied')
  const { id } = await params
  const result = await getServicePlan(id)
  if (!result) notFound()
  const candidates = await listServiceCommitteeCandidates()
  return <div className="route-stack"><header className="page-heading"><Link className="back-link" href={`/service-procurement/plans/${id}`}>← รายละเอียดแผน</Link><p className="section-kicker">EDIT SERVICE PLAN</p><h1>แก้ไขแผนงานจ้าง</h1></header><ServicePlanForm mode="edit" departments={DEPARTMENTS} candidates={candidates} initial={result.plan} /></div>
}
