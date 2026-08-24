'use client'

import { Button } from '@/components/ui/Button'
import { DetailIconLink } from '@/components/ui/DetailIconLink'
import { StatusChip } from '@/components/ui/StatusChip'
import { useDeferredDialog } from '@/components/ui/useDeferredDialog'
import { formatQuantity, formatThaiDate, formatThaiDateTime } from '@/lib/inventory/presenter'
import { REQUISITION_STATUS_LABELS, REQUISITION_STATUS_TONES } from '@/lib/requisitions/presenter'
import type { RequisitionRecord } from '@/lib/requisitions/types'

export function RequisitionSummaryDialog({ requisition }: { requisition: RequisitionRecord }) {
  // One of these renders per row, in both the table and the card layout,
  // so the dialog body is built only once someone opens it.
  const { dialogRef, isRendered, open: openDialog, unmount: unmountDialog } = useDeferredDialog()
  const dialogId = `requisition-summary-dialog-${requisition.id}`
  const titleId = `${dialogId}-title`
  const descriptionId = `${dialogId}-description`

  return (
    <>
      <button
        type="button"
        className="list-summary-trigger"
        aria-haspopup="dialog"
        aria-controls={isRendered ? dialogId : undefined}
        onClick={openDialog}
      >
        <strong>{requisition.documentNumber}</strong>
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
            unmountDialog()
          }}
          onClick={(event) => {
            if (event.target === event.currentTarget) unmountDialog()
          }}
        >
          <header className="app-dialog__header">
            <div>
              <h2 id={titleId}>{requisition.documentNumber}</h2>
              <p id={descriptionId}>ข้อมูลใบเบิกแบบย่อ</p>
            </div>
            <button type="button" className="app-dialog__close" aria-label="ปิดข้อมูลใบเบิกแบบย่อ" onClick={unmountDialog}>
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
                <dt>สถานะ</dt>
                <dd>
                  <StatusChip tone={REQUISITION_STATUS_TONES[requisition.status]}>
                    {REQUISITION_STATUS_LABELS[requisition.status]}
                  </StatusChip>
                </dd>
              </div>
              <div className="list-summary-dialog__fact--wide">
                <dt>การกันยอด</dt>
                <dd>
                  {requisition.status === 'waiting'
                    ? 'กันยอดแล้ว รอเจ้าหน้าที่คลังจ่าย'
                    : requisition.status === 'fulfilled'
                      ? 'ใช้ยอดกันแล้ว'
                      : 'คืนยอดแล้ว'}
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

            <section className="list-summary-dialog__items" aria-labelledby={`${dialogId}-items-title`}>
              <div className="list-summary-dialog__items-heading">
                <h3 id={`${dialogId}-items-title`}>รายการน้ำยา</h3>
                <span>{requisition.items.length} รายการ</span>
              </div>
              {requisition.items.length > 0 ? (
                <ol className="list-summary-dialog__item-list">
                  {requisition.items.map((item) => (
                    <li key={item.id} className="list-summary-dialog__item">
                      <div className="list-summary-dialog__item-identity">
                        <strong>{item.name}</strong>
                        <small>{item.lsCode}</small>
                      </div>
                      <div className="list-summary-dialog__item-value">
                        <strong>{formatQuantity(item.requestedQuantity, item.unit)}</strong>
                        <small>
                          {item.fulfilledQuantity === null
                            ? 'จำนวนที่ขอ'
                            : `จ่ายแล้ว ${formatQuantity(item.fulfilledQuantity, item.unit)}`}
                        </small>
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
              href={`/requisitions/${requisition.id}`}
              label={`เปิดรายละเอียดเต็มใบเบิก ${requisition.documentNumber}`}
              title="เปิดรายละเอียดเต็มใบเบิก"
              onClick={unmountDialog}
            />
            <Button variant="secondary" onClick={unmountDialog}>ปิด</Button>
          </footer>
        </dialog>
      )}
    </>
  )
}
