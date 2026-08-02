import Link from 'next/link'
import { redirect } from 'next/navigation'
import { InventoryItemForm } from '@/components/inventory/InventoryItemForm'
import { canOperateStock } from '@/lib/auth/access'
import { requireActor } from '@/lib/auth/actor'
import { listInventoryDepartments } from '@/lib/inventory/queries'
import { DEPARTMENTS } from '@/lib/organization/departments'

export default async function NewInventoryItemPage() {
  const actor = await requireActor()
  if (!canOperateStock(actor)) redirect('/access-denied')

  const existingDepartments = await listInventoryDepartments()
  const departments = [...new Set([...DEPARTMENTS, ...existingDepartments])].sort((left, right) => left.localeCompare(right, 'th'))

  return (
    <div className="route-stack">
      <header className="page-heading page-heading--actions">
        <div>
          <Link className="back-link" href="/inventory">← คลังน้ำยา</Link>
          <p className="section-kicker">NEW INVENTORY ITEM</p>
          <h1>เพิ่มรายการน้ำยา</h1>
          <p>สร้างข้อมูลหลักของรายการเพื่อให้เลือกใช้ใน PR ใบรับเข้า และใบเบิก</p>
        </div>
      </header>

      <InventoryItemForm departments={departments} />
    </div>
  )
}
