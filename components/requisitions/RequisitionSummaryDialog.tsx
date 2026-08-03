'use client'

import Link from 'next/link'
import { useRef } from 'react'
import { Button } from '@/components/ui/Button'
import { StatusChip } from '@/components/ui/StatusChip'
import { formatQuantity, formatThaiDate, formatThaiDateTime } from '@/lib/inventory/presenter'
import { REQUISITION_STATUS_LABELS, REQUISITION_STATUS_TONES } from '@/lib/requisitions/presenter'
import type { RequisitionRecord } from '@/lib/requisitions/types'

export function RequisitionSummaryDialog({ requisition }: { requisition: RequisitionRecord }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const dialogId = `requisition-summary-dialog-${requisition.id}`
  const titleId = `${dialogId}-title`
  const descriptionId = `${dialogId}-description`
  const totalRequested = requisition.items.reduce((sum, item) => sum + item.requestedQuantity, 0)

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
        <strong>{requisition.documentNumber}</strong>
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
            <h2 id={titleId}>{requisition.documentNumber}</h2>
            <p id={descriptionId}>ข้อมูลใบเบิกแบบย่อ</p>
          </div>
          <button type="button" className="app-dialog__close" aria-label="ปิดข้อมูลใบเบิกแบบย่อ" onClick={closeDialog}>
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path d="m6 6 12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <div className="app-dialog__body list-summary-dialog__body">
          <dl className="list-summary-dialog__facts">
            <div>
              <dt>ผู้ขอเบิก</dt>
              <dd>{requisition.requesterName}</dd>
            </div>
            <div>
              <dt>หน่วยงาน</dt>
              <dd>{requisition.department}</dd>
            </div>
            <div>
              <dt>ต้องการรับ</dt>
              <dd className="identifier">{formatThaiDate(requisition.desiredDate)}</dd>
            </div>
            <div>
              <dt>จำนวนรายการ</dt>
              <dd className="identifier">{requisition.items.length}</dd>
            </div>
            <div className="list-summary-dialog__fact--wide">
              <dt>รวมที่ขอ</dt>
              <dd className="identifier">{formatQuantity(totalRequested)}</dd>
            </div>
            <div className="list-summary-dialog__fact--wide">
              <dt>สถานะ</dt>
              <dd>
                <StatusChip tone={REQUISITION_STATUS_TONES[requisition.status]}>
                  {REQUISITION_STATUS_LABELS[requisition.status]}
                </StatusChip>
              </dd>
            </div>
            {requisition.status === 'fulfilled' && requisition.fulfilledAt && (
              <div className="list-summary-dialog__fact--wide">
                <dt>จ่ายของเมื่อ</dt>
                <dd className="identifier">
                  {formatThaiDateTime(requisition.fulfilledAt)} · {requisition.fulfilledByName ?? 'เจ้าหน้าที่คลัง'}
                </dd>
              </div>
            )}
            {requisition.signedAt && (
              <div className="list-summary-dialog__fact--wide">
                <dt>ผู้รับของเซ็นต์</dt>
                <dd className="identifier">
                  {requisition.receivedByName} · {formatThaiDateTime(requisition.signedAt)}
                </dd>
              </div>
            )}
          </dl>
        </div>

        <footer className="list-summary-dialog__footer">
          <Link className="lab-link-button lab-link-button--primary" href={`/requisitions/${requisition.id}`} onClick={closeDialog}>
            เปิดรายละเอียดเต็ม
          </Link>
          <Button variant="secondary" onClick={closeDialog}>ปิด</Button>
        </footer>
      </dialog>
    </>
  )
}
