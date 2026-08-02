import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ContractForm } from '@/components/contracts/ContractForm'
import { hasAppRole } from '@/lib/auth/access'
import { requireActor } from '@/lib/auth/actor'
import { listInventoryItems } from '@/lib/inventory/queries'

export default async function NewContractPage() {
  const actor = await requireActor()
  if (!hasAppRole(actor, 'admin', 'head')) redirect('/access-denied')

  const inventoryItems = await listInventoryItems({})

  return (
    <div className="route-stack">
      <header className="page-heading page-heading--actions">
        <div>
          <p className="section-kicker">NEW CONTRACT</p>
          <h1>เพิ่มสัญญา</h1>
          <p>เริ่มทะเบียนที่ขั้น “ส่งพัสดุ” เลขที่สัญญาจะระบุได้เมื่อเริ่มสัญญา</p>
        </div>
        <Link className="lab-link-button lab-link-button--secondary" href="/contracts">กลับรายการสัญญา</Link>
      </header>
      <ContractForm
        mode="create"
        catalog={inventoryItems.map((item) => ({
          id: item.id,
          lsCode: item.lsCode,
          name: item.name,
          unit: item.baseUnit,
        }))}
      />
    </div>
  )
}
