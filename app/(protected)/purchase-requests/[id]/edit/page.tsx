import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import {
  PurchaseRequestForm,
  type PurchaseRequestFormInitialValues,
} from '@/components/pr/PurchaseRequestForm'
import { requireActor } from '@/lib/auth/actor'
import { DEPARTMENTS } from '@/lib/organization/departments'
import { canManagePurchaseRequest } from '@/lib/pr/authorization'
import { loadPurchaseRequestFormOptions } from '@/lib/pr/form-options'
import { purchaseMethodPurpose, purchaseMethodSchema } from '@/lib/pr/schema'
import { getPurchaseRequest } from '@/lib/pr/queries'
import { getPurchaseRequestChecklist } from '@/lib/pr/checklist-queries'

interface PurchaseRequestEditPageProps {
  params: Promise<{ id: string }>
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function PurchaseRequestEditPage({ params }: PurchaseRequestEditPageProps) {
  const actor = await requireActor()

  const { id } = await params
  if (!UUID_PATTERN.test(id)) notFound()

  const request = await getPurchaseRequest(id)
  if (!request) notFound()
  if (!canManagePurchaseRequest(actor, request.requesterId)) redirect('/purchase-requests')
  if (request.status !== 'pending') redirect(`/purchase-requests/${request.id}`)

  const parsedMethod = purchaseMethodSchema.safeParse({
    kind: request.purchaseMethod,
    ...request.methodDetails,
  })
  if (!parsedMethod.success) redirect(`/purchase-requests/${request.id}`)

  const [options, checklist] = await Promise.all([
    loadPurchaseRequestFormOptions(request.id),
    request.checklistPolicyVersion === null ? Promise.resolve(null) : getPurchaseRequestChecklist(request.id, actor),
  ])
  const initialValues: PurchaseRequestFormInitialValues = {
    requestId: request.id,
    requestedDate: request.requestedDate,
    note: request.note,
    purpose: purchaseMethodPurpose(request.purchaseMethod),
    method: parsedMethod.data,
    items: request.items.map((item) => ({
      inventoryItemId: item.inventoryItemId,
      contractItemId: item.contractItemId,
      lsCode: item.lsCode,
      name: item.name,
      unit: item.unit,
      requestedQuantity: item.requestedQuantity,
      unitPrice: item.unitPrice,
      contractRemaining:
        options.contractLines.find((line) => line.contractItemId === item.contractItemId)?.contractRemaining ??
        item.contractRemaining,
      monthlyUsageSnapshot: item.monthlyUsageSnapshot,
    })),
    checklistPolicyVersion: request.checklistPolicyVersion,
    checklist,
  }

  return (
    <div className="route-stack">
      <header className="page-heading">
        <div>
          <Link className="back-link" href={`/purchase-requests/${request.id}`}>← รายละเอียดใบ PR</Link>
          <p className="section-kicker">EDIT REQUEST</p>
          <h1>แก้ไขใบขอซื้อ</h1>
          <p>แก้ไขได้จนกว่าเจ้าหน้าที่คลังจะยืนยันใบ PR</p>
        </div>
      </header>

      <PurchaseRequestForm
        department={request.department}
        departments={DEPARTMENTS}
        headName={request.headName}
        contracts={options.contracts}
        awaitingContracts={options.awaitingContracts}
        contractLines={options.contractLines}
        catalog={options.catalog}
        committeeCandidates={options.committeeCandidates}
        mode="edit"
        initialValues={initialValues}
      />
    </div>
  )
}
