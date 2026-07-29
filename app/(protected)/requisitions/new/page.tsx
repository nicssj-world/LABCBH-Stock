import Link from 'next/link'
import { redirect } from 'next/navigation'
import { RequisitionForm } from '@/components/requisitions/RequisitionForm'
import { requireActor } from '@/lib/auth/actor'
import { listInventoryItems } from '@/lib/inventory/queries'
import { canRequestPurchase } from '@/lib/pr/authorization'

export default async function NewRequisitionPage() {
  const actor = await requireActor()
  if (!canRequestPurchase(actor)) redirect('/requisitions')

  const inventoryItems = await listInventoryItems({})

  return (
    <div className="route-stack">
      <header className="page-heading">
        <div>
          <Link className="back-link" href="/requisitions">← ใบเบิกน้ำยา</Link>
          <p className="section-kicker">NEW REQUISITION</p>
          <h1>สร้างใบเบิก</h1>
          <p>ระบบเตือนเมื่อยอดคงเหลือหลังเบิกจะต่ำกว่าขั้นต่ำ แต่ไม่ปิดกั้นการเบิกเร่งด่วน</p>
        </div>
      </header>

      <RequisitionForm
        catalog={inventoryItems.map((item) => ({
          inventoryItemId: item.id,
          lsCode: item.lsCode,
          name: item.name,
          unit: item.baseUnit,
          onHand: item.onHand,
          minimumStock: item.minimumStock,
        }))}
        requesterName={actor.name ?? ''}
      />
    </div>
  )
}
