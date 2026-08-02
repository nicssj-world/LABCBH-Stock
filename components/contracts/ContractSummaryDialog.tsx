'use client'

import Link from 'next/link'
import { useRef } from 'react'
import { ContractRemainingGauge } from '@/components/contracts/ContractRemainingGauge'
import { Button } from '@/components/ui/Button'
import { StatusChip } from '@/components/ui/StatusChip'
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
  const dialogRef = useRef<HTMLDialogElement>(null)
  const dialogId = `contract-summary-dialog-${contract.id}-${variant}`
  const titleId = `${dialogId}-title`
  const descriptionId = `${dialogId}-description`

  const openDialog = () => dialogRef.current?.showModal()
  const closeDialog = () => dialogRef.current?.close()

  return (
    <>
      <button
        type="button"
        className={`contract-summary-trigger contract-summary-trigger--${variant}`}
        aria-haspopup="dialog"
        aria-controls={dialogId}
        onClick={openDialog}
      >
        {variant === 'table' ? <strong>{contract.resolvedDisplayName}</strong> : contract.resolvedDisplayName}
      </button>

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

        <footer className="contract-summary-dialog__footer">
          <Link className="lab-link-button lab-link-button--primary" href={`/contracts/${contract.id}`} onClick={closeDialog}>
            เปิดรายละเอียดเต็ม
          </Link>
          <Button variant="secondary" onClick={closeDialog}>ปิด</Button>
        </footer>
      </dialog>
    </>
  )
}
