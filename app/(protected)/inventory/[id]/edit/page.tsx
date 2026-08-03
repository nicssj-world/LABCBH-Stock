import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { InventoryItemForm } from '@/components/inventory/InventoryItemForm'
import { canOperateStock } from '@/lib/auth/access'
import { requireActor } from '@/lib/auth/actor'
import { getInventoryItem, listInventoryDepartments } from '@/lib/inventory/queries'
import { DEPARTMENTS } from '@/lib/organization/departments'

interface EditInventoryItemPageProps {
  params: Promise<{ id: string }>
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function EditInventoryItemPage({ params }: EditInventoryItemPageProps) {
  const { id } = await params
  if (!UUID_PATTERN.test(id)) notFound()

  const actor = await requireActor()
  if (!canOperateStock(actor)) redirect('/access-denied')

  const item = await getInventoryItem(id)
  if (!item) notFound()

  const existingDepartments = await listInventoryDepartments()
  const departments = [...new Set([...DEPARTMENTS, ...existingDepartments])].sort((left, right) => left.localeCompare(right, 'th'))

  return (
    <div className="route-stack">
      <header className="page-heading page-heading--actions">
        <div>
          <Link className="back-link" href={`/inventory/${item.id}`}>← {item.name}</Link>
          <p className="section-kicker">EDIT INVENTORY ITEM</p>
          <h1>แก้ไขรายการน้ำยา</h1>
          <p>ปรับข้อมูลหลักของรายการ รหัสพัสดุแก้ไขไม่ได้</p>
        </div>
      </header>

      <InventoryItemForm mode="edit" item={item} departments={departments} />
    </div>
  )
}
