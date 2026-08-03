'use client'

import Link from 'next/link'
import { useRef } from 'react'
import { Button } from '@/components/ui/Button'
import { StatusChip } from '@/components/ui/StatusChip'
import { formatQuantity, formatThaiDate, formatThaiDateTime } from '@/lib/inventory/presenter'
import { GOODS_RECEIPT_STATUS_LABELS, GOODS_RECEIPT_STATUS_TONES } from '@/lib/receipts/presenter'
import type { GoodsReceiptRecord } from '@/lib/receipts/types'

export function GoodsReceiptSummaryDialog({ receipt }: { receipt: GoodsReceiptRecord }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const dialogId = `receipt-summary-dialog-${receipt.id}`
  const titleId = `${dialogId}-title`
  const descriptionId = `${dialogId}-description`
  const title = receipt.poNumber ?? 'ไม่ระบุ PO'

  const openDialog = () => dialogRef.current?.showModal()
  const closeDialog = () => dialogRef.current?.close()

  return (
    <>
      <button
        type="button"
        className="list-summary-trigger"
        aria-haspopup="dialog"
        aria-controls={dialogId}
        onClick={openDialog}
      >
        <strong className="identifier">{title}</strong>
      </button>

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
        </div>

        <footer className="list-summary-dialog__footer">
          <Link className="lab-link-button lab-link-button--primary" href={`/receipts/${receipt.id}`} onClick={closeDialog}>
            เปิดรายละเอียดเต็ม
          </Link>
          <Button variant="secondary" onClick={closeDialog}>ปิด</Button>
        </footer>
      </dialog>
    </>
  )
}
