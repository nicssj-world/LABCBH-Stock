'use client'

import Link from 'next/link'
import { ServicePurchaseRequestExpenseDialog } from '@/components/service-procurement/ServicePurchaseRequestExpenseDialog'
import { Button } from '@/components/ui/Button'
import { DetailIconLink } from '@/components/ui/DetailIconLink'
import { StatusChip } from '@/components/ui/StatusChip'
import { useDeferredDialog } from '@/components/ui/useDeferredDialog'
import { formatQuantity, formatThaiDate } from '@/lib/inventory/presenter'
import { serviceExpenseNetTotal } from '@/lib/service-procurement/domain'
import {
  formatBaht,
  serviceMethodLabel,
  servicePoStatusLabel,
  serviceRequestDisplayStatus,
  serviceRequestDisplayStatusLabel,
  serviceRequestDisplayStatusTone,
} from '@/lib/service-procurement/presenter'
import type { ServicePurchaseRequestRecord } from '@/lib/service-procurement/types'

interface Props {
  request: ServicePurchaseRequestRecord
  variant?: 'table' | 'card'
}

export function ServicePurchaseRequestSummaryDialog({ request, variant = 'table' }: Props) {
  const { dialogRef, isRendered, open: openDialog, close: closeDialog } = useDeferredDialog()
  const dialogId = `service-pr-summary-dialog-${request.id}-${variant}`
  const titleId = `${dialogId}-title`
  const descriptionId = `${dialogId}-description`
  const requestedItems = request.items.filter((item) => item.requestedQuantity > 0)
  const hasPoEvidence = Boolean(request.poNumber?.trim() || request.poFileName?.trim())
  const displayStatus = serviceRequestDisplayStatus(request)
  const activeExpenseTotal = serviceExpenseNetTotal(request.usageEvents)

  return (
    <>
      <button
        type="button"
        className={`list-summary-trigger list-summary-trigger--${variant}`}
        aria-haspopup="dialog"
        aria-controls={isRendered ? dialogId : undefined}
        aria-label={`ดูข้อมูลใบ PR แบบย่อ ${request.documentNumber}`}
        onClick={openDialog}
      >
        {variant === 'table' ? <strong className="identifier">{request.documentNumber}</strong> : request.documentNumber}
      </button>

      {isRendered && (
        <dialog
          ref={dialogRef}
          id={dialogId}
          className="app-dialog list-summary-dialog service-pr-summary-dialog"
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
              <p id={descriptionId}>ข้อมูลใบ PR งานจ้างแบบย่อ · {serviceMethodLabel(request.purchaseMethod)}</p>
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
                <dt>หน่วยงาน</dt>
                <dd>{request.department}</dd>
              </div>
              <div>
                <dt>ผู้ขอ</dt>
                <dd>{request.requesterName}</dd>
              </div>
              <div>
                <dt>แผนงานจ้าง</dt>
                <dd><Link className="text-link" href={`/service-procurement/plans/${request.planId}`} onClick={closeDialog}>{request.planName ?? 'ไม่พบแผน'}</Link></dd>
              </div>
              <div>
                <dt>วันที่สร้างใบ PR</dt>
                <dd className="identifier">{formatThaiDate(request.requestedDate)}</dd>
              </div>
              <div>
                <dt>ช่วงวันที่ใช้ PO</dt>
                <dd className="identifier">{formatThaiDate(request.usageStartDate)} – {formatThaiDate(request.usageEndDate)}</dd>
              </div>
              <div>
                <dt>สถานะ PO</dt>
                <dd>{servicePoStatusLabel(request.poStatus)}</dd>
              </div>
              <div>
                <dt>เลข PR จาก E-Phis</dt>
                <dd className="identifier">{request.ephisPrNumber ?? 'ยังไม่ได้ระบุ'}</dd>
              </div>
              <div>
                <dt>เลข PO</dt>
                <dd className="identifier">
                  {request.poNumber ?? 'ยังไม่มี'}
                  {request.poFileName && <small className="service-pr-summary-dialog__subvalue">มีไฟล์แนบ: {request.poFileName}</small>}
                </dd>
              </div>
              <div>
                <dt>วงเงิน PR</dt>
                <dd className="identifier">{formatBaht(request.requestedAmount)}</dd>
              </div>
              <div>
                <dt>ใช้จ่ายสุทธิก่อนปิด PO</dt>
                <dd className="identifier">{formatBaht(activeExpenseTotal)}</dd>
              </div>
              <div className="list-summary-dialog__fact--wide">
                <dt>สถานะใบ PR</dt>
                <dd>
                  <StatusChip tone={serviceRequestDisplayStatusTone(displayStatus)}>
                    {serviceRequestDisplayStatusLabel(displayStatus)}
                  </StatusChip>
                </dd>
              </div>
              {request.note && (
                <div className="list-summary-dialog__fact--wide">
                  <dt>หมายเหตุ</dt>
                  <dd>{request.note}</dd>
                </div>
              )}
            </dl>

            <section className="list-summary-dialog__items service-pr-summary-dialog__items" aria-labelledby={`${dialogId}-items-title`}>
              <div className="list-summary-dialog__items-heading">
                <h3 id={`${dialogId}-items-title`}>รายการส่งตรวจ</h3>
                <span>{requestedItems.length} รายการ</span>
              </div>
              {requestedItems.length > 0 ? (
                <ol className="list-summary-dialog__item-list">
                  {requestedItems.map((item) => (
                    <li key={item.id} className="list-summary-dialog__item">
                      <div className="list-summary-dialog__item-identity">
                        <strong>{item.name}</strong>
                        <small>{item.unit}</small>
                      </div>
                      <div className="list-summary-dialog__item-value">
                        <strong>{formatQuantity(item.requestedQuantity, item.unit)}</strong>
                        <small>{item.unitPrice === null ? 'ไม่ระบุราคา' : `${formatBaht(item.unitPrice)} / หน่วย`} · รวม {item.lineTotal === null ? '—' : formatBaht(item.lineTotal)}</small>
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="list-summary-dialog__items-empty">ไม่มีรายการส่งตรวจในใบนี้</p>
              )}
            </section>
          </div>

          <footer className="list-summary-dialog__footer">
            {request.status === 'confirmed' && hasPoEvidence && (
            <ServicePurchaseRequestExpenseDialog
              request={request}
              className="service-pr-summary-dialog__expense-trigger"
            />
            )}
            <DetailIconLink
              href={`/service-procurement/purchase-requests/${request.id}`}
              label={`เปิดรายละเอียดเต็มใบ PR ${request.documentNumber}`}
              title="เปิดรายละเอียดเต็มใบ PR"
              onClick={closeDialog}
            />
            <Button variant="secondary" onClick={closeDialog}>ปิด</Button>
          </footer>
        </dialog>
      )}
    </>
  )
}
