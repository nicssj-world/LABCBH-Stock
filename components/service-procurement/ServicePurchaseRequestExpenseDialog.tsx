'use client'

import { useRef, useState, useSyncExternalStore, useTransition } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { MoneyInput } from '@/components/ui/MoneyInput'
import { useDeferredDialog } from '@/components/ui/useDeferredDialog'
import { recordServiceLabExpense } from '@/lib/service-procurement/actions'
import { serviceCreditNoteSourceOptions, serviceExpenseEventsForDisplay, serviceExpenseNetTotal } from '@/lib/service-procurement/domain'
import { CREDIT_NOTE_AMOUNT_EXCEEDS_SOURCE_MESSAGE, CREDIT_NOTE_NUMBER_REQUIRED_MESSAGE, CREDIT_NOTE_SOURCE_REQUIRED_MESSAGE, DUPLICATE_SERVICE_INVOICE_MESSAGE, hasDuplicateServiceInvoice } from '@/lib/service-procurement/invoice'
import { formatBaht } from '@/lib/service-procurement/presenter'
import type { ServiceExpenseDocumentType } from '@/lib/service-procurement/schema'
import type { ServicePurchaseRequestRecord, ServiceUsageEventRecord } from '@/lib/service-procurement/types'
import { ServiceExpenseDocumentFields } from './ServiceExpenseDocumentFields'

const subscribeToClientReady = () => () => undefined

interface Props {
  request: ServicePurchaseRequestRecord
  onOpen?: () => void
  className?: string
}

