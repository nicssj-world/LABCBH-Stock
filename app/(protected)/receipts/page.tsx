import Link from 'next/link'
import { StatusChip } from '@/components/ui/StatusChip'
import { AutoFilterBench } from '@/components/ui/AutoFilterBench'
import { DetailIconLink } from '@/components/ui/DetailIconLink'
import { ListPagination } from '@/components/ui/ListPagination'
import { StickyScroll } from '@/components/ui/StickyScroll'
import { canCreateGoodsReceipt } from '@/lib/auth/access'
import { requireActor } from '@/lib/auth/actor'
import { formatThaiDate, formatThaiDateTime } from '@/lib/inventory/presenter'
import { DEPARTMENTS } from '@/lib/organization/departments'
import { GoodsReceiptSummaryDialog } from '@/components/receipts/GoodsReceiptSummaryDialog'
import { GOODS_RECEIPT_STATUS_LABELS, GOODS_RECEIPT_STATUS_TONES } from '@/lib/receipts/presenter'
import { listGoodsReceipts } from '@/lib/receipts/queries'
import { GOODS_RECEIPT_STATUSES } from '@/lib/receipts/schema'
import type { GoodsReceiptRecord } from '@/lib/receipts/types'
import { LIST_PAGE_SIZE, paginate, parsePage } from '@/lib/pagination'

interface ReceiptsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)

