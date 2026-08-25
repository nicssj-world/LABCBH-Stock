import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireActor } from '@/lib/auth/actor'
import { canManageServicePlans } from '@/lib/service-procurement/authorization'
import { ServicePlanForm } from '@/components/service-procurement/ServicePlanForm'
import { listServiceCommitteeCandidates } from '@/lib/service-procurement/queries'
import { DEPARTMENTS } from '@/lib/organization/departments'
import { fiscalYearFromDate } from '@/lib/service-procurement/domain'
import { bangkokIsoDate } from '@/lib/date/thai'

export default async function NewServicePlanPage() {
  const actor = await requireActor()
  if (!canManageServicePlans(actor)) redirect('/access-denied')
  const candidates = await listServiceCommitteeCandidates()
  const currentFiscalYear = fiscalYearFromDate(bangkokIsoDate())
  return <div className="route-stack"><header className="page-heading page-heading--actions"><div><Link className="back-link" href="/service-procurement/plans">← แผนงานจ้าง</Link><p className="section-kicker">NEW SERVICE PLAN</p><h1>เพิ่มแผนงานจ้าง</h1><p>กำหนดวงเงิน ปีงบประมาณ ประเภท และผู้รับผิดชอบ</p></div></header><ServicePlanForm mode="create" departments={DEPARTMENTS} candidates={candidates} defaultFiscalYear={currentFiscalYear} /></div>
}
