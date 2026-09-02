'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { MoneyInput } from '@/components/ui/MoneyInput'
import { useDeferredDialog } from '@/components/ui/useDeferredDialog'
import { formatThaiDateFull } from '@/lib/date/thai'
import { bangkokIsoDate } from '@/lib/date/thai'
import {
  DUPLICATE_PURCHASE_REQUEST_INVOICE_MESSAGE,
  canRecordPurchaseRequestExpense,
  hasDuplicatePurchaseRequestInvoice,
  purchaseCreditNoteSourceOptions,
  purchaseRequestExpenseEventsForDisplay,
  purchaseRequestExpenseNetTotal,
  PURCHASE_CREDIT_NOTE_AMOUNT_EXCEEDS_SOURCE_MESSAGE,
  PURCHASE_CREDIT_NOTE_NUMBER_REQUIRED_MESSAGE,
  PURCHASE_CREDIT_NOTE_SOURCE_REQUIRED_MESSAGE,
} from '@/lib/pr/expense'
import { formatBaht } from '@/lib/pr/presenter'
import type { PurchaseRequestExpenseDocumentType } from '@/lib/pr/expense'
import type {
  PurchaseRequestExpenseInputRecord,
  PurchaseRequestExpenseRecord,
  PurchaseRequestRecord,
} from '@/lib/pr/types'
import { PurchaseRequestExpenseDocumentFields } from './PurchaseRequestExpenseDocumentFields'

interface Props {
  request: PurchaseRequestRecord
  canRecord?: boolean
  className?: string
  recordAction?: (input: PurchaseRequestExpenseInputRecord) => Promise<unknown>
}

function expenseLabel(event: PurchaseRequestExpenseRecord): string {
  return event.documentType === 'credit_note' ? 'ใบลดหนี้' : 'Invoice'
}

