import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import {
  RequisitionForm,
  type RequisitionFormInitialValues,
} from '@/components/requisitions/RequisitionForm'
import { requireActor } from '@/lib/auth/actor'
import { listInventoryItems } from '@/lib/inventory/queries'
import { DEPARTMENTS } from '@/lib/organization/departments'
import { canManageRequisition } from '@/lib/requisitions/authorization'
import { getRequisition } from '@/lib/requisitions/queries'

interface RequisitionEditPageProps {
  params: Promise<{ id: string }>
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function RequisitionEditPage({ params }: RequisitionEditPageProps) {
  const actor = await requireActor()

  const { id } = await params
  if (!UUID_PATTERN.test(id)) notFound()

  const requisition = await getRequisition(id)
  if (!requisition) notFound()
  if (!canManageRequisition(actor, requisition.requesterId)) redirect('/requisitions')
  // Dispensed or cancelled requisitions are closed records: the stock ledger
  // behind a fulfilled one is append-only and cannot be re-cut from a form.
  if (requisition.status !== 'waiting') redirect(`/requisitions/${requisition.id}`)

  const inventoryItems = await listInventoryItems({})
  const initialValues: RequisitionFormInitialValues = {
    requisitionId: requisition.id,
    department: requisition.department,
    requesterName: requisition.requesterName,
    desiredDate: requisition.desiredDate,
    note: requisition.note,
    items: requisition.items.map((item) => ({
      inventoryItemId: item.inventoryItemId,
      lsCode: item.lsCode,
      name: item.name,
      unit: item.unit,
      note: item.note,
      requestedQuantity: item.requestedQuantity,
    })),
  }

  return (
    <div className="route-stack">
      <header className="page-heading">
        <div>
          <Link className="back-link" href={`/requisitions/${requisition.id}`}>← รายละเอียดใบเบิก</Link>
          <p className="section-kicker">EDIT REQUISITION</p>
          <h1>แก้ไขใบเบิก</h1>
          <p>แก้ไขได้จนกว่าเจ้าหน้าที่คลังจะจ่ายของ ยอดคงคลังจะถูกตัดตอนจ่ายจริงเท่านั้น</p>
        </div>
      </header>

      <RequisitionForm
        catalog={inventoryItems.map((item) => ({
          inventoryItemId: item.id,
          lsCode: item.lsCode,
          name: item.name,
          unit: item.baseUnit,
          note: item.note,
          onHand: item.onHand,
          minimumStock: item.minimumStock,
          responsibleDepartment: item.responsibleDepartment,
        }))}
        departments={DEPARTMENTS}
        requesterName={requisition.requesterName}
        mode="edit"
        initialValues={initialValues}
      />
    </div>
  )
}
