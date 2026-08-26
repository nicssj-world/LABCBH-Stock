import Link from 'next/link'
import { redirect } from 'next/navigation'
import { InventoryChecklistTable } from '@/components/inventory/InventoryChecklistTable'
import { AutoFilterBench } from '@/components/ui/AutoFilterBench'
import { StatusChip } from '@/components/ui/StatusChip'
import { canOperateStock } from '@/lib/auth/access'
import { requireActor } from '@/lib/auth/actor'
import { bangkokToday, listInventoryDepartments, listInventoryItems } from '@/lib/inventory/queries'
import { getStockCheckWeekStart } from '@/lib/inventory/checklist'
import { formatThaiDate } from '@/lib/inventory/presenter'
import type { InventoryItemRecord } from '@/lib/inventory/types'

interface InventoryChecklistPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)

export default async function InventoryChecklistPage({ searchParams }: InventoryChecklistPageProps) {
  const actor = await requireActor()
  if (!canOperateStock(actor)) {
    redirect('/access-denied')
  }

  const params = await searchParams
  const search = first(params.search)?.trim() ?? ''
  const department = first(params.department)?.trim() ?? ''

  let items: InventoryItemRecord[] = []
  let departments: string[] = []
  let error: string | null = null

  try {
    ;[items, departments] = await Promise.all([
      listInventoryItems({ search, department: department || undefined }, { includeAlertScope: false }),
      listInventoryDepartments(),
    ])
  } catch (caught) {
    error = caught instanceof Error ? caught.message : 'อ่านข้อมูลรายการตรวจนับไม่สำเร็จ'
  }

  const stockedItems = items.filter((item) => item.isActive && item.onHand > 0)
  const checkedCount = stockedItems.filter((item) => item.isStockCheckedThisWeek).length
  const weekStart = getStockCheckWeekStart(bangkokToday())
  const backParams = new URLSearchParams()
  if (search) backParams.set('search', search)
  if (department) backParams.set('department', department)
  const backHref = backParams.toString() ? `/inventory?${backParams.toString()}` : '/inventory'

  return (
    <div className="route-stack">
      <header className="page-heading page-heading--actions page-heading--stack inventory-checklist-heading">
        <div>
          <Link className="back-link" href={backHref}>← คลังน้ำยา</Link>
          <p className="section-kicker">WEEKLY STOCK CHECK</p>
          <h1>Check list ตรวจนับคงคลัง</h1>
          <p>ตรวจเฉพาะรายการที่เปิดใช้งานและมียอดคงเหลือ · สัปดาห์เริ่ม {formatThaiDate(weekStart)}</p>
        </div>
        <div className="page-heading__cluster">
          <StatusChip tone={checkedCount === stockedItems.length && stockedItems.length > 0 ? 'success' : 'info'}>
            {checkedCount} / {stockedItems.length} รายการตรวจแล้ว
          </StatusChip>
          <Link className="lab-link-button lab-link-button--secondary" href={backHref}>กลับหน้าคลัง</Link>
        </div>
      </header>

      <AutoFilterBench
        ariaLabel="ตัวกรองรายการ Check list"
        fields={[
          { type: 'search', name: 'search', label: 'ค้นหา', value: search, placeholder: 'รหัสพัสดุ หรือชื่อน้ำยา' },
          {
            type: 'select',
            name: 'department',
            label: 'หน่วยงานที่รับผิดชอบ',
            value: department,
            options: [
              { value: '', label: 'ทุกหน่วยงาน' },
              ...departments.map((name) => ({ value: name, label: name })),
            ],
          },
        ]}
      />

      {error ? (
        <section className="error-state" role="alert">
          <h2>ไม่สามารถแสดง Check list ได้</h2>
          <p>{error}</p>
          <Link className="text-link" href={backHref}>กลับหน้าคลัง</Link>
        </section>
      ) : (
        <section className="bench-panel inventory-checklist-panel" aria-labelledby="inventory-checklist-title">
          <div className="bench-panel__header">
            <div>
              <p className="section-kicker">CURRENT WEEK · {formatThaiDate(weekStart)}</p>
              <h2 id="inventory-checklist-title">รายการที่ต้องตรวจ</h2>
            </div>
            <p>คลิกชื่อน้ำยาเพื่อปรับยอดก่อนกดตรวจแล้ว</p>
          </div>
          {stockedItems.length > 0 ? (
            <InventoryChecklistTable key={weekStart} items={stockedItems} currentWeekStart={weekStart} />
          ) : (
            <div className="empty-state inventory-checklist__empty">
              <strong>ไม่มีรายการที่ต้องตรวจในตอนนี้</strong>
              <span>หน้านี้จะแสดงเฉพาะรายการที่เปิดใช้งานและมียอดคงเหลือมากกว่า 0</span>
            </div>
          )}
        </section>
      )}
    </div>
  )
}