export function PurchaseRequestExpenseDialog({ request, canRecord = true, className = '', recordAction }: Props) {
  const router = useRouter()
  const { dialogRef, isRendered, open: openDialog, unmount: unmountDialog } = useDeferredDialog()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [invoiceError, setInvoiceError] = useState<string | null>(null)
  const [sourceError, setSourceError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [expenseDate, setExpenseDate] = useState(bangkokIsoDate())
  const [expenseAmount, setExpenseAmount] = useState('')
  const [invoice, setInvoice] = useState('')
  const [note, setNote] = useState('')
  const [documentType, setDocumentType] = useState<PurchaseRequestExpenseDocumentType>('invoice')
  const [sourceExpenseId, setSourceExpenseId] = useState<string | null>(null)
  const amountInputRef = useRef<HTMLInputElement>(null)
  const dialogId = `purchase-pr-expense-dialog-${request.id}`
  const titleId = `${dialogId}-title`
  const descriptionId = `${dialogId}-description`
  const history = purchaseRequestExpenseEventsForDisplay(request.expenseEvents)
  const activeTotal = purchaseRequestExpenseNetTotal(history)
  const remainingExpenseAmount = Math.max(0, request.total - activeTotal)
  const sourceOptions = purchaseCreditNoteSourceOptions(history)
  const selectedSource = sourceOptions.find((option) => option.id === sourceExpenseId) ?? null
  const enteredExpenseAmount = Number(expenseAmount)
  const amountLimit = documentType === 'credit_note' ? selectedSource?.remainingAmount ?? 0 : remainingExpenseAmount
  const amountExceedsLimit = Number.isFinite(enteredExpenseAmount) && enteredExpenseAmount > amountLimit
  const amountErrorId = `${dialogId}-amount-error`
  const eligible = canRecordPurchaseRequestExpense({
    status: request.status,
    purchaseMethod: request.purchaseMethod,
    poNumber: request.poNumber,
    poFileName: request.poFile.fileName,
  })

  function resetForm() {
    setExpenseDate(bangkokIsoDate())
    setExpenseAmount('')
    setInvoice('')
    setNote('')
    setDocumentType('invoice')
    setSourceExpenseId(null)
    setError(null)
    setInvoiceError(null)
    setSourceError(null)
    setSuccess(null)
  }

  function openExpenseDialog() {
    resetForm()
    openDialog()
  }

  function submitExpense(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setInvoiceError(null)
    setSourceError(null)

    const parsed = Number(expenseAmount)
    if (!expenseDate || !Number.isFinite(parsed) || parsed <= 0 || Math.round(parsed * 100) !== parsed * 100) {
      setError('กรุณาระบุวันที่และยอดค่าใช้จ่ายให้ถูกต้อง โดยยอดต้องมีทศนิยมไม่เกิน 2 ตำแหน่ง')
      return
    }
    if (documentType === 'credit_note' && !sourceExpenseId) {
      setSourceError(PURCHASE_CREDIT_NOTE_SOURCE_REQUIRED_MESSAGE)
      return
    }
    if (documentType === 'credit_note' && !selectedSource) {
      setSourceError('ไม่พบ Invoice ต้นทางที่ยังมียอดให้ลด กรุณาเลือกใหม่')
      return
    }
    if (amountExceedsLimit) {
      setError(documentType === 'credit_note'
        ? `${PURCHASE_CREDIT_NOTE_AMOUNT_EXCEEDS_SOURCE_MESSAGE} ${formatBaht(amountLimit)}`
        : `ยอดค่าใช้จ่ายสุทธิเกินยอดรวม PR คงเหลือ ${formatBaht(remainingExpenseAmount)}`)
      return
    }
    if (documentType === 'credit_note' && !invoice.trim()) {
      setInvoiceError(PURCHASE_CREDIT_NOTE_NUMBER_REQUIRED_MESSAGE)
      return
    }
    if (hasDuplicatePurchaseRequestInvoice(request.expenseEvents, invoice)) {
      setInvoiceError(DUPLICATE_PURCHASE_REQUEST_INVOICE_MESSAGE)
      return
    }

    startTransition(async () => {
      try {
        await recordAction?.({
          requestId: request.id,
          expenseDate,
          amount: parsed,
          invoiceNumber: invoice || null,
          note: note || null,
          documentType,
          sourceExpenseId: documentType === 'credit_note' ? sourceExpenseId : null,
        })
        setExpenseAmount('')
        setInvoice('')
        setNote('')
        setDocumentType('invoice')
        setSourceExpenseId(null)
        setSuccess('บันทึกค่าใช้จ่ายแล้ว')
        router.refresh()
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : 'บันทึกค่าใช้จ่ายไม่สำเร็จ'
        if (message === DUPLICATE_PURCHASE_REQUEST_INVOICE_MESSAGE) setInvoiceError(message)
        else setError(message)
      }
    })
  }

  function renderHistoryItem(event: PurchaseRequestExpenseRecord) {
    const isCreditNote = event.documentType === 'credit_note'
    const sourceInvoice = event.sourceExpenseId
      ? history.find((source) => source.id === event.sourceExpenseId)
      : null
    return (
      <li key={event.id} className={`purchase-expense-dialog__history-item${isCreditNote ? ' purchase-expense-dialog__history-item--credit' : ''}${isCreditNote && event.sourceExpenseId ? ' purchase-expense-dialog__history-item--child' : ''}`}>
        <div className="purchase-expense-dialog__history-main">
          <div className="purchase-expense-dialog__history-topline">
            <strong className="identifier">{formatThaiDateFull(event.expenseDate)}</strong>
            <span className={`purchase-expense-document-badge${isCreditNote ? ' purchase-expense-document-badge--credit' : ''}`}>
              {expenseLabel(event)}
            </span>
          </div>
          <span className="purchase-expense-dialog__history-invoice">{event.invoiceNumber ?? 'ไม่มีเลข Invoice'}{event.note ? ` · ${event.note}` : ''}</span>
          {isCreditNote && <small className="purchase-expense-source-reference">อ้างอิง {sourceInvoice?.invoiceNumber ?? 'Invoice ต้นทาง'}</small>}
          <small>{event.actorName ?? 'ไม่ระบุผู้บันทึก'} · {event.status === 'active' ? 'ใช้งานอยู่' : 'ยกเลิกแล้ว'}</small>
        </div>
        <div className="purchase-expense-dialog__history-amount">
          <span>{isCreditNote ? 'ยอดลดหนี้' : 'ยอดค่าใช้จ่าย'}</span>
          <strong className={`identifier${isCreditNote ? ' purchase-expense-value--credit' : ''}`}>{formatBaht(isCreditNote ? -event.amount : event.amount)}</strong>
        </div>
      </li>
    )
  }

  if (!eligible || !canRecord || !recordAction) return null

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        className={`purchase-expense-trigger ${className}`.trim()}
        aria-haspopup="dialog"
        aria-controls={isRendered ? dialogId : undefined}
        onClick={openExpenseDialog}
      >
        บันทึกค่าใช้จ่าย
      </Button>

      {isRendered && (
        <dialog
          ref={dialogRef}
          id={dialogId}
          className="app-dialog purchase-expense-dialog"
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
              <h2 id={titleId}>บันทึกค่าใช้จ่าย PR จัดซื้อ</h2>
              <p id={descriptionId}>{request.documentNumber} · {request.poNumber ? `PO ${request.poNumber}` : 'มีไฟล์ PO'}</p>
            </div>
            <button type="button" className="app-dialog__close" aria-label="ปิดหน้าต่างบันทึกค่าใช้จ่าย" onClick={unmountDialog}>
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                <path d="m6 6 12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </header>

          <div className="app-dialog__body purchase-expense-dialog__body">
            <div className="purchase-expense-dialog__summary" aria-label="สรุปยอดค่าใช้จ่าย">
              <div><span>ยอด PR</span><strong className="identifier">{formatBaht(request.total)}</strong></div>
              <div><span>ยอดสุทธิ active</span><strong className="identifier">{formatBaht(activeTotal)}</strong></div>
              <div><span>คงเหลือ</span><strong className="identifier">{formatBaht(remainingExpenseAmount)}</strong></div>
            </div>
            <p className="field-help purchase-expense-dialog__workflow-note">บันทึกได้หลาย Invoice ต่อวัน · ไม่แก้ยอดสินค้า ไม่ตัด stock และไม่เปลี่ยนสถานะรับเข้า</p>

            <form className="purchase-expense-dialog__form" autoComplete="off" onSubmit={submitExpense}>
              <div className="form-grid">
                <label>
                  <span>วันที่เอกสาร <span className="field-required" aria-hidden="true">*</span></span>
                  <input autoFocus type="date" required value={expenseDate} onChange={(event) => { setExpenseDate(event.target.value); setError(null) }} />
                </label>
                <label>
                  <span>ยอดเอกสาร <span className="field-required" aria-hidden="true">*</span></span>
                  <MoneyInput
                    ref={amountInputRef}
                    required
                    min="0.01"
                    step="0.01"
                    max={amountLimit || undefined}
                    value={expenseAmount}
                    aria-invalid={amountExceedsLimit}
                    aria-describedby={amountExceedsLimit ? amountErrorId : undefined}
                    onValueChange={(value) => { setExpenseAmount(value); setError(null) }}
                  />
                  {amountExceedsLimit && <small id={amountErrorId} className="field-error" role="alert">
                    {documentType === 'credit_note' ? `${PURCHASE_CREDIT_NOTE_AMOUNT_EXCEEDS_SOURCE_MESSAGE} ${formatBaht(amountLimit)}` : `ยอดคงเหลือของ PR ${formatBaht(remainingExpenseAmount)}`}
                  </small>}
                </label>
                <PurchaseRequestExpenseDocumentFields
                  request={request}
                  idPrefix={dialogId}
                  documentType={documentType}
                  sourceExpenseId={sourceExpenseId}
                  sourceError={sourceError}
                  invoiceNumber={invoice}
                  invoiceError={invoiceError}
                  disabled={pending}
                  onDocumentTypeChange={(value) => { setDocumentType(value); setInvoiceError(null); setSourceError(null) }}
                  onSourceExpenseChange={(value) => { setSourceExpenseId(value); setSourceError(null); setError(null) }}
                  onInvoiceNumberChange={setInvoice}
                  onInvoiceErrorClear={() => setInvoiceError(null)}
                  onInvoiceEnter={() => amountInputRef.current?.focus()}
                />
                <label>
                  <span>หมายเหตุ</span>
                  <input value={note} disabled={pending} onChange={(event) => setNote(event.target.value)} />
                </label>
              </div>
              {error && <p className="form-error" role="alert">{error}</p>}
              {success && <p className="form-success" role="status" aria-live="polite">{success}</p>}
              <div className="purchase-expense-dialog__actions">
                <Button type="button" variant="ghost" onClick={unmountDialog} disabled={pending}>ยกเลิก</Button>
                <Button type="submit" disabled={pending || !expenseAmount || amountExceedsLimit}>{pending ? 'กำลังบันทึก…' : 'บันทึกค่าใช้จ่าย'}</Button>
              </div>
            </form>

            <section className="purchase-expense-dialog__history" aria-labelledby={`${dialogId}-history-title`}>
              <div className="purchase-expense-dialog__history-heading">
                <h3 id={`${dialogId}-history-title`}>ประวัติค่าใช้จ่าย</h3>
                <span>ทั้งหมด {history.length} รายการ</span>
              </div>
              {history.length > 0 ? <ol className="purchase-expense-dialog__history-list">{history.map(renderHistoryItem)}</ol> : <p className="purchase-expense-dialog__history-empty">ยังไม่มีประวัติค่าใช้จ่าย</p>}
            </section>
          </div>
        </dialog>
      )}
    </>
  )
}
