import Link from 'next/link'
import { StatusChip } from '@/components/ui/StatusChip'
import { AutoFilterBench } from '@/components/ui/AutoFilterBench'
import { DetailIconLink } from '@/components/ui/DetailIconLink'
import { canOperateStock } from '@/lib/auth/access'
import { requireActor } from '@/lib/auth/actor'
import { formatQuantity, formatThaiDate } from '@/lib/inventory/presenter'
import { DEPARTMENTS } from '@/lib/organization/departments'
import { GoodsReceiptSummaryDialog } from '@/components/receipts/GoodsReceiptSummaryDialog'
import { GOODS_RECEIPT_STATUS_LABELS, GOODS_RECEIPT_STATUS_TONES } from '@/lib/receipts/presenter'
import { listGoodsReceipts } from '@/lib/receipts/queries'
import { GOODS_RECEIPT_STATUSES } from '@/lib/receipts/schema'
import type { GoodsReceiptRecord } from '@/lib/receipts/types'

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

  let receipts: GoodsReceiptRecord[] = []
  let error: string | null = null

  try {
    receipts = await listGoodsReceipts({ status, search, department: department || undefined })
  } catch (caught) {
    error = caught instanceof Error ? caught.message : 'อ่านรายการรับเข้าไม่สำเร็จ'
  }

  const draftCount = receipts.filter((receipt) => receipt.status === 'draft').length

  return (
    <div className="route-stack">
      <header className="page-heading page-heading--actions">
        <div>
          <p className="section-kicker">GOODS RECEIVING</p>
          <h1>รับเข้าคลัง</h1>
          <p>ล็อตและยอดคงเหลือจะเกิดขึ้นเมื่อบันทึกใบรับเข้าคลังเท่านั้น</p>
        </div>
        <div className="page-heading__cluster">
          <StatusChip tone={draftCount ? 'attention' : 'success'}>
            {draftCount ? `${draftCount} ฉบับร่างรอบันทึก` : 'ไม่มีฉบับร่างค้าง'}
          </StatusChip>
          {canOperateStock(actor) && (
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
            <p>{receipts.length} ใบ</p>
          </div>

          {receipts.length === 0 ? (
            <p className="empty-state">ไม่พบใบรับเข้าตามเงื่อนไขที่เลือก</p>
          ) : (
            <div className="detail-items-table">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>เลขที่ใบสั่งซื้อ</th>
                    <th>วันที่รับ</th>
                    <th>ผู้รับของ</th>
                    <th className="numeric-cell">จำนวนล็อต</th>
                    <th className="numeric-cell">รวมที่รับ</th>
                    <th>สถานะ</th>
                    <th><span className="visually-hidden">เปิดรายละเอียด</span></th>
                  </tr>
                </thead>
                <tbody>
                  {receipts.map((receipt) => (
                    <tr key={receipt.id}>
                      <td>
                        <GoodsReceiptSummaryDialog receipt={receipt} />
                        <small>{receipt.purchaseRequestNumber ?? 'ไม่อ้างอิงใบ PR'}</small>
                      </td>
                      <td>{formatThaiDate(receipt.receivedDate)}</td>
                      <td>{receipt.receiverName}</td>
                      <td className="numeric-cell identifier">{receipt.items.length}</td>
                      <td className="numeric-cell identifier">{formatQuantity(receipt.totalQuantity)}</td>
                      <td>
                        <StatusChip tone={GOODS_RECEIPT_STATUS_TONES[receipt.status]}>
                          {GOODS_RECEIPT_STATUS_LABELS[receipt.status]}
                        </StatusChip>
                      </td>
                      <td>
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
            </div>
          )}
        </section>
      )}
    </div>
  )
}
