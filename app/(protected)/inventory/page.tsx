import Link from 'next/link'
import { InventoryMinimumStockSettings } from '@/components/inventory/InventoryMinimumStockSettings'
import { InventoryTable } from '@/components/inventory/InventoryTable'
import { AutoFilterBench } from '@/components/ui/AutoFilterBench'
import { StatusChip } from '@/components/ui/StatusChip'
import { canOperateStock, hasAppRole } from '@/lib/auth/access'
import { requireActor } from '@/lib/auth/actor'
import {
  getInventoryMinimumStockMonths,
  listInventoryDepartments,
  listInventoryItems,
} from '@/lib/inventory/queries'
import { DEPARTMENTS } from '@/lib/organization/departments'
import type { InventoryItemRecord } from '@/lib/inventory/types'

interface InventoryPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)

export default async function InventoryPage({ searchParams }: InventoryPageProps) {
  const actor = await requireActor()
  const params = await searchParams
  const search = first(params.search)?.trim() ?? ''
  const department = first(params.department)?.trim() ?? ''
  const includeInactive = first(params.includeInactive) === '1'
  const onlyAlerts = first(params.onlyAlerts) === '1'

  let items: InventoryItemRecord[] = []
  let departments: string[] = []
  let minimumStockMonths = 1.5
  let error: string | null = null

  try {
    ;[items, departments, minimumStockMonths] = await Promise.all([
      listInventoryItems({ search, department: department || undefined, includeInactive }),
      listInventoryDepartments(),
      getInventoryMinimumStockMonths(),
    ])
  } catch (caught) {
    error = caught instanceof Error ? caught.message : 'อ่านข้อมูลคลังไม่สำเร็จ'
  }

  const alertCount = items.filter((item) => item.stockLevel !== 'healthy').length
  const visibleItems = onlyAlerts ? items.filter((item) => item.stockLevel !== 'healthy') : items
  const departmentOptions = [...new Set([...DEPARTMENTS, ...departments])].sort((left, right) => left.localeCompare(right, 'th'))

  const activeParams = new URLSearchParams()
  if (search) activeParams.set('search', search)
  if (department) activeParams.set('department', department)
  if (includeInactive) activeParams.set('includeInactive', '1')
  if (onlyAlerts) activeParams.set('onlyAlerts', '1')
  const toggleHref = (nextParams: URLSearchParams) => {
    const query = nextParams.toString()
    return query ? `/inventory?${query}` : '/inventory'
  }
  const alertsToggleParams = new URLSearchParams(activeParams)
  if (onlyAlerts) alertsToggleParams.delete('onlyAlerts')
  else alertsToggleParams.set('onlyAlerts', '1')
  const alertsHref = toggleHref(alertsToggleParams)
  const inactiveToggleParams = new URLSearchParams(activeParams)
  if (includeInactive) inactiveToggleParams.delete('includeInactive')
  else inactiveToggleParams.set('includeInactive', '1')
  const inactiveHref = toggleHref(inactiveToggleParams)

  return (
    <div className="route-stack">
      <header className="page-heading page-heading--actions page-heading--stack">
        <div>
          <p className="section-kicker">INVENTORY CATALOG</p>
          <h1>คลังน้ำยาและวัสดุวิทยาศาสตร์</h1>
          <p>ยอดคงเหลือคำนวณจากบัญชีเคลื่อนไหวจริง ไม่ใช่ค่าที่บันทึกทับได้</p>
        </div>
        <div className="page-heading__cluster">
          <StatusChip tone={alertCount ? 'danger' : 'success'}>
            {alertCount ? `${alertCount} รายการต้องทำ PR` : 'ยอดคงเหลือเพียงพอทุกรายการ'}
          </StatusChip>
          {alertCount > 0 && (
            <Link className="lab-link-button lab-link-button--secondary" href={alertsHref}>
              {onlyAlerts ? 'แสดงทุกรายการ' : 'เฉพาะรายการที่ต้องทำ PR'}
            </Link>
          )}
          <Link className="lab-link-button lab-link-button--secondary" href={inactiveHref}>
            {includeInactive ? 'ซ่อนรายการที่ปิดใช้งาน' : 'แสดงรายการที่ปิดใช้งาน'}
          </Link>
          {hasAppRole(actor, 'admin') && (
            <InventoryMinimumStockSettings minimumStockMonths={minimumStockMonths} />
          )}
          {canOperateStock(actor) && (
            <Link className="lab-link-button lab-link-button--primary" href="/inventory/new">
              เพิ่มรายการน้ำยา
            </Link>
          )}
        </div>
      </header>

      <AutoFilterBench
        ariaLabel="ตัวกรองรายการคลัง"
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
          <h2>ไม่สามารถแสดงข้อมูลคลังได้</h2>
          <p>{error}</p>
          <Link className="text-link" href="/inventory">ลองโหลดข้อมูลอีกครั้ง</Link>
        </section>
      ) : (
        <section className="bench-panel" aria-labelledby="inventory-catalog-title">
          <div className="bench-panel__header">
            <div>
              <p className="section-kicker">CATALOG</p>
              <h2 id="inventory-catalog-title">รายการน้ำยาในคลัง</h2>
            </div>
            <p>{visibleItems.length} รายการ</p>
          </div>
          <InventoryTable
            items={visibleItems}
            canEdit={canOperateStock(actor)}
            departments={departmentOptions}
          />
        </section>
      )}
    </div>
  )
}
