import Link from 'next/link'
import { InventoryExportDialog } from '@/components/inventory/InventoryExportDialog'
import { InventoryMinimumStockSettings } from '@/components/inventory/InventoryMinimumStockSettings'
import { InventoryTable } from '@/components/inventory/InventoryTable'
import { AutoFilterBench } from '@/components/ui/AutoFilterBench'
import { ListPagination } from '@/components/ui/ListPagination'
import { StatusChip } from '@/components/ui/StatusChip'
import { classifyStockAlert } from '@/lib/inventory/balance'
import { canOperateStock, hasAppRole } from '@/lib/auth/access'
import { requireActor } from '@/lib/auth/actor'
import {
  getInventoryMinimumStockMonths,
  listInventoryDepartments,
  listInventoryItems,
} from '@/lib/inventory/queries'
import { DEPARTMENTS } from '@/lib/organization/departments'
import type { InventoryItemRecord } from '@/lib/inventory/types'
import { LIST_PAGE_SIZE, paginate, parsePage } from '@/lib/pagination'

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
  const page = parsePage(first(params.page))

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

  // The count and the filter must read the same rule, or the button shows a
  // different set from the number that sent the requester to it.
  const alertOf = (item: InventoryItemRecord) =>
    classifyStockAlert({
      stockLevel: item.stockLevel,
      hasMovements: item.hasMovements,
      hasOpenRequest: item.hasOpenRequest,
      minimumStockOverride: item.minimumStockOverride,
    })

  const alertItems = items.filter((item) => alertOf(item) !== null)
  const depletedCount = alertItems.filter((item) => alertOf(item) === 'depleted').length
  const belowMinimumCount = alertItems.filter((item) => alertOf(item) === 'below_minimum').length
  const alertCount = alertItems.length
  const visibleItems = onlyAlerts ? alertItems : items
  const stockedItemCount = items.filter((item) => item.isActive && item.onHand > 0).length
  const paginatedItems = paginate(visibleItems, page, LIST_PAGE_SIZE)
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
  const checklistParams = new URLSearchParams()
  if (search) checklistParams.set('search', search)
  if (department) checklistParams.set('department', department)
  const checklistQuery = checklistParams.toString()
  const checklistHref = checklistQuery ? `/inventory/checklist?${checklistQuery}` : '/inventory/checklist'
  const inactiveToggleParams = new URLSearchParams(activeParams)
  if (includeInactive) inactiveToggleParams.delete('includeInactive')
  else inactiveToggleParams.set('includeInactive', '1')
  const inactiveHref = toggleHref(inactiveToggleParams)
  const buildPageHref = (nextPage: number) => {
    const nextParams = new URLSearchParams(activeParams)
    if (nextPage > 1) nextParams.set('page', String(nextPage))
    const query = nextParams.toString()
    return query ? `/inventory?${query}` : '/inventory'
  }

  return (
    <div className="route-stack">
      <header className="page-heading page-heading--actions page-heading--stack">
        <div>
          <p className="section-kicker">INVENTORY CATALOG</p>
          <h1>คลังน้ำยาและวัสดุวิทยาศาสตร์</h1>
          <p>ยอดคงเหลือคำนวณจากบัญชีเคลื่อนไหวจริง ไม่ใช่ค่าที่บันทึกทับได้</p>
        </div>
        <div className="page-heading__cluster">
          {alertCount === 0 ? (
            <StatusChip tone="success">ไม่มีรายการที่ต้องทำ PR</StatusChip>
          ) : (
            <>
              {depletedCount > 0 && (
                <StatusChip tone="danger">{depletedCount} รายการหมดคลัง</StatusChip>
              )}
              {belowMinimumCount > 0 && (
                <StatusChip tone="attention">{belowMinimumCount} รายการใกล้หมด</StatusChip>
              )}
            </>
          )}
          {alertCount > 0 && (
            <Link className="lab-link-button lab-link-button--secondary" href={alertsHref}>
              {onlyAlerts ? 'แสดงทุกรายการ' : 'เฉพาะรายการที่ต้องทำ PR'}
            </Link>
          )}
          <Link className="lab-link-button lab-link-button--secondary" href={inactiveHref}>
            {includeInactive ? 'ซ่อนรายการที่ปิดใช้งาน' : 'แสดงรายการที่ปิดใช้งาน'}
          </Link>
          <div className="page-heading__actions inventory-heading__actions">
            <InventoryExportDialog departments={departmentOptions} />
            {hasAppRole(actor, 'admin') && (
              <InventoryMinimumStockSettings minimumStockMonths={minimumStockMonths} />
            )}
            {canOperateStock(actor) && (
              <>
                <Link
                  className="lab-link-button lab-link-button--secondary inventory-checklist-trigger"
                  href={checklistHref}
                  aria-label={`เปิด Check list ตรวจนับ ${stockedItemCount} รายการ`}
                >
                  <span>Check list</span>
                  <span className="inventory-checklist-trigger__count" aria-hidden="true">{stockedItemCount}</span>
                </Link>
                <Link className="lab-link-button lab-link-button--primary" href="/inventory/new">
                  เพิ่มรายการน้ำยา
                </Link>
              </>
            )}
          </div>
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
            items={paginatedItems.items}
            canEdit={canOperateStock(actor)}
            departments={departmentOptions}
          />
          <ListPagination
            currentPage={paginatedItems.currentPage}
            pageCount={paginatedItems.pageCount}
            totalCount={paginatedItems.totalCount}
            startIndex={paginatedItems.startIndex}
            pageSize={LIST_PAGE_SIZE}
            itemLabel="รายการ"
            buildHref={buildPageHref}
          />
        </section>
      )}
    </div>
  )
}
