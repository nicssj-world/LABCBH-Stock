import Link from 'next/link'
import { StatusChip } from '@/components/ui/StatusChip'
import { requireActor } from '@/lib/auth/actor'
import { formatQuantity, formatThaiDate } from '@/lib/inventory/presenter'
import { canRequestPurchase } from '@/lib/pr/authorization'
import { listRequisitions } from '@/lib/requisitions/queries'
import { REQUISITION_STATUSES } from '@/lib/requisitions/schema'
import type { RequisitionRecord } from '@/lib/requisitions/types'

interface RequisitionsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)

const STATUS_LABELS = {
  waiting: 'รอจ่าย',
  fulfilled: 'จ่ายสำเร็จ',
  cancelled: 'ยกเลิก',
} as const

const STATUS_TONES = {
  waiting: 'attention',
  fulfilled: 'success',
  cancelled: 'danger',
} as const

export default async function RequisitionsPage({ searchParams }: RequisitionsPageProps) {
  const actor = await requireActor()
  const params = await searchParams
  const search = first(params.search)?.trim() ?? ''
  const statusValue = first(params.status)
  const status = REQUISITION_STATUSES.find((value) => value === statusValue)

  let requisitions: RequisitionRecord[] = []
  let error: string | null = null

  try {
    requisitions = await listRequisitions({ status, search })
  } catch (caught) {
    error = caught instanceof Error ? caught.message : 'อ่านรายการใบเบิกไม่สำเร็จ'
  }

  const waitingCount = requisitions.filter((requisition) => requisition.status === 'waiting').length

  return (
    <div className="route-stack">
      <header className="page-heading page-heading--actions">
        <div>
          <p className="section-kicker">REQUISITIONS</p>
          <h1>ใบเบิกน้ำยา</h1>
          <p>เจ้าหน้าที่คลังเลือกล็อตตามลำดับ FIFO การข้ามล็อตต้องระบุเหตุผล</p>
        </div>
        <div className="page-heading__cluster">
          <StatusChip tone={waitingCount ? 'attention' : 'success'}>
            {waitingCount ? `${waitingCount} ใบรอจ่าย` : 'ไม่มีใบรอจ่าย'}
          </StatusChip>
          {canRequestPurchase(actor) && (
            <Link className="lab-link-button lab-link-button--primary" href="/requisitions/new">
              สร้างใบเบิก
            </Link>
          )}
        </div>
      </header>

      <form className="filter-bench" method="get" aria-label="ตัวกรองใบเบิก">
        <label className="filter-bench__search">
          ค้นหา
          <input
            type="search"
            name="search"
            defaultValue={search}
            placeholder="เลขที่ใบเบิก ผู้ขอเบิก หรือหน่วยงาน"
          />
        </label>
        <label>
          สถานะ
          <select name="status" defaultValue={status ?? ''}>
            <option value="">ทุกสถานะ</option>
            {REQUISITION_STATUSES.map((value) => (
              <option value={value} key={value}>{STATUS_LABELS[value]}</option>
            ))}
          </select>
        </label>
        <button className="lab-button lab-button--primary" type="submit">แสดงผล</button>
        <Link className="lab-link-button lab-link-button--secondary" href="/requisitions">ล้างตัวกรอง</Link>
      </form>

      {error ? (
        <section className="error-state" role="alert">
          <h2>ไม่สามารถแสดงรายการใบเบิกได้</h2>
          <p>{error}</p>
          <Link className="text-link" href="/requisitions">ลองโหลดข้อมูลอีกครั้ง</Link>
        </section>
      ) : (
        <section className="bench-panel" aria-labelledby="requisition-list-title">
          <div className="bench-panel__header">
            <div>
              <p className="section-kicker">ISSUE QUEUE</p>
              <h2 id="requisition-list-title">รายการใบเบิก</h2>
            </div>
            <p>{requisitions.length} ใบ</p>
          </div>

          {requisitions.length === 0 ? (
            <p className="empty-state">ไม่พบใบเบิกตามเงื่อนไขที่เลือก</p>
          ) : (
            <div className="detail-items-table">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>เลขที่ใบเบิก</th>
                    <th>ต้องการรับ</th>
                    <th>ผู้ขอเบิก</th>
                    <th className="numeric-cell">รายการ</th>
                    <th className="numeric-cell">รวมที่ขอ</th>
                    <th>สถานะ</th>
                    <th><span className="visually-hidden">เปิดรายละเอียด</span></th>
                  </tr>
                </thead>
                <tbody>
                  {requisitions.map((requisition) => (
                    <tr key={requisition.id}>
                      <td className="identifier"><strong>{requisition.documentNumber}</strong></td>
                      <td>{formatThaiDate(requisition.desiredDate)}</td>
                      <td>
                        {requisition.requesterName}
                        <small>{requisition.department}</small>
                      </td>
                      <td className="numeric-cell identifier">{requisition.items.length}</td>
                      <td className="numeric-cell identifier">
                        {formatQuantity(
                          requisition.items.reduce((sum, item) => sum + item.requestedQuantity, 0),
                        )}
                      </td>
                      <td>
                        <StatusChip tone={STATUS_TONES[requisition.status]}>
                          {STATUS_LABELS[requisition.status]}
                        </StatusChip>
                      </td>
                      <td>
                        <Link className="text-link" href={`/requisitions/${requisition.id}`}>ดูรายละเอียด</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  )
}
