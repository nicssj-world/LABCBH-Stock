import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ReceiptPostPanel } from '@/components/receipts/ReceiptPostPanel'
import { StatusChip } from '@/components/ui/StatusChip'
import { canOperateStock } from '@/lib/auth/access'
import { requireActor } from '@/lib/auth/actor'
import { formatQuantity, formatThaiDate, formatThaiDateTime } from '@/lib/inventory/presenter'
import { getGoodsReceipt } from '@/lib/receipts/queries'

interface ReceiptDetailPageProps {
  params: Promise<{ id: string }>
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const STATUS_LABELS = {
  draft: 'ฉบับร่าง',
  posted: 'บันทึกเข้าคลังแล้ว',
  cancelled: 'ยกเลิก',
} as const

const STATUS_TONES = {
  draft: 'attention',
  posted: 'success',
  cancelled: 'danger',
} as const

export default async function ReceiptDetailPage({ params }: ReceiptDetailPageProps) {
  const actor = await requireActor()
  const { id } = await params
  if (!UUID_PATTERN.test(id)) notFound()

  const receipt = await getGoodsReceipt(id)
  if (!receipt) notFound()

  const canEdit = canOperateStock(actor)

  return (
    <div className="route-stack">
      <header className="contract-detail-heading">
        <div className="contract-detail-heading__top">
          <Link className="contract-detail-back" href="/receipts">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path d="m14 6-6 6 6 6M8 12h10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>รับเข้าคลัง</span>
          </Link>
          <div className="contract-detail-heading__status">
            <StatusChip tone={STATUS_TONES[receipt.status]}>{STATUS_LABELS[receipt.status]}</StatusChip>
            {receipt.purchaseRequestId ? (
              <Link className="text-link" href={`/purchase-requests/${receipt.purchaseRequestId}`}>
                {receipt.purchaseRequestNumber ?? 'เปิดใบ PR'}
              </Link>
            ) : (
              <span>ไม่อ้างอิงใบ PR</span>
            )}
          </div>
        </div>

        <div className="contract-detail-heading__body contract-detail-heading__body--single">
          <div className="contract-detail-heading__identity">
            <h1 className="identifier">
              {receipt.purchaseRequestId && receipt.poNumber ? (
                <Link className="identifier text-link" href={`/purchase-requests/${receipt.purchaseRequestId}`}>
                  {receipt.poNumber}
                </Link>
              ) : (
                receipt.poNumber ?? 'ไม่ระบุเลขที่ใบสั่งซื้อ (PO)'
              )}
            </h1>
            <p>รับเมื่อ {formatThaiDate(receipt.receivedDate)}</p>
          </div>
        </div>

        <dl className="contract-facts contract-facts--receipt" aria-label="ข้อมูลสรุปใบรับเข้า">
          <div><dt>หน่วยงาน</dt><dd>{receipt.department}</dd></div>
          <div><dt>ผู้รับของ</dt><dd>{receipt.receiverName}</dd></div>
          <div>
            <dt>บันทึกเข้าคลัง</dt>
            <dd>{receipt.postedAt ? `${formatThaiDateTime(receipt.postedAt)} · ${receipt.postedByName ?? ''}` : 'ยังไม่บันทึก'}</dd>
          </div>
          {receipt.status === 'cancelled' && (
            <div>
              <dt>ยกเลิกใบรับเข้า</dt>
              <dd>{receipt.cancelledAt ? `${formatThaiDateTime(receipt.cancelledAt)} · ${receipt.cancelledByName ?? ''}` : 'ยกเลิกแล้ว'}</dd>
            </div>
          )}
        </dl>
      </header>

      {receipt.status === 'cancelled' && receipt.cancellationNote && (
        <p className="inline-alert" role="status">หมายเหตุการยกเลิก: {receipt.cancellationNote}</p>
      )}

      {receipt.status === 'posted' && (
        <p className="inline-alert inline-alert--info" role="note">
          ใบรับเข้านี้บันทึกเข้าคลังแล้ว จึงแก้ไขประวัติเดิมไม่ได้ หากยอดไม่ตรง ให้คลิกชื่อน้ำยาด้านล่าง แล้วเลือก “ปรับยอดคงคลัง” เพื่อเพิ่มหรือลดยอด พร้อมระบุเหตุผลทุกครั้ง
        </p>
      )}

      <section className="bench-panel" aria-labelledby="receipt-detail-lines-title">
        <div className="bench-panel__header">
          <div>
            <p className="section-kicker">RECEIVING DETAILS</p>
            <h2 id="receipt-detail-lines-title">รายการรับเข้า</h2>
          </div>
        </div>
        <div className="detail-items-table">
          <table className="data-table">
            <thead>
              <tr>
                <th>รหัสพัสดุ</th>
                <th>ชื่อน้ำยา</th>
                <th>เลขที่ล็อต</th>
                <th>วันหมดอายุ</th>
                <th className="numeric-cell">จำนวน</th>
                <th>จัดเก็บที่</th>
              </tr>
            </thead>
            <tbody>
              {receipt.items.map((item) => (
                <tr key={item.id}>
                  <td className="identifier">{item.lsCode}</td>
                  <td>
                    <Link className="text-link" href={`/inventory/${item.inventoryItemId}`}>
                      {item.name}
                    </Link>
                  </td>
                  <td className="identifier">{item.lotNumber}</td>
                  <td>{formatThaiDate(item.expiryDate)}</td>
                  <td className="numeric-cell identifier">{formatQuantity(item.quantity, item.unit)}</td>
                  <td>{item.storageLocation ?? 'ไม่ระบุ'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {canEdit && (
        <section
          className={receipt.status === 'draft' ? 'bench-panel bench-panel--decision' : 'bench-panel'}
          aria-labelledby="receipt-post-title"
        >
          <div className="bench-panel__header">
            <div>
              <p className="section-kicker">STOCK OFFICER</p>
              <h2 id="receipt-post-title">การดำเนินการของเจ้าหน้าที่คลัง</h2>
            </div>
          </div>
          <ReceiptPostPanel receipt={receipt} />
        </section>
      )}
    </div>
  )
}
