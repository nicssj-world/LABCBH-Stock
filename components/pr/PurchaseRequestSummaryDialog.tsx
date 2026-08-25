'use client'

import Link from 'next/link'
import { PurchaseRequestPoFileOpenButton } from '@/components/pr/PurchaseRequestPoFileOpenButton'
import { PurchaseRequestOutsideStockReceiveControl } from '@/components/pr/PurchaseRequestOutsideStockReceiveControl'
import { Button } from '@/components/ui/Button'
import { DetailIconLink } from '@/components/ui/DetailIconLink'
import { StatusChip } from '@/components/ui/StatusChip'
import { useDeferredDialog } from '@/components/ui/useDeferredDialog'
import { formatQuantity, formatThaiDate, formatThaiDateTime } from '@/lib/inventory/presenter'
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
  canReceiveOutsideStock?: boolean
  canRetryOutsideStockCleanup?: boolean
  receiveOutsideStockAction: (purchaseRequestId: string) => Promise<unknown>
  retryOutsideStockCleanupAction: (purchaseRequestId: string) => Promise<void>
}

export function PurchaseRequestSummaryDialog({
  request,
  variant = 'table',
  canReceiveOutsideStock = false,
  canRetryOutsideStockCleanup = false,
  receiveOutsideStockAction,
  retryOutsideStockCleanupAction,
}: PurchaseRequestSummaryDialogProps) {
  // One of these renders per row, in both the table and the card layout,
  // so the dialog body is built only once someone opens it.
  const { dialogRef, isRendered, open: openDialog, unmount: unmountDialog } = useDeferredDialog()
  const dialogId = `pr-summary-dialog-${request.id}-${variant}`
  const titleId = `${dialogId}-title`
  const descriptionId = `${dialogId}-description`
  const isOutsideStockReceived = Boolean(request.outsideStockReceivedAt)

  return (
    <>
      <button
        type="button"
        className={`list-summary-trigger list-summary-trigger--${variant}`}
        aria-haspopup="dialog"
        aria-controls={isRendered ? dialogId : undefined}
        onClick={openDialog}
      >
        {variant === 'table' ? <strong className="identifier">{request.documentNumber}</strong> : request.documentNumber}
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
              <h2 id={titleId}>{request.documentNumber}</h2>
              <p id={descriptionId}>ข้อมูลใบ PR แบบย่อ · {PURCHASE_METHOD_LABELS[request.purchaseMethod]}</p>
            </div>
            <button type="button" className="app-dialog__close" aria-label="ปิดข้อมูลใบ PR แบบย่อ" onClick={unmountDialog}>
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                <path d="m6 6 12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </header>

          <div className="app-dialog__body list-summary-dialog__body">
            <dl className="list-summary-dialog__facts">
              <div>
                <dt>เลขที่ใบสั่งซื้อ (PO)</dt>
                <dd className="identifier list-summary-dialog__po-value">
                  <span>{request.poNumber ?? 'ยังไม่มี'}</span>
                  {request.poFile.path && !request.poFile.deletedAt && (
                    <PurchaseRequestPoFileOpenButton requestId={request.id} />
                  )}
                </dd>
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
                  <dt>เหตุผลที่ยกเลิก PR</dt>
                  <dd>{request.reversalReason}</dd>
                </div>
              )}
              {request.note && (
                <div className="list-summary-dialog__fact--wide">
                  <dt>หมายเหตุจากผู้ขอ</dt>
                  <dd>{request.note}</dd>
                </div>
              )}
              {request.outsideStockReceivedNote && (
                <div className="list-summary-dialog__fact--wide">
                  <dt>หมายเหตุระบบ</dt>
                  <dd>
                    <strong>{request.outsideStockReceivedNote}</strong>
                    <small>
                      โดย {request.outsideStockReceivedByName ?? 'ผู้ดำเนินการ'} · {formatThaiDateTime(request.outsideStockReceivedAt)}
                    </small>
                  </dd>
                </div>
              )}
              {request.createdContractId && (
                <div className="list-summary-dialog__fact--wide">
                  <dt>สัญญาที่สร้าง</dt>
                  <dd>
                    <Link className="identifier" href={`/contracts/${request.createdContractId}`} onClick={unmountDialog}>
                      เปิดสัญญา →
                    </Link>
                  </dd>
                </div>
              )}
            </dl>

            <section className="list-summary-dialog__items" aria-labelledby={`${dialogId}-items-title`}>
              <div className="list-summary-dialog__items-heading">
                <h3 id={`${dialogId}-items-title`}>รายการน้ำยา</h3>
                <span>{request.items.length} รายการ</span>
              </div>
              {request.items.length > 0 ? (
                <ol className="list-summary-dialog__item-list">
                  {request.items.map((item) => (
                    <li key={item.id} className="list-summary-dialog__item">
                      <div className="list-summary-dialog__item-identity">
                        <strong>{item.name}</strong>
                        <small>{item.lsCode}</small>
                      </div>
                      <div className="list-summary-dialog__item-value">
                        <strong>
                          {isOutsideStockReceived ? 'ไม่เข้าคลัง' : formatQuantity(item.remainingQuantity, item.unit)}
                        </strong>
                        <small>
                          {isOutsideStockReceived
                            ? `หน่วยงานรับของเอง · ไม่เข้าคลัง · ขอ ${formatQuantity(item.requestedQuantity, item.unit)}`
                            : `คงเหลือจากขอ ${formatQuantity(item.requestedQuantity, item.unit)}`}
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
            <PurchaseRequestOutsideStockReceiveControl
              requestId={request.id}
              documentNumber={request.documentNumber}
              canReceive={canReceiveOutsideStock}
              canRetryCleanup={canRetryOutsideStockCleanup}
              receiveAction={receiveOutsideStockAction}
              retryCleanupAction={retryOutsideStockCleanupAction}
              variant="summary"
            />
            <DetailIconLink
              href={`/purchase-requests/${request.id}`}
              label={`เปิดรายละเอียดเต็มใบ PR ${request.documentNumber}`}
              title="เปิดรายละเอียดเต็มใบ PR"
              onClick={unmountDialog}
            />
            <Button variant="secondary" onClick={unmountDialog}>ปิด</Button>
          </footer>
        </dialog>
      )}
    </>
  )
}
