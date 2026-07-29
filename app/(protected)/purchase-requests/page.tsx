import Link from 'next/link'
import { PurchaseRequestTable } from '@/components/pr/PurchaseRequestTable'
import { StatusChip } from '@/components/ui/StatusChip'
import { requireActor } from '@/lib/auth/actor'
import { canRequestPurchase } from '@/lib/pr/authorization'
import { PURCHASE_REQUEST_STATUS_LABELS } from '@/lib/pr/presenter'
import { listPurchaseRequests } from '@/lib/pr/queries'
import { PURCHASE_REQUEST_STATUSES } from '@/lib/pr/schema'
import type { PurchaseRequestRecord } from '@/lib/pr/types'

interface PurchaseRequestsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)

export default async function PurchaseRequestsPage({ searchParams }: PurchaseRequestsPageProps) {
  const actor = await requireActor()
  const params = await searchParams
  const search = first(params.search)?.trim() ?? ''
  const statusValue = first(params.status)
  const status = PURCHASE_REQUEST_STATUSES.find((value) => value === statusValue)

  let requests: PurchaseRequestRecord[] = []
  let error: string | null = null

  try {
    requests = await listPurchaseRequests({ status, search })
  } catch (caught) {
    error = caught instanceof Error ? caught.message : 'อ่านรายการใบ PR ไม่สำเร็จ'
  }

  const pendingCount = requests.filter((request) => request.status === 'pending').length

  return (
    <div className="route-stack">
      <header className="page-heading page-heading--actions">
        <div>
          <p className="section-kicker">PURCHASE REQUESTS</p>
          <h1>ใบขอซื้อ (PR)</h1>
          <p>ยอดในสัญญาจะถูกตัดเมื่อเจ้าหน้าที่คลังยืนยันใบ PR เท่านั้น</p>
        </div>
        <div className="page-heading__cluster">
          <StatusChip tone={pendingCount ? 'attention' : 'success'}>
            {pendingCount ? `${pendingCount} ใบรอยืนยัน` : 'ไม่มีใบรอยืนยัน'}
          </StatusChip>
          {canRequestPurchase(actor) && (
            <Link className="lab-link-button lab-link-button--primary" href="/purchase-requests/new">
              สร้างใบ PR
            </Link>
          )}
        </div>
      </header>

      <form className="filter-bench" method="get" aria-label="ตัวกรองใบ PR">
        <label className="filter-bench__search">
          ค้นหา
          <input
            type="search"
            name="search"
            defaultValue={search}
            placeholder="เลขที่ PR, เลขที่ PO, รหัส LS หรือชื่อน้ำยา"
          />
        </label>
        <label>
          สถานะ
          <select name="status" defaultValue={status ?? ''}>
            <option value="">ทุกสถานะ</option>
            {PURCHASE_REQUEST_STATUSES.map((value) => (
              <option value={value} key={value}>{PURCHASE_REQUEST_STATUS_LABELS[value]}</option>
            ))}
          </select>
        </label>
        <button className="lab-button lab-button--primary" type="submit">แสดงผล</button>
        <Link className="lab-link-button lab-link-button--secondary" href="/purchase-requests">ล้างตัวกรอง</Link>
      </form>

      {error ? (
        <section className="error-state" role="alert">
          <h2>ไม่สามารถแสดงรายการใบ PR ได้</h2>
          <p>{error}</p>
          <Link className="text-link" href="/purchase-requests">ลองโหลดข้อมูลอีกครั้ง</Link>
        </section>
      ) : (
        <section className="bench-panel" aria-labelledby="pr-list-title">
          <div className="bench-panel__header">
            <div>
              <p className="section-kicker">REQUEST QUEUE</p>
              <h2 id="pr-list-title">รายการใบ PR</h2>
            </div>
            <p>{requests.length} ใบ</p>
          </div>
          <PurchaseRequestTable requests={requests} />
        </section>
      )}
    </div>
  )
}
