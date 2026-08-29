import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ServicePurchaseRequestForm } from '@/components/service-procurement/ServicePurchaseRequestForm'
import { requireActor } from '@/lib/auth/actor'
import { DEPARTMENTS } from '@/lib/organization/departments'
import { canCreateServicePurchaseRequest } from '@/lib/service-procurement/authorization'
import { listServiceCommitteeCandidates, listServicePlans, getServicePurchaseRequest } from '@/lib/service-procurement/queries'

interface ServicePurchaseRequestEditPageProps {
  params: Promise<{ id: string }>
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function ServicePurchaseRequestEditPage({ params }: ServicePurchaseRequestEditPageProps) {
  const actor = await requireActor()
  const { id } = await params
  if (!UUID_PATTERN.test(id)) notFound()

  const request = await getServicePurchaseRequest(id)
  if (!request) notFound()
  const canEdit = canCreateServicePurchaseRequest(actor) && (
    request.requesterId === actor.id || actor.appRoles.includes('admin') || actor.appRoles.includes('head')
  )
  if (!canEdit || request.status !== 'pending') redirect(`/service-procurement/purchase-requests/${request.id}`)

  const [plans, candidates] = await Promise.all([
    listServicePlans(),
    listServiceCommitteeCandidates(),
  ])
  const departments = (DEPARTMENTS as readonly string[]).includes(request.department)
    ? DEPARTMENTS
    : [request.department, ...DEPARTMENTS]

  return (
    <div className="route-stack">
      <header className="page-heading">
        <div>
          <Link className="back-link" href={`/service-procurement/purchase-requests/${request.id}`}>← รายละเอียดใบ PR</Link>
          <p className="section-kicker">EDIT SERVICE PURCHASE REQUEST</p>
          <h1>แก้ไขใบ PR (งานจ้าง)</h1>
          <p>แก้ไขได้จนกว่าเจ้าหน้าที่คลังจะยืนยันใบ PR</p>
        </div>
      </header>

      <ServicePurchaseRequestForm
        department={request.department}
        departments={departments}
        requesterName={request.requesterName}
        plans={plans}
        candidates={candidates}
        mode="edit"
        initialValues={{
          requestId: request.id,
          fiscalYear: request.fiscalYear,
          requestedDate: request.requestedDate,
          note: request.note,
          planId: request.planId,
          amount: request.requestedAmount,
          usageStartDate: request.usageStartDate,
          usageEndDate: request.usageEndDate,
          items: request.items
            .filter((item) => Boolean(item.planItemId))
            .map((item) => ({ planItemId: item.planItemId, requestedQuantity: item.requestedQuantity })),
          committees: request.committees.map((committee) => ({
            kind: committee.kind,
            seat: committee.seat,
            profileId: committee.profileId,
          })),
          existingTor: request.attachments.some((attachment) => attachment.kind === 'tor'),
        }}
      />
    </div>
  )
}
