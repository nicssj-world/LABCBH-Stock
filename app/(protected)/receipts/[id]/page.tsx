import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PoImageUploader } from '@/components/receipts/PoImageUploader'
import { ReceiptPostPanel } from '@/components/receipts/ReceiptPostPanel'
import { StatusChip } from '@/components/ui/StatusChip'
import { canOperateStock } from '@/lib/auth/access'
import { requireActor } from '@/lib/auth/actor'
import { formatQuantity, formatThaiDate } from '@/lib/inventory/presenter'
import { getGoodsReceipt } from '@/lib/receipts/queries'

interface ReceiptDetailPageProps {
  params: Promise<{ id: string }>
  searchParams?: Promise<{ poUpload?: string | string[] | undefined }>
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

export default async function ReceiptDetailPage({ params, searchParams }: ReceiptDetailPageProps) {
  const actor = await requireActor()
  const [{ id }, resolvedSearchParams] = await Promise.all([
    params,
    searchParams ?? Promise.resolve({ poUpload: undefined }),
  ])
  if (!UUID_PATTERN.test(id)) notFound()

  const receipt = await getGoodsReceipt(id)
  if (!receipt) notFound()

  const canEdit = canOperateStock(actor)
  const poUploadFailed = resolvedSearchParams.poUpload === 'failed'

  return (
    <div className="route-stack">
      <header className="contract-detail-heading">
        <div>
          <Link className="back-link" href="/receipts">← รับเข้าคลัง</Link>
          <div className="contract-detail-heading__status">
            <StatusChip tone={STATUS_TONES[receipt.status]}>{STATUS_LABELS[receipt.status]}</StatusChip>
            <span>{receipt.purchaseRequestNumber ?? 'ไม่อ้างอิงใบ PR'}</span>
          </div>
          <h1 className="identifier">{receipt.poNumber ?? 'ไม่ระบุเลขที่ใบสั่งซื้อ'}</h1>
          <p>รับเมื่อ {formatThaiDate(receipt.receivedDate)} โดย {receipt.receiverName}</p>
        </div>
      </header>

      {poUploadFailed && (
        <p className="inline-alert" role="alert">
          สร้างใบรับเข้าแล้ว แต่แนบไฟล์ PO ไม่สำเร็จ กรุณาเลือกไฟล์อีกครั้งแล้วอัปโหลดจากช่องด้านขวา
        </p>
      )}

      <section className="contract-facts" aria-label="ข้อมูลสรุปใบรับเข้า">
        <dl>
          <div><dt>หน่วยงาน</dt><dd>{receipt.department}</dd></div>
          <div><dt>จำนวนล็อต</dt><dd className="identifier">{receipt.items.length}</dd></div>
          <div><dt>รวมที่รับเข้า</dt><dd className="identifier">{formatQuantity(receipt.totalQuantity)}</dd></div>
          <div>
            <dt>บันทึกเข้าคลัง</dt>
            <dd>{receipt.postedAt ? `${formatThaiDate(receipt.postedAt.slice(0, 10))} · ${receipt.postedByName ?? ''}` : 'ยังไม่บันทึก'}</dd>
          </div>
        </dl>
      </section>

      <div className="inventory-detail-grid">
        <section className="bench-panel" aria-labelledby="receipt-detail-lines-title">
          <div className="bench-panel__header">
            <div>
              <p className="section-kicker">LOTS RECEIVED</p>
              <h2 id="receipt-detail-lines-title">ล็อตในใบรับนี้</h2>
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
                    <td>{item.name}</td>
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

        <aside className="bench-panel" aria-labelledby="po-image-title">
          <div className="bench-panel__header">
            <div>
              <p className="section-kicker">PO EVIDENCE</p>
              <h2 id="po-image-title">ไฟล์ PO</h2>
            </div>
          </div>
          <PoImageUploader
            receiptId={receipt.id}
            hasImage={Boolean(receipt.poImagePath)}
            canEdit={canEdit}
          />
        </aside>
      </div>

      {canEdit && (
        <section className="bench-panel" aria-labelledby="receipt-post-title">
          <div className="bench-panel__header">
            <div>
              <p className="section-kicker">POST TO STOCK</p>
              <h2 id="receipt-post-title">บันทึกเข้าคลัง</h2>
            </div>
          </div>
          <ReceiptPostPanel receipt={receipt} />
        </section>
      )}
    </div>
  )
}
