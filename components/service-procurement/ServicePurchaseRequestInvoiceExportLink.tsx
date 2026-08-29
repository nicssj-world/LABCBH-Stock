'use client'

import { useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { DownloadIcon } from '@/components/dashboard/DashboardIcons'
import { Button } from '@/components/ui/Button'
import { useDeferredDialog } from '@/components/ui/useDeferredDialog'
import {
  normalizeInvoiceSummaryNumber,
  type ServiceInvoiceSummaryNumberSuggestion,
} from '@/lib/service-procurement/invoice-summary-number'
import type { ServicePurchaseRequestRecord } from '@/lib/service-procurement/types'

const subscribeToClientReady = () => () => undefined

interface Props {
  request: Pick<ServicePurchaseRequestRecord, 'id' | 'documentNumber' | 'isRedCross'>
  className?: string
}

function isNumberSuggestion(value: unknown): value is ServiceInvoiceSummaryNumberSuggestion {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return (
    (candidate.assignedNumber === null || typeof candidate.assignedNumber === 'string')
    && typeof candidate.suggestedNumber === 'string'
    && typeof candidate.fiscalYear === 'number'
  )
}

async function responseMessage(response: Response, fallback: string) {
  try {
    const payload = await response.json() as { error?: unknown }
    return typeof payload.error === 'string' && payload.error ? payload.error : fallback
  } catch {
    return fallback
  }
}

export function ServicePurchaseRequestInvoiceExportLink({ request, className = '' }: Props) {
  const { dialogRef, isRendered, open: openDialog, close: closeDialog } = useDeferredDialog()
  const portalReady = useSyncExternalStore(subscribeToClientReady, () => true, () => false)
  const [suggestion, setSuggestion] = useState<ServiceInvoiceSummaryNumberSuggestion | null>(null)
  const [numberValue, setNumberValue] = useState('')
  const [numberWasEdited, setNumberWasEdited] = useState(false)
  const [loadingSuggestion, setLoadingSuggestion] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!request.isRedCross) return null

  const endpoint = `/api/service-procurement/purchase-requests/${request.id}/invoice-summary`
  const dialogId = `service-invoice-number-dialog-${request.id}`
  const titleId = `${dialogId}-title`
  const descriptionId = `${dialogId}-description`
  const hasAssignedNumber = Boolean(suggestion?.assignedNumber)

  async function loadSuggestion() {
    setLoadingSuggestion(true)
    setError(null)
    setSuggestion(null)
    setNumberValue('')
    setNumberWasEdited(false)
    try {
      const response = await fetch(`${endpoint}?mode=number`, { cache: 'no-store' })
      if (!response.ok) throw new Error(await responseMessage(response, 'อ่านเลขสรุปใบแจ้งหนี้ไม่สำเร็จ'))
      const payload: unknown = await response.json()
      if (!isNumberSuggestion(payload)) throw new Error('ข้อมูลเลขสรุปใบแจ้งหนี้ไม่ถูกต้อง')
      setSuggestion(payload)
      setNumberValue(payload.assignedNumber ?? payload.suggestedNumber)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'อ่านเลขสรุปใบแจ้งหนี้ไม่สำเร็จ')
    } finally {
      setLoadingSuggestion(false)
    }
  }

  function openExportDialog() {
    setError(null)
    openDialog()
    void loadSuggestion()
  }

  function closeExportDialog() {
    if (!pending) closeDialog()
  }

  async function exportPdf() {
    if (!suggestion || loadingSuggestion || pending) return

    const canonicalNumber = normalizeInvoiceSummaryNumber(numberValue, suggestion.fiscalYear)
    if (numberWasEdited && !canonicalNumber) {
      setError(`กรุณากรอกเลขในรูปแบบ xx/${suggestion.fiscalYear} เช่น 01/${suggestion.fiscalYear}`)
      return
    }

    setPending(true)
    setError(null)
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestedNumber: numberWasEdited ? canonicalNumber : null }),
      })
      if (!response.ok) throw new Error(await responseMessage(response, 'สร้างสรุปใบแจ้งหนี้ไม่สำเร็จ'))

      const pdf = await response.blob()
      const downloadUrl = window.URL.createObjectURL(pdf)
      const link = document.createElement('a')
      link.href = downloadUrl
      link.download = `สรุปใบแจ้งหนี้-${request.documentNumber}.pdf`
      link.style.display = 'none'
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => window.URL.revokeObjectURL(downloadUrl), 0)
      closeDialog()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'สร้างสรุปใบแจ้งหนี้ไม่สำเร็จ')
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      <button
        type="button"
        className={`lab-link-button lab-link-button--secondary service-pr-invoice-export ${className}`.trim()}
        aria-haspopup="dialog"
        aria-controls={isRendered ? dialogId : undefined}
        aria-label={`ส่งออกสรุปใบแจ้งหนี้ PDF สำหรับใบ PR ${request.documentNumber}`}
        title="ส่งออกสรุปใบแจ้งหนี้ PDF"
        onClick={openExportDialog}
      >
        <span className="service-pr-invoice-export__icon" aria-hidden="true"><DownloadIcon /></span>
        <span>สรุปใบแจ้งหนี้</span>
        <span className="service-pr-invoice-export__format" aria-hidden="true">PDF</span>
      </button>

      {portalReady && isRendered && createPortal(
        <dialog
          ref={dialogRef}
          id={dialogId}
          className="app-dialog service-invoice-number-dialog"
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          aria-busy={loadingSuggestion || pending}
          onCancel={(event) => {
            event.preventDefault()
            closeExportDialog()
          }}
          onClick={(event) => {
            if (event.target === event.currentTarget) closeExportDialog()
          }}
        >
          <header className="app-dialog__header">
            <div>
              <h2 id={titleId}>ส่งออกสรุปใบแจ้งหนี้</h2>
              <p id={descriptionId}>{request.documentNumber}</p>
            </div>
            <button type="button" className="app-dialog__close" aria-label="ปิดหน้าต่างส่งออกสรุปใบแจ้งหนี้" onClick={closeExportDialog} disabled={pending}>
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                <path d="m6 6 12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </header>

          <div className="app-dialog__body service-invoice-number-dialog__body">
            <div className="service-invoice-number-dialog__context">
              <span>เลขเอกสารสรุปใบแจ้งหนี้</span>
              <strong>{request.documentNumber}</strong>
            </div>

            <form
              className="service-invoice-number-dialog__form"
              onSubmit={(event) => {
                event.preventDefault()
                void exportPdf()
              }}
            >
              {loadingSuggestion ? (
                <p className="service-invoice-number-dialog__loading" role="status" aria-live="polite">กำลังเตรียมเลขสรุปใบแจ้งหนี้…</p>
              ) : (
                <label className="service-invoice-number-dialog__field">
                  <span>เลขที่สรุปใบแจ้งหนี้ <span className="field-required" aria-hidden="true">*</span></span>
                  <input
                    autoFocus
                    className={hasAssignedNumber ? 'service-invoice-number-dialog__input--locked' : ''}
                    value={numberValue}
                    placeholder={`01/${suggestion?.fiscalYear ?? '2569'}`}
                    readOnly={hasAssignedNumber}
                    aria-describedby={`${dialogId}-helper`}
                    onChange={(event) => {
                      setNumberValue(event.target.value)
                      setNumberWasEdited(true)
                      setError(null)
                    }}
                  />
                  <small id={`${dialogId}-helper`}>
                    {hasAssignedNumber ? 'เลขนี้ถูกกำหนดให้ใบ PR นี้แล้ว' : `รูปแบบ xx/${suggestion?.fiscalYear ?? 'ปีงบประมาณ'} เช่น 01/${suggestion?.fiscalYear ?? '2569'}`}
                  </small>
                </label>
              )}

              {error && <p className="service-invoice-number-dialog__error" role="alert">{error}</p>}

              <div className="service-invoice-number-dialog__actions">
                <Button type="button" variant="ghost" onClick={closeExportDialog} disabled={pending}>ยกเลิก</Button>
                <Button type="submit" disabled={loadingSuggestion || pending || !suggestion || !numberValue}>
                  {pending ? 'กำลังสร้าง PDF…' : 'ส่งออก PDF'}
                </Button>
              </div>
            </form>
          </div>
        </dialog>,
        document.body,
      )}
    </>
  )
}
