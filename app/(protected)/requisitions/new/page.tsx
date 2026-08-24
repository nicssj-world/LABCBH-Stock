import Link from 'next/link'
import { redirect } from 'next/navigation'
import { RequisitionForm } from '@/components/requisitions/RequisitionForm'
import { requireActor } from '@/lib/auth/actor'
import { DEPARTMENTS } from '@/lib/organization/departments'
import { canRequestPurchase } from '@/lib/pr/authorization'
import { listRequisitionCatalog } from '@/lib/requisitions/queries'

export default async function NewRequisitionPage() {
  const actor = await requireActor()
  if (!canRequestPurchase(actor)) redirect('/requisitions')

  const inventoryItems = await listRequisitionCatalog()
  const requesterDepartment = actor.department?.trim() || null
  // Keep an out-of-band profile department visible and selected as well. This
  // matters for shared/staging profiles while still letting the picker use the
  // exact department value stored on the profile.
  const departments = requesterDepartment && !(DEPARTMENTS as readonly string[]).includes(requesterDepartment)
    ? [requesterDepartment, ...DEPARTMENTS]
    : DEPARTMENTS

  return (
    <div className="route-stack">
      <header className="page-heading">
        <div>
          <Link className="back-link" href="/requisitions">← ใบเบิกน้ำยา</Link>
          <p className="section-kicker">NEW REQUISITION</p>
          <h1>สร้างใบเบิก</h1>
          <p>ระบบกันยอดตามใบเบิกที่รอจ่าย และตัดยอดจริงเมื่อเจ้าหน้าที่คลังจ่ายของ</p>
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
          usableOnHand: item.usableOnHand,
          waitingReserved: item.waitingReserved,
          availableToRequest: item.availableToRequest,
          minimumStock: item.minimumStock,
          responsibleDepartment: item.responsibleDepartment,
        }))}
        departments={departments}
        requesterDepartment={requesterDepartment}
        requesterName={actor.name ?? ''}
      />
    </div>
  )
}
