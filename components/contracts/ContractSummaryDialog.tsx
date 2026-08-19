'use client'

import { useRef, useState, useTransition } from 'react'
import { ContractRemainingGauge } from '@/components/contracts/ContractRemainingGauge'
import { Button } from '@/components/ui/Button'
import { DetailIconLink } from '@/components/ui/DetailIconLink'
import { StatusChip } from '@/components/ui/StatusChip'
import { useDeferredDialog } from '@/components/ui/useDeferredDialog'
import { contractFileUrl } from '@/lib/contracts/file-actions'
import type { PresentedContract } from '@/lib/contracts/presenter'
import { formatThaiDate } from '@/lib/inventory/presenter'

function statusTone(contract: PresentedContract) {
  if (contract.effectiveStatus === 'active') return 'success' as const
  if (contract.effectiveStatus === 'cancelled' || contract.effectiveStatus === 'expired') return 'danger' as const
  return 'attention' as const
}

interface ContractSummaryDialogProps {
  contract: PresentedContract
  variant?: 'table' | 'card'
}

export function ContractSummaryDialog({ contract, variant = 'table' }: ContractSummaryDialogProps) {
  // The register renders one of these per contract, in both the table and
  // the card layout, so both dialogs below are built only once the summary
  // is opened. The file preview can only be reached from inside the
  // summary, so the one flag correctly gates both.
  const { dialogRef, isRendered, open: openDialog, close: closeDialog } = useDeferredDialog()
  const previewDialogRef = useRef<HTMLDialogElement>(null)
  const dialogId = `contract-summary-dialog-${contract.id}-${variant}`
  const titleId = `${dialogId}-title`
  const descriptionId = `${dialogId}-description`
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [isPreviewPending, startPreviewTransition] = useTransition()

  const openFilePreview = () => {
    if (!contract.fileUrl) return
    setPreviewError(null)
    startPreviewTransition(async () => {
      try {
        const signedUrl = await contractFileUrl(contract.id, contract.fileUrl!)
        setPreviewUrl(signedUrl)
        closeDialog()
        previewDialogRef.current?.showModal()
      } catch (caught) {
        setPreviewError(caught instanceof Error ? caught.message : 'เปิดไฟล์สัญญาไม่สำเร็จ')
      }
    })
  }

  const closeFilePreview = () => {
    previewDialogRef.current?.close()
    setPreviewUrl(null)
  }

  return (
    <>
      <button
        type="button"
        className={`contract-summary-trigger contract-summary-trigger--${variant}`}
        aria-haspopup="dialog"
        aria-controls={isRendered ? dialogId : undefined}
        onClick={openDialog}
      >
        {variant === 'table' ? <strong>{contract.resolvedDisplayName}</strong> : contract.resolvedDisplayName}
      </button>

      {isRendered && (
        <>
        <dialog
          ref={dialogRef}
          id={dialogId}
          className="app-dialog contract-summary-dialog"
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
              <h2 id={titleId}>{contract.resolvedDisplayName}</h2>
              <p id={descriptionId}>ข้อมูลสัญญาแบบย่อ · {contract.contractNumberLabel}</p>
            </div>
            <button type="button" className="app-dialog__close" aria-label="ปิดข้อมูลสัญญาแบบย่อ" onClick={closeDialog}>
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                <path d="m6 6 12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </header>

          <div className="app-dialog__body contract-summary-dialog__body">
            <dl className="contract-summary-dialog__facts">
              <div>
                <dt>เลขที่สัญญา</dt>
                <dd className="identifier">{contract.contractNumberLabel}</dd>
              </div>
              <div>
                <dt>คู่สัญญา</dt>
                <dd>{contract.vendor || 'ไม่ระบุคู่สัญญา'}</dd>
              </div>
              <div>
                <dt>ประเภท</dt>
                <dd>{contract.contractTypeLabel}</dd>
              </div>
              <div>
                <dt>สถานะ</dt>
                <dd><StatusChip tone={statusTone(contract)}>{contract.contractStatusLabel}</StatusChip></dd>
              </div>
              <div>
                <dt>ขั้นตอนจัดซื้อ</dt>
                <dd><StatusChip tone="info">{contract.procurementStageLabel}</StatusChip></dd>
              </div>
              <div>
                <dt>ช่วงสัญญา</dt>
                <dd>{formatThaiDate(contract.startDate)} – {formatThaiDate(contract.endDate)}</dd>
              </div>
              <div className="contract-summary-dialog__fact--wide">
                <dt>หน่วยงาน</dt>
                <dd>{contract.department || 'ไม่ระบุหน่วยงาน'}</dd>
              </div>
            </dl>

            <section className="contract-summary-dialog__balance" aria-label="ยอดคงเหลือของสัญญา">
              <ContractRemainingGauge percent={contract.remainingPercent} />
            </section>

            {contract.contractType !== 'equipment_lease' && contract.items.length > 0 && (
              <p className="contract-summary-dialog__items">
                มีรายการสินค้าในสัญญา {contract.items.length} รายการ · เปิดรายการทั้งหมดได้จากหน้ารายละเอียด
              </p>
            )}

            {contract.expiryNotice && (
              <p className={`contract-renewal-hint contract-renewal-hint--${contract.expiryNotice.tone}`} role="status">
                <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                  <path d="M12 7v5l3 2M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {contract.expiryNotice.label}
              </p>
            )}
          </div>

          {previewError && <p className="form-error contract-summary-dialog__error" role="alert">{previewError}</p>}

          <footer className="contract-summary-dialog__footer">
            {contract.fileUrl && (
              <Button
                variant="ghost"
                className="contract-file-control contract-file-control--view contract-summary-dialog__preview-trigger"
                aria-label="เปิดดูไฟล์สัญญา"
                title="เปิดดูไฟล์สัญญา"
                disabled={isPreviewPending}
                onClick={openFilePreview}
              >
                <svg viewBox="0 0 24 24" width="21" height="21" aria-hidden="true">
                  <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6ZM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </Button>
            )}
            <DetailIconLink
              href={`/contracts/${contract.id}`}
              label={`เปิดรายละเอียดเต็มสัญญา ${contract.contractNumberLabel}`}
              title="เปิดรายละเอียดเต็มสัญญา"
              onClick={closeDialog}
            />
            <Button variant="secondary" onClick={closeDialog}>ปิด</Button>
          </footer>
        </dialog>

        <dialog
          ref={previewDialogRef}
          className="app-dialog file-preview-dialog"
          aria-labelledby={`${dialogId}-file-title`}
          onCancel={(event) => {
            event.preventDefault()
            closeFilePreview()
          }}
          onClick={(event) => {
            if (event.target === event.currentTarget) closeFilePreview()
          }}
        >
          <header className="app-dialog__header">
            <div>
              <h2 id={`${dialogId}-file-title`}>ไฟล์สัญญา</h2>
              <p>{contract.resolvedDisplayName} · {contract.contractNumberLabel}</p>
            </div>
            <button type="button" className="app-dialog__close" aria-label="ปิดตัวอย่างไฟล์สัญญา" onClick={closeFilePreview}>
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                <path d="m6 6 12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </header>
          <div className="app-dialog__body file-preview-dialog__body">
            {previewUrl && <iframe title="ตัวอย่างไฟล์สัญญา" src={previewUrl} />}
          </div>
        </dialog>
        </>
      )}
    </>
  )
}