export function ServicePurchaseRequestExpenseDialog({ request, onOpen, className = '' }: Props) {
  const router = useRouter()
  const { dialogRef, isRendered, open: openDialog, close: closeDialog } = useDeferredDialog()
  const portalReady = useSyncExternalStore(subscribeToClientReady, () => true, () => false)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [invoiceError, setInvoiceError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [expenseDate, setExpenseDate] = useState(request.usageStartDate)
  const [expenseAmount, setExpenseAmount] = useState('')
  const [invoice, setInvoice] = useState('')
  const [note, setNote] = useState('')
  const [documentType, setDocumentType] = useState<ServiceExpenseDocumentType>('invoice')
  const [sourceExpenseId, setSourceExpenseId] = useState<string | null>(null)
  const [sourceError, setSourceError] = useState<string | null>(null)
  const amountInputRef = useRef<HTMLInputElement>(null)
  const dialogId = `service-pr-expense-dialog-${request.id}`
  const titleId = `${dialogId}-title`
  const descriptionId = `${dialogId}-description`
  const hasAnyEvidence = Boolean(request.poNumber?.trim() || request.poFileName?.trim())
  const isDailyExpense = request.expenseFrequency === 'daily'
  const history = serviceExpenseEventsForDisplay(request.usageEvents)
  const latestExpenses = history.slice(0, 5)
  const olderExpenses = history.slice(5)
  const activeTotal = serviceExpenseNetTotal(history)
  const remainingExpenseAmount = Math.max(0, request.requestedAmount - activeTotal)
  const sourceOptions = serviceCreditNoteSourceOptions(request.usageEvents)
  const selectedSource = sourceOptions.find((option) => option.id === sourceExpenseId) ?? null
  const enteredExpenseAmount = Number(expenseAmount)
  const amountLimit = documentType === 'credit_note' ? selectedSource?.remainingAmount ?? 0 : remainingExpenseAmount
  const amountExceedsLimit = Number.isFinite(enteredExpenseAmount) && enteredExpenseAmount > amountLimit
  const amountExceedsRequestLimit = amountExceedsLimit
  const amountErrorId = `${dialogId}-amount-error`
  const autoCloseAfterExpense = request.requiresContract || !request.isRedCross

  function expenseDateForMonth(month: string): string {
    if (!month) return ''
    const firstDay = `${month}-01`
    return firstDay < request.usageStartDate ? request.usageStartDate : firstDay
  }

  function resetExpenseForm(clearSuccess = true) {
    setExpenseDate(request.usageStartDate)
    setExpenseAmount('')
    setInvoice('')
    setNote('')
    setDocumentType('invoice')
    setSourceExpenseId(null)
    setError(null)
    setInvoiceError(null)
    setSourceError(null)
    if (clearSuccess) setSuccess(null)
  }

  function openExpenseDialog() {
    resetExpenseForm()
    onOpen?.()
    openDialog()
  }

  function closeExpenseDialog() {
    resetExpenseForm()
    closeDialog()
  }

  function handleDocumentTypeChange(nextType: ServiceExpenseDocumentType) {
    setDocumentType(nextType)
    setInvoiceError(null)
    setSourceError(null)
    if (nextType === 'invoice') setSourceExpenseId(null)
  }

  function submitExpense(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setInvoiceError(null)
    setSourceError(null)
    const parsed = Number(expenseAmount)
    if (!expenseDate || !Number.isFinite(parsed) || parsed <= 0) {
      setError('กรุณาระบุวันที่และยอดค่าใช้จ่าย')
      return
    }
    if (documentType === 'credit_note' && !sourceExpenseId) {
      setSourceError(CREDIT_NOTE_SOURCE_REQUIRED_MESSAGE)
      return
    }
    if (documentType === 'credit_note' && !selectedSource) {
      setSourceError('ไม่พบ Invoice ต้นทางที่ยังมียอดให้ลด กรุณาเลือกใหม่')
      return
    }
    if (amountExceedsLimit) {
      setError(documentType === 'credit_note'
        ? CREDIT_NOTE_AMOUNT_EXCEEDS_SOURCE_MESSAGE
        : `ยอดใช้จริงรวมเกินวงเงิน PR คงเหลือ ${formatBaht(remainingExpenseAmount)}`)
      return
    }
    if (documentType === 'credit_note' && !invoice.trim()) {
      setInvoiceError(CREDIT_NOTE_NUMBER_REQUIRED_MESSAGE)
      return
    }
    if (hasDuplicateServiceInvoice(request.usageEvents, invoice)) {
      setError(null)
      setInvoiceError(DUPLICATE_SERVICE_INVOICE_MESSAGE)
      return
    }

    setError(null)
    setInvoiceError(null)
    setSuccess(null)
    startTransition(async () => {
      try {
        await recordServiceLabExpense({
          requestId: request.id,
          expenseDate,
          amount: parsed,
          invoiceNumber: invoice || null,
          note: note || null,
          documentType,
          sourceExpenseId: documentType === 'credit_note' ? sourceExpenseId : null,
        })
        resetExpenseForm(false)
        setSuccess('บันทึกค่าใช้จ่ายแล้ว')
        router.refresh()
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : 'บันทึกค่าใช้จ่ายไม่สำเร็จ'
        if (message === DUPLICATE_SERVICE_INVOICE_MESSAGE) {
          setInvoiceError(message)
          setError(null)
        } else {
          setError(message)
        }
      }
    })
  }

  function renderHistoryItem(event: ServiceUsageEventRecord) {
    const isCreditNote = event.documentType === 'credit_note'
    const sourceInvoice = event.sourceExpenseId
      ? history.find((source) => source.id === event.sourceExpenseId)
      : null
    return (
      <li key={event.id} className={`service-expense-dialog__history-item${isCreditNote ? ' service-expense-dialog__history-item--credit' : ''}${isCreditNote && event.sourceExpenseId ? ' service-expense-dialog__history-item--child' : ''}`}>
        <div className="service-expense-dialog__history-main">
          <div className="service-expense-dialog__history-topline">
            <strong className="identifier">{event.expenseDate}</strong>
            <span className={`service-expense-document-badge${isCreditNote ? ' service-expense-document-badge--credit' : ''}`}>
              {isCreditNote ? 'ใบลดหนี้' : 'Invoice'}
            </span>
          </div>
          <span className="service-expense-dialog__history-invoice">{event.invoiceNumber ?? 'ไม่มีเลข Invoice'}{event.note ? ` · ${event.note}` : ''}</span>
          {isCreditNote && <small className="service-expense-dialog__history-reference">อ้างอิง {sourceInvoice?.invoiceNumber ?? 'Invoice ต้นทาง'}</small>}
          <small>{event.actorName ?? 'ไม่ระบุผู้บันทึก'}</small>
        </div>
        <div className="service-expense-dialog__history-amount">
          <span>{isCreditNote ? 'ยอดลดหนี้' : 'ยอดใช้จริง'}</span>
          <strong className={`identifier${isCreditNote ? ' service-expense-dialog__history-value--credit' : ''}`}>{formatBaht(isCreditNote ? -event.amount : event.amount)}</strong>
        </div>
      </li>
    )
  }

  if (request.status !== 'confirmed' || !hasAnyEvidence) return null

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        className={`service-pr-card__expense-link service-pr-expense-trigger ${className}`.trim()}
        aria-haspopup="dialog"
        aria-controls={isRendered ? dialogId : undefined}
        onClick={openExpenseDialog}
      >
        บันทึกค่าใช้จ่าย
      </Button>

      {portalReady && isRendered && createPortal(
        <dialog
          ref={dialogRef}
          id={dialogId}
          className="app-dialog service-expense-dialog"
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          onCancel={(event) => {
            event.preventDefault()
            closeExpenseDialog()
          }}
        >
          <header className="app-dialog__header">
            <div>
              <h2 id={titleId}>บันทึกค่าใช้จ่ายจริง</h2>
              <p id={descriptionId}>{request.documentNumber} · {request.planName ?? 'ไม่พบแผน'}</p>
            </div>
            <button type="button" className="app-dialog__close" aria-label="ปิดหน้าต่างบันทึกค่าใช้จ่าย" onClick={closeExpenseDialog}>
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                <path d="m6 6 12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </header>

          <div className="app-dialog__body service-expense-dialog__body">
            <div className="service-expense-dialog__summary" aria-label="สรุปค่าใช้จ่าย">
              <div><span>ยอดสุทธิที่บันทึกไว้</span><strong className="identifier">{formatBaht(activeTotal)}</strong></div>
              <div><span>วงเงิน PR</span><strong className="identifier">{formatBaht(request.requestedAmount)}</strong></div>
            </div>
            <p className="field-help service-expense-dialog__workflow-note">{autoCloseAfterExpense ? 'เมื่อบันทึกค่าใช้จ่าย ระบบจะปิด PO และตัดยอดแผนอัตโนมัติ' : 'ระบบจะตัดยอดแผนเมื่อปิดใบ PO'}</p>

            <form className="service-expense-dialog__form" autoComplete="off" onSubmit={submitExpense}>
              <div className="form-grid">
                <label>
                  <span>{isDailyExpense ? 'วันที่ค่าใช้จ่าย' : 'เดือนค่าใช้จ่าย'} <span className="field-required" aria-hidden="true">*</span></span>
                  <input autoFocus autoComplete="off" type={isDailyExpense ? 'date' : 'month'} required min={isDailyExpense ? request.usageStartDate : request.usageStartDate.slice(0, 7)} max={isDailyExpense ? request.usageEndDate : request.usageEndDate.slice(0, 7)} value={isDailyExpense ? expenseDate : expenseDate.slice(0, 7)} onChange={(event) => setExpenseDate(isDailyExpense ? event.target.value : expenseDateForMonth(event.target.value))} />
                </label>
                <label>
                  <span>ยอดจริง <span className="field-required" aria-hidden="true">*</span></span>
                  <MoneyInput
                    ref={amountInputRef}
                    required
                    min="0.01"
                    step="0.01"
                    max={amountLimit}
                    autoComplete="off"
                    className="service-expense-amount-input"
                    value={expenseAmount}
                    aria-invalid={amountExceedsRequestLimit}
                    aria-describedby={amountExceedsRequestLimit ? amountErrorId : undefined}
                    onValueChange={(value) => {
                      setExpenseAmount(value)
                      setError(null)
                    }}
                  />
                  {amountExceedsRequestLimit && <small id={amountErrorId} className="field-error" role="alert">
                    {documentType === 'credit_note'
                      ? `${CREDIT_NOTE_AMOUNT_EXCEEDS_SOURCE_MESSAGE} ${formatBaht(amountLimit)}`
                      : `ยอดจริงรวมเกินวงเงิน PR คงเหลือ ${formatBaht(remainingExpenseAmount)}`}
                  </small>}
                </label>
                <ServiceExpenseDocumentFields
                  request={request}
                  idPrefix={dialogId}
                  documentType={documentType}
                  sourceExpenseId={sourceExpenseId}
                  sourceError={sourceError}
                  invoiceNumber={invoice}
                  invoiceError={invoiceError}
                  disabled={pending}
                  onDocumentTypeChange={handleDocumentTypeChange}
                  onSourceExpenseChange={(value) => {
                    setSourceExpenseId(value)
                    setSourceError(null)
                    setError(null)
                  }}
                  onInvoiceNumberChange={(value) => setInvoice(value)}
                  onInvoiceErrorClear={() => setInvoiceError(null)}
                  onInvoiceEnter={() => amountInputRef.current?.focus()}
                />
                <label>
                  <span>หมายเหตุ</span>
                  <input autoComplete="off" value={note} onChange={(event) => setNote(event.target.value)} />
                </label>
              </div>
              {error && <p className="form-error" role="alert">{error}</p>}
              {success && <p className="form-success" role="status" aria-live="polite">{success}</p>}
              <div className="service-expense-dialog__actions">
                <Button type="button" variant="ghost" onClick={closeExpenseDialog} disabled={pending}>ยกเลิก</Button>
                <Button type="submit" disabled={pending || !expenseAmount || amountExceedsRequestLimit}>{pending ? 'กำลังบันทึก…' : 'บันทึกค่าใช้จ่าย'}</Button>
              </div>
            </form>

            <section className="service-expense-dialog__history" aria-labelledby={`${dialogId}-history-title`}>
              <div className="service-expense-dialog__history-heading">
                <div>
                  <h3 id={`${dialogId}-history-title`}>ประวัติค่าใช้จ่าย</h3>
                </div>
                <span>ทั้งหมด {history.length} รายการ</span>
              </div>
              {history.length > 0 ? (
                <ol className="service-expense-dialog__history-list">
                  {latestExpenses.map(renderHistoryItem)}
                  {olderExpenses.map(renderHistoryItem)}
                </ol>
              ) : (
                <p className="service-expense-dialog__history-empty">ยังไม่มีประวัติค่าใช้จ่าย</p>
              )}
            </section>
          </div>
        </dialog>,
        document.body,
      )}
    </>
  )
}
