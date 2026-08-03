'use client'

import Link from 'next/link'
import { useRef } from 'react'
import { Button } from '@/components/ui/Button'
import { StatusChip } from '@/components/ui/StatusChip'
import { formatThaiDate } from '@/lib/inventory/presenter'
import {
  PURCHASE_METHOD_LABELS,
  PURCHASE_REQUEST_STATUS_LABELS,
  PURCHASE_REQUEST_STATUS_TONES,
  formatBaht,
} from '@/lib/pr/presenter'
import type { PurchaseRequestRecord } from '@/lib/pr/types'

/** A lease PR carries zero items, so request.total (summed from items) is
 *  always 0 — the ceiling entered on the contract draft is the real figure. */
function leaseCeilingLabel(request: PurchaseRequestRecord): string {
  const draft = request.methodDetails.contractDraft
  const total = draft && typeof draft === 'object' ? (draft as Record<string, unknown>).total : null
  return typeof total === 'number' ? formatBaht(total) : 'ไม่ระบุ'
}

export interface PurchaseRequestSummaryDialogProps {
  request: PurchaseRequestRecord
  variant?: 'table' | 'card'
}

export function PurchaseRequestSummaryDialog({ request, variant = 'table' }: PurchaseRequestSummaryDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const dialogId = `pr-summary-dialog-${request.id}-${variant}`
  const titleId = `${dialogId}-title`
  const descriptionId = `${dialogId}-description`

  const openDialog = () => dialogRef.current?.showModal()
  const closeDialog = () => dialogRef.current?.close()

  return (
    <>
      <button
        type="button"
        className={`list-summary-trigger list-summary-trigger--${variant}`}
        aria-haspopup="dialog"
        aria-controls={dialogId}
        onClick={openDialog}
      >
        {variant === 'table' ? <strong className="identifier">{request.documentNumber}</strong> : request.documentNumber}
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
            <h2 id={titleId}>{request.documentNumber}</h2>
            <p id={descriptionId}>ข้อมูลใบ PR แบบย่อ · {PURCHASE_METHOD_LABELS[request.purchaseMethod]}</p>
          </div>
          <button type="button" className="app-dialog__close" aria-label="ปิดข้อมูลใบ PR แบบย่อ" onClick={closeDialog}>
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path d="m6 6 12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <div className="app-dialog__body list-summary-dialog__body">
          <dl className="list-summary-dialog__facts">
            <div>
              <dt>เลขที่ใบสั่งซื้อ</dt>
              <dd className="identifier">{request.poNumber ?? 'ยังไม่มี'}</dd>
            </div>
            <div>
              <dt>วิธีจัดซื้อ</dt>
              <dd>{PURCHASE_METHOD_LABELS[request.purchaseMethod]}</dd>
            </div>
            <div>
              <dt>ผู้ขอ</dt>
              <dd>{request.requesterName ?? 'ไม่ระบุ'}</dd>
            </div>
            <div>
              <dt>หน่วยงาน</dt>
              <dd>{request.department}</dd>
            </div>
            <div>
              <dt>วันที่ขอ</dt>
              <dd className="identifier">{formatThaiDate(request.requestedDate)}</dd>
            </div>
            <div>
              <dt>มูลค่า</dt>
              <dd className="identifier">
                {request.purchaseMethod === 'equipment_lease' ? leaseCeilingLabel(request) : formatBaht(request.total)}
              </dd>
            </div>
            <div className="list-summary-dialog__fact--wide">
              <dt>สถานะ</dt>
              <dd>
                <StatusChip tone={PURCHASE_REQUEST_STATUS_TONES[request.status]}>
                  {PURCHASE_REQUEST_STATUS_LABELS[request.status]}
                </StatusChip>
              </dd>
            </div>
            {request.status === 'reversed' && request.reversalReason && (
              <div className="list-summary-dialog__fact--wide">
                <dt>เหตุผลที่กลับรายการ</dt>
                <dd>{request.reversalReason}</dd>
              </div>
            )}
            {request.createdContractId && (
              <div className="list-summary-dialog__fact--wide">
                <dt>สัญญาที่สร้าง</dt>
                <dd>
                  <Link className="identifier" href={`/contracts/${request.createdContractId}`} onClick={closeDialog}>
                    เปิดสัญญา →
                  </Link>
                </dd>
              </div>
            )}
          </dl>
        </div>

        <footer className="list-summary-dialog__footer">
          <Link className="lab-link-button lab-link-button--primary" href={`/purchase-requests/${request.id}`} onClick={closeDialog}>
            เปิดรายละเอียดเต็ม
          </Link>
          <Button variant="secondary" onClick={closeDialog}>ปิด</Button>
        </footer>
      </dialog>
    </>
  )
}
