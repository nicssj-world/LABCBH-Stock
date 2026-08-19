'use client'

import { Button } from '@/components/ui/Button'
import { DetailIconLink } from '@/components/ui/DetailIconLink'
import { StatusChip } from '@/components/ui/StatusChip'
import { useDeferredDialog } from '@/components/ui/useDeferredDialog'
import { formatQuantity, formatThaiDate, formatThaiDateTime } from '@/lib/inventory/presenter'
import { GOODS_RECEIPT_STATUS_LABELS, GOODS_RECEIPT_STATUS_TONES } from '@/lib/receipts/presenter'
import type { GoodsReceiptRecord } from '@/lib/receipts/types'

export function GoodsReceiptSummaryDialog({ receipt }: { receipt: GoodsReceiptRecord }) {
  // One of these renders per row, in both the table and the card layout,
  // so the dialog body is built only once someone opens it.
  const { dialogRef, isRendered, open: openDialog, close: closeDialog } = useDeferredDialog()
  const dialogId = `receipt-summary-dialog-${receipt.id}`
  const titleId = `${dialogId}-title`
  const descriptionId = `${dialogId}-description`
  const title = receipt.poNumber ?? 'ไม่ระบุ PO'

  return (
    <>
      <button
        type="button"
        className="list-summary-trigger"
        aria-haspopup="dialog"
        aria-controls={isRendered ? dialogId : undefined}
        onClick={openDialog}
      >
        <strong className="identifier">{title}</strong>
      </button>

      {isRendered && (
        <dialog
          ref={dialogRef}
          id={dialogId}
          className="app-dialog list-summary-dialog"
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          onCancel={(event) => {
            event.preventDefault()
            closeDialog()
          }}
          onClick={(event) => {
            if (event.target === event.currentTarget) closeDialog()
          }}
        >
          <header className="app-dialog__header">
            <div>
              <h2 id={titleId}>{title}</h2>
              <p id={descriptionId}>ข้อมูลใบรับเข้าแบบย่อ</p>
            </div>
            <button type="button" className="app-dialog__close" aria-label="ปิดข้อมูลใบรับเข้าแบบย่อ" onClick={closeDialog}>
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                <path d="m6 6 12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </header>

          <div className="app-dialog__body list-summary-dialog__body">
            <dl className="list-summary-dialog__facts">
              <div>
                <dt>อ้างอิงใบ PR</dt>
                <dd className="identifier">{receipt.purchaseRequestNumber ?? 'ไม่อ้างอิงใบ PR'}</dd>
              </div>
              <div>
                <dt>หน่วยงาน</dt>
                <dd>{receipt.department}</dd>
              </div>
              <div>
                <dt>วันที่รับของ</dt>
                <dd className="identifier">{formatThaiDate(receipt.receivedDate)}</dd>
              </div>
              <div>
                <dt>ผู้รับของ</dt>
                <dd>{receipt.receiverName}</dd>
              </div>
              <div>
                <dt>จำนวนล็อต</dt>
                <dd className="identifier">{receipt.items.length}</dd>
              </div>
              <div>
                <dt>รวมที่รับ</dt>
                <dd className="identifier">{formatQuantity(receipt.totalQuantity)}</dd>
              </div>
              <div className="list-summary-dialog__fact--wide">
                <dt>สถานะ</dt>
                <dd>
                  <StatusChip tone={GOODS_RECEIPT_STATUS_TONES[receipt.status]}>
                    {GOODS_RECEIPT_STATUS_LABELS[receipt.status]}
                  </StatusChip>
                </dd>
              </div>
              {receipt.status === 'posted' && receipt.postedAt && (
                <div className="list-summary-dialog__fact--wide">
                  <dt>บันทึกเข้าคลังเมื่อ</dt>
                  <dd className="identifier">
                    {formatThaiDateTime(receipt.postedAt)} · {receipt.postedByName ?? 'เจ้าหน้าที่คลัง'}
                  </dd>
                </div>
              )}
            </dl>

            <section className="list-summary-dialog__items" aria-labelledby={`${dialogId}-items-title`}>
              <div className="list-summary-dialog__items-heading">
                <h3 id={`${dialogId}-items-title`}>รายการน้ำยา</h3>
                <span>{receipt.items.length} รายการ</span>
              </div>
              {receipt.items.length > 0 ? (
                <ol className="list-summary-dialog__item-list">
                  {receipt.items.map((item) => (
                    <li key={item.id} className="list-summary-dialog__item">
                      <div className="list-summary-dialog__item-identity">
                        <strong>{item.name}</strong>
                        <small>
                          {item.lsCode} · ล็อต {item.lotNumber}
                          {item.expiryDate ? ` · หมดอายุ ${formatThaiDate(item.expiryDate)}` : ''}
                        </small>
                      </div>
                      <div className="list-summary-dialog__item-value">
                        <strong>{formatQuantity(item.quantity, item.unit)}</strong>
                        <small>รับเข้า</small>
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="list-summary-dialog__items-empty">ไม่มีรายการน้ำยาในใบนี้</p>
              )}
            </section>
          </div>

          <footer className="list-summary-dialog__footer">
            <DetailIconLink
              href={`/receipts/${receipt.id}`}
              label={`เปิดรายละเอียดเต็มใบรับเข้า ${title}`}
              title="เปิดรายละเอียดเต็มใบรับเข้า"
              onClick={closeDialog}
            />
            <Button variant="secondary" onClick={closeDialog}>ปิด</Button>
          </footer>
        </dialog>
      )}
    </>
  )
}
