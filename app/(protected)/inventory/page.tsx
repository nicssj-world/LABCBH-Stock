import Link from 'next/link'
import { InventoryTable } from '@/components/inventory/InventoryTable'
import { StatusChip } from '@/components/ui/StatusChip'
import { listInventoryDepartments, listInventoryItems } from '@/lib/inventory/queries'
import type { InventoryItemRecord } from '@/lib/inventory/types'

interface InventoryPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)

export default async function InventoryPage({ searchParams }: InventoryPageProps) {
  const params = await searchParams
  const search = first(params.search)?.trim() ?? ''
  const department = first(params.department)?.trim() ?? ''
  const includeInactive = first(params.includeInactive) === '1'
  const onlyAlerts = first(params.onlyAlerts) === '1'

  let items: InventoryItemRecord[] = []
  let departments: string[] = []
  let error: string | null = null

  try {
    ;[items, departments] = await Promise.all([
      listInventoryItems({ search, department: department || undefined, includeInactive }),
      listInventoryDepartments(),
    ])
  } catch (caught) {
    error = caught instanceof Error ? caught.message : 'อ่านข้อมูลคลังไม่สำเร็จ'
  }

  const alertCount = items.filter((item) => item.stockLevel !== 'healthy').length
  const visibleItems = onlyAlerts ? items.filter((item) => item.stockLevel !== 'healthy') : items

  return (
    <div className="route-stack">
      <header className="page-heading page-heading--actions">
        <div>
          <p className="section-kicker">INVENTORY CATALOG</p>
          <h1>คลังน้ำยาและวัสดุวิทยาศาสตร์</h1>
          <p>ยอดคงเหลือคำนวณจากบัญชีเคลื่อนไหวจริง ไม่ใช่ค่าที่บันทึกทับได้</p>
        </div>
        <StatusChip tone={alertCount ? 'danger' : 'success'}>
          {alertCount ? `${alertCount} รายการต้องทำ PR` : 'ยอดคงเหลือเพียงพอทุกรายการ'}
        </StatusChip>
      </header>

      <form className="filter-bench" method="get" aria-label="ตัวกรองรายการคลัง">
        <label className="filter-bench__search">
          ค้นหา
          <input type="search" name="search" defaultValue={search} placeholder="รหัส LS หรือชื่อน้ำยา" />
        </label>
        <label>
          หน่วยงานที่รับผิดชอบ
          <select name="department" defaultValue={department}>
            <option value="">ทุกหน่วยงาน</option>
            {departments.map((name) => <option value={name} key={name}>{name}</option>)}
          </select>
        </label>
        <label className="field-toggle">
          <input type="checkbox" name="onlyAlerts" value="1" defaultChecked={onlyAlerts} />
          เฉพาะรายการที่ต้องทำ PR
        </label>
        <label className="field-toggle">
          <input type="checkbox" name="includeInactive" value="1" defaultChecked={includeInactive} />
          แสดงรายการที่ปิดใช้งาน
        </label>
        <button className="lab-button lab-button--primary" type="submit">แสดงผล</button>
        <Link className="lab-link-button lab-link-button--secondary" href="/inventory">ล้างตัวกรอง</Link>
      </form>

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
          <InventoryTable items={visibleItems} />
        </section>
      )}
    </div>
  )
}
