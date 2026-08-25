import Link from 'next/link'
import { StatusChip } from '@/components/ui/StatusChip'
import { AutoFilterBench } from '@/components/ui/AutoFilterBench'
import { DetailIconLink } from '@/components/ui/DetailIconLink'
import { ListPagination } from '@/components/ui/ListPagination'
import { StickyScroll } from '@/components/ui/StickyScroll'
import { requireActor } from '@/lib/auth/actor'
import { formatThaiDate } from '@/lib/inventory/presenter'
import { DEPARTMENTS } from '@/lib/organization/departments'
import { canRequestPurchase } from '@/lib/pr/authorization'
import { RequisitionSummaryDialog } from '@/components/requisitions/RequisitionSummaryDialog'
import { REQUISITION_STATUS_LABELS, REQUISITION_STATUS_TONES } from '@/lib/requisitions/presenter'
import { listRequisitions } from '@/lib/requisitions/queries'
import { REQUISITION_STATUSES } from '@/lib/requisitions/schema'
import type { RequisitionRecord } from '@/lib/requisitions/types'
import { LIST_PAGE_SIZE, paginate, parsePage } from '@/lib/pagination'

interface RequisitionsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)

export default async function RequisitionsPage({ searchParams }: RequisitionsPageProps) {
  const actor = await requireActor()
  const params = await searchParams
  const search = first(params.search)?.trim() ?? ''
  const statusValue = first(params.status)
  const status = REQUISITION_STATUSES.find((value) => value === statusValue)
  const department = first(params.department)?.trim() ?? ''
  const page = parsePage(first(params.page))

  let requisitions: RequisitionRecord[] = []
  let error: string | null = null

  try {
    requisitions = await listRequisitions({ status, search, department: department || undefined })
  } catch (caught) {
    error = caught instanceof Error ? caught.message : 'อ่านรายการใบเบิกไม่สำเร็จ'
  }

  const waitingCount = requisitions.filter((requisition) => requisition.status === 'waiting').length
  const paginatedRequisitions = paginate(requisitions, page, LIST_PAGE_SIZE)
  const buildPageHref = (nextPage: number) => {
    const nextParams = new URLSearchParams()
    if (search) nextParams.set('search', search)
    if (status) nextParams.set('status', status)
    if (department) nextParams.set('department', department)
    if (nextPage > 1) nextParams.set('page', String(nextPage))
    const query = nextParams.toString()
    return query ? `/requisitions?${query}` : '/requisitions'
  }

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

      <AutoFilterBench
        ariaLabel="ตัวกรองใบเบิก"
        fields={[
          {
            type: 'search',
            name: 'search',
            label: 'ค้นหา',
            value: search,
            placeholder: 'เลขที่ใบเบิก ผู้ขอเบิก หรือหน่วยงาน',
          },
          {
            type: 'select',
            name: 'status',
            label: 'สถานะ',
            value: status ?? '',
            options: [
              { value: '', label: 'ทุกสถานะ' },
              ...REQUISITION_STATUSES.map((value) => ({ value, label: REQUISITION_STATUS_LABELS[value] })),
            ],
          },
          {
            type: 'select',
            name: 'department',
            label: 'หน่วยงาน',
            value: department,
            options: [
              { value: '', label: 'ทุกหน่วยงาน' },
              ...DEPARTMENTS.map((value) => ({ value, label: value })),
            ],
          },
        ]}
      />

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
            <StickyScroll className="detail-items-table" ariaLabel="ตารางใบเบิก เลื่อนในแนวนอนเพื่อดูคอลัมน์เพิ่มเติม">
              <table className="data-table requisition-register-table">
                <colgroup>
                  <col className="requisition-register-table__document" />
                  <col className="requisition-register-table__date" />
                  <col className="requisition-register-table__requester" />
                  <col className="requisition-register-table__items" />
                  <col className="requisition-register-table__status" />
                  <col className="requisition-register-table__action" />
                </colgroup>
                <thead>
                  <tr>
                    <th>เลขที่ใบเบิก</th>
                    <th>วันที่ขอเบิก</th>
                    <th>ผู้ขอเบิก</th>
                    <th className="requisition-register-table__cell--center requisition-register-table__items-cell">รายการ</th>
                    <th className="requisition-register-table__cell--center">สถานะ</th>
                    <th className="requisition-register-table__cell--center">รายละเอียด</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedRequisitions.items.map((requisition) => (
                    <tr key={requisition.id}>
                      <td className="identifier requisition-register-table__document-cell"><RequisitionSummaryDialog requisition={requisition} /></td>
                      <td className="requisition-register-table__date-cell">{formatThaiDate(requisition.desiredDate)}</td>
                      <td className="requisition-register-table__requester-cell">
                        {requisition.requesterName}
                        <small>{requisition.department}</small>
                      </td>
                      <td className="identifier requisition-register-table__cell--center requisition-register-table__items-cell">{requisition.items.length}</td>
                      <td className="requisition-register-table__cell--center requisition-register-table__status-cell">
                        <StatusChip tone={REQUISITION_STATUS_TONES[requisition.status]}>
                          {REQUISITION_STATUS_LABELS[requisition.status]}
                        </StatusChip>
                      </td>
                      <td className="requisition-register-table__cell--center requisition-register-table__action-cell">
                        <div className="detail-actions">
                          <DetailIconLink
                            href={`/requisitions/${requisition.id}`}
                            label={`ดูรายละเอียดใบเบิก ${requisition.documentNumber}`}
                            title="ดูรายละเอียดใบเบิก"
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
            </StickyScroll>
          )}
          <ListPagination
            currentPage={paginatedRequisitions.currentPage}
            pageCount={paginatedRequisitions.pageCount}
            totalCount={paginatedRequisitions.totalCount}
            startIndex={paginatedRequisitions.startIndex}
            pageSize={LIST_PAGE_SIZE}
            itemLabel="ใบเบิก"
            buildHref={buildPageHref}
          />
        </section>
      )}
    </div>
  )
}
