import Link from 'next/link'
import { redirect } from 'next/navigation'
import { PurchaseRequestForm } from '@/components/pr/PurchaseRequestForm'
import { requireActor } from '@/lib/auth/actor'
import { DEPARTMENTS } from '@/lib/organization/departments'
import { canRequestPurchase } from '@/lib/pr/authorization'
import { loadPurchaseRequestFormOptions } from '@/lib/pr/form-options'

export default async function NewPurchaseRequestPage() {
  const actor = await requireActor()
  if (!canRequestPurchase(actor)) redirect('/purchase-requests')

  const { contracts, awaitingContracts, contractLines, catalog } = await loadPurchaseRequestFormOptions()

  return (
    <div className="route-stack">
      <header className="page-heading">
        <div>
          <Link className="back-link" href="/purchase-requests">← ใบขอซื้อ</Link>
          <p className="section-kicker">NEW REQUEST</p>
          <h1>สร้างใบขอซื้อ</h1>
          <p>ข้อมูลคลัง สัญญา ราคา และการใช้งานย้อนหลังถูกดึงมาให้แล้ว ไม่ต้องพิมพ์ซ้ำ</p>
        </div>
      </header>

      <PurchaseRequestForm
        department={DEPARTMENTS[0]}
        departments={DEPARTMENTS}
        headName={actor.name ?? ''}
        contracts={contracts}
        awaitingContracts={awaitingContracts}
        contractLines={contractLines}
        catalog={catalog}
      />
    </div>
  )
}