export default async function ReceiptsPage({ searchParams }: ReceiptsPageProps) {
  const actor = await requireActor()
  const params = await searchParams
  const search = first(params.search)?.trim() ?? ''
  const statusValue = first(params.status)
  const status = GOODS_RECEIPT_STATUSES.find((value) => value === statusValue)
  const department = first(params.department)?.trim() ?? ''
  const issue = first(params.issue) === 'receiving-data-quality' ? 'receiving-data-quality' : undefined
  const fiscalYearValue = first(params.fiscalYear)
  const fiscalYear = fiscalYearValue && /^\d{4}$/.test(fiscalYearValue) ? Number(fiscalYearValue) : undefined
  const showCancelled = first(params.showCancelled) === '1'
  const page = parsePage(first(params.page))

  let receipts: GoodsReceiptRecord[] = []
  let error: string | null = null

  try {
    receipts = await listGoodsReceipts({
      status,
      search,
      department: department || undefined,
      fiscalYear,
      dataQualityOnly: Boolean(issue),
    })
  } catch (caught) {
    error = caught instanceof Error ? caught.message : 'อ่านรายการรับเข้าไม่สำเร็จ'
  }

  const shouldShowCancelled = showCancelled || status === 'cancelled'
  const cancelledCount = receipts.filter((receipt) => receipt.status === 'cancelled').length
  const visibleReceipts = shouldShowCancelled
    ? receipts
    : receipts.filter((receipt) => receipt.status !== 'cancelled')
  const draftCount = visibleReceipts.filter((receipt) => receipt.status === 'draft').length
  const paginatedReceipts = paginate(visibleReceipts, page, LIST_PAGE_SIZE)
  const buildPageHref = (nextPage: number) => {
    const nextParams = new URLSearchParams()
    if (search) nextParams.set('search', search)
    if (status) nextParams.set('status', status)
    if (department) nextParams.set('department', department)
    if (issue) nextParams.set('issue', issue)
    if (fiscalYear) nextParams.set('fiscalYear', String(fiscalYear))
    if (showCancelled) nextParams.set('showCancelled', '1')
    if (nextPage > 1) nextParams.set('page', String(nextPage))
    const query = nextParams.toString()
    return query ? `/receipts?${query}` : '/receipts'
  }
  const buildCancelledVisibilityHref = (nextShowCancelled: boolean) => {
    const nextParams = new URLSearchParams()
    if (search) nextParams.set('search', search)
    if (status && !(status === 'cancelled' && !nextShowCancelled)) nextParams.set('status', status)
    if (department) nextParams.set('department', department)
    if (issue) nextParams.set('issue', issue)
    if (fiscalYear) nextParams.set('fiscalYear', String(fiscalYear))
    if (nextShowCancelled) nextParams.set('showCancelled', '1')
    const query = nextParams.toString()
    return query ? `/receipts?${query}` : '/receipts'
  }
  const showCancelledControl = cancelledCount > 0 || status === 'cancelled' || showCancelled

  return (
    <div className="route-stack">
      <header className="page-heading page-heading--actions">
        <div>
          <p className="section-kicker">GOODS RECEIVING</p>
          <h1>รับเข้าคลัง</h1>
          <p>{issue ? 'แสดงเฉพาะใบรับเข้าที่พบปัญหาข้อมูลจาก Dashboard ผู้บริหาร' : 'ล็อตและยอดคงเหลือจะเกิดขึ้นเมื่อบันทึกใบรับเข้าคลังเท่านั้น'}</p>
        </div>
        <div className="page-heading__cluster">
          <StatusChip tone={draftCount ? 'attention' : 'success'}>
            {draftCount ? `${draftCount} ฉบับร่างรอบันทึก` : 'ไม่มีฉบับร่างค้าง'}
          </StatusChip>
          {canCreateGoodsReceipt(actor) && (
            <Link className="lab-link-button lab-link-button--primary" href="/receipts/new">
              สร้างใบรับเข้า
            </Link>
          )}
        </div>
      </header>

      <AutoFilterBench
        ariaLabel="ตัวกรองใบรับเข้า"
        fields={[
          {
            type: 'search',
            name: 'search',
            label: 'ค้นหา',
            value: search,
            placeholder: 'เลขที่ PO, เลขที่ PR, รหัสพัสดุ หรือชื่อน้ำยา',
          },
          {
            type: 'select',
            name: 'status',
            label: 'สถานะ',
            value: status ?? '',
            options: [
              { value: '', label: 'ทุกสถานะ' },
              ...GOODS_RECEIPT_STATUSES.map((value) => ({ value, label: GOODS_RECEIPT_STATUS_LABELS[value] })),
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

      {issue && (
        <p className="inline-alert inline-alert--info" role="status">
          ตัวกรองจาก Dashboard ผู้บริหาร: รับเข้าต้องตรวจสอบ{fiscalYear ? ` · ปีงบประมาณ ${fiscalYear}` : ''} · พบ {visibleReceipts.length.toLocaleString('th-TH')} ใบ
          {' '}<Link className="text-link" href="/receipts">แสดงรายการรับเข้าทั้งหมด</Link>
        </p>
      )}

      {error ? (
        <section className="error-state" role="alert">
          <h2>ไม่สามารถแสดงรายการรับเข้าได้</h2>
          <p>{error}</p>
          <Link className="text-link" href="/receipts">ลองโหลดข้อมูลอีกครั้ง</Link>
        </section>
      ) : (
        <section className="bench-panel" aria-labelledby="receipt-list-title">
          <div className="bench-panel__header">
            <div>
              <p className="section-kicker">RECEIVING QUEUE</p>
              <h2 id="receipt-list-title">รายการใบรับเข้า</h2>
            </div>
            <div className="receipt-list__header-actions">
              <p>{visibleReceipts.length} ใบ</p>
              {showCancelledControl && (
                <Link
                  className="lab-link-button lab-link-button--secondary"
                  href={buildCancelledVisibilityHref(!shouldShowCancelled)}
                  aria-pressed={shouldShowCancelled}
                >
                  {shouldShowCancelled ? 'ซ่อนรายการยกเลิก' : 'แสดงรายการยกเลิก'}
                </Link>
              )}
            </div>
          </div>

          {visibleReceipts.length === 0 ? (
            <p className="empty-state">{issue ? 'ไม่พบใบรับเข้าที่ตรงกับประเด็นนี้' : 'ไม่พบใบรับเข้าตามเงื่อนไขที่เลือก'}</p>
          ) : (
            <>
              <StickyScroll className="detail-items-table receipt-table--desktop" ariaLabel="ตารางใบรับเข้า เลื่อนในแนวนอนเพื่อดูคอลัมน์เพิ่มเติม">
              <table className="data-table receipt-register-table">
                <colgroup>
                  <col className="receipt-register-table__reference" />
                  <col className="receipt-register-table__date" />
                  <col className="receipt-register-table__department" />
                  <col className="receipt-register-table__receiver" />
                  <col className="receipt-register-table__status" />
                  <col className="receipt-register-table__action" />
                </colgroup>
                <thead>
                  <tr>
                    <th>อ้างอิง PO / PR</th>
                    <th>วันที่รับ</th>
                    <th>หน่วยงาน</th>
                    <th>ผู้รับของ</th>
                    <th className="receipt-register-table__cell--center">สถานะการลงคลัง</th>
                    <th className="receipt-register-table__cell--center">รายละเอียด</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedReceipts.items.map((receipt) => (
                    <tr key={receipt.id}>
                      <td className="receipt-register-table__reference-cell">
                        <GoodsReceiptSummaryDialog receipt={receipt} />
                        <small>{receipt.purchaseRequestNumber ?? 'ไม่อ้างอิงใบ PR'}</small>
                      </td>
                      <td className="receipt-register-table__date-cell">{formatThaiDate(receipt.receivedDate)}</td>
                      <td className="receipt-register-table__department-cell">{receipt.department}</td>
                      <td>{receipt.receiverName}</td>
                      <td className="receipt-register-table__cell--center receipt-register-table__status-cell">
                        <StatusChip tone={GOODS_RECEIPT_STATUS_TONES[receipt.status]}>
                          {GOODS_RECEIPT_STATUS_LABELS[receipt.status]}
                        </StatusChip>
                        {receipt.status === 'draft' && <small>รอบันทึกเข้าคลัง</small>}
                        {receipt.status === 'posted' && receipt.postedAt && <small>บันทึก {formatThaiDateTime(receipt.postedAt)}</small>}
                        {receipt.status === 'cancelled' && receipt.cancelledAt && <small>ยกเลิก {formatThaiDateTime(receipt.cancelledAt)}</small>}
                      </td>
                      <td className="receipt-register-table__cell--center receipt-register-table__action-cell">
                        <div className="detail-actions">
                          <DetailIconLink
                            href={`/receipts/${receipt.id}`}
                            label={`ดูรายละเอียดใบรับเข้า ${receipt.poNumber ?? receipt.purchaseRequestNumber ?? receipt.id}`}
                            title="ดูรายละเอียดใบรับเข้า"
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
              </StickyScroll>

              <ul className="receipt-task-cards" aria-label="รายการใบรับเข้า">
              {paginatedReceipts.items.map((receipt) => (
                <li key={receipt.id}>
                  <div className="task-card__topline">
                    <StatusChip tone={GOODS_RECEIPT_STATUS_TONES[receipt.status]}>
                      {GOODS_RECEIPT_STATUS_LABELS[receipt.status]}
                    </StatusChip>
                    <span className="identifier">{formatThaiDate(receipt.receivedDate)}</span>
                  </div>
                  <h3>
                    <GoodsReceiptSummaryDialog receipt={receipt} variant="card" />
                  </h3>
                  <p>{receipt.department} · ผู้รับ {receipt.receiverName}</p>
                  <p className="receipt-task-card__meta">
                    {receipt.purchaseRequestNumber
                      ? `อ้างอิง PR ${receipt.purchaseRequestNumber}`
                      : 'ไม่อ้างอิงใบ PR'}
                    {receipt.status === 'draft' && ' · รอลงคลัง'}
                    {receipt.status === 'posted' && receipt.postedAt && ` · ลงคลัง ${formatThaiDateTime(receipt.postedAt)}`}
                    {receipt.status === 'cancelled' && receipt.cancelledAt && ` · ยกเลิก ${formatThaiDateTime(receipt.cancelledAt)}`}
                  </p>
                  <div className="detail-actions task-card__action">
                    <DetailIconLink
                      href={`/receipts/${receipt.id}`}
                      label={`ดูรายละเอียดใบรับเข้า ${receipt.poNumber ?? receipt.purchaseRequestNumber ?? receipt.id}`}
                      title="ดูรายละเอียดใบรับเข้า"
                    />
                  </div>
                </li>
              ))}
              </ul>
            </>
          )}
          <ListPagination
            currentPage={paginatedReceipts.currentPage}
            pageCount={paginatedReceipts.pageCount}
            totalCount={paginatedReceipts.totalCount}
            startIndex={paginatedReceipts.startIndex}
            pageSize={LIST_PAGE_SIZE}
            itemLabel="ใบรับเข้า"
            buildHref={buildPageHref}
          />
        </section>
      )}
    </div>
  )
}
