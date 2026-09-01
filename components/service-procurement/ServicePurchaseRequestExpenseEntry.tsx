'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { MoneyInput } from '@/components/ui/MoneyInput'
import { recordServiceLabExpense } from '@/lib/service-procurement/actions'
import { serviceCreditNoteSourceOptions, serviceExpenseNetTotal } from '@/lib/service-procurement/domain'
import { CREDIT_NOTE_AMOUNT_EXCEEDS_SOURCE_MESSAGE, CREDIT_NOTE_NUMBER_REQUIRED_MESSAGE, CREDIT_NOTE_SOURCE_REQUIRED_MESSAGE, DUPLICATE_SERVICE_INVOICE_MESSAGE, hasDuplicateServiceInvoice } from '@/lib/service-procurement/invoice'
import { formatBaht } from '@/lib/service-procurement/presenter'
import type { ServiceExpenseDocumentType } from '@/lib/service-procurement/schema'
import type { ServicePurchaseRequestRecord } from '@/lib/service-procurement/types'
import { ServiceExpenseDocumentFields } from './ServiceExpenseDocumentFields'

interface Props {
  request: ServicePurchaseRequestRecord
  canRecord: boolean
}

export function ServicePurchaseRequestExpenseEntry({ request, canRecord }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [invoiceError, setInvoiceError] = useState<string | null>(null)
  const [expenseDate, setExpenseDate] = useState(request.usageStartDate)
  const [expenseAmount, setExpenseAmount] = useState('')
  const [invoice, setInvoice] = useState('')
  const [note, setNote] = useState('')
  const [documentType, setDocumentType] = useState<ServiceExpenseDocumentType>('invoice')
  const [sourceExpenseId, setSourceExpenseId] = useState<string | null>(null)
  const [sourceError, setSourceError] = useState<string | null>(null)
  const amountRef = useRef<HTMLInputElement>(null)
  const hasAnyEvidence = Boolean(request.poNumber?.trim() || request.poFileName?.trim())
  const activeTotal = serviceExpenseNetTotal(request.usageEvents)
  const remainingExpenseAmount = Math.max(0, request.requestedAmount - activeTotal)
  const sourceOptions = serviceCreditNoteSourceOptions(request.usageEvents)
  const selectedSource = sourceOptions.find((option) => option.id === sourceExpenseId) ?? null
  const enteredExpenseAmount = Number(expenseAmount)
  const amountLimit = documentType === 'credit_note' ? selectedSource?.remainingAmount ?? 0 : remainingExpenseAmount
  const amountExceedsRequestLimit = Number.isFinite(enteredExpenseAmount) && enteredExpenseAmount > amountLimit
  const amountErrorId = 'service-pr-usage-amount-error'
  const isDailyExpense = request.expenseFrequency === 'daily'
  const autoCloseAfterExpense = request.requiresContract || !request.isRedCross

  function expenseDateForMonth(month: string): string {
    if (!month) return ''
    const firstDay = `${month}-01`
    return firstDay < request.usageStartDate ? request.usageStartDate : firstDay
  }

  function resetExpenseForm() {
    setExpenseDate(request.usageStartDate)
    setExpenseAmount('')
    setInvoice('')
    setNote('')
    setDocumentType('invoice')
    setSourceExpenseId(null)
    setError(null)
    setInvoiceError(null)
    setSourceError(null)
  }

  function handleDocumentTypeChange(nextType: ServiceExpenseDocumentType) {
    setDocumentType(nextType)
    setInvoiceError(null)
    setSourceError(null)
    if (nextType === 'invoice') setSourceExpenseId(null)
  }

  function submitExpense() {
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
    if (amountExceedsRequestLimit) {
      setError(documentType === 'credit_note'
        ? `${CREDIT_NOTE_AMOUNT_EXCEEDS_SOURCE_MESSAGE} ${formatBaht(amountLimit)}`
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
        resetExpenseForm()
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

  if (request.status !== 'confirmed' || !hasAnyEvidence || !canRecord) return null

  return (
    <section id="service-pr-usage" className="bench-panel service-pr-detail__section service-pr-detail__expense-entry" aria-labelledby="service-pr-usage-title">
      <div className="bench-panel__header service-pr-detail__section-header">
        <div><p className="section-kicker">ACTUAL EXPENSE</p><h2 id="service-pr-usage-title">บันทึกค่าใช้จ่ายจริง</h2></div>
        <p>ยอดสุทธิ {formatBaht(activeTotal)} / {formatBaht(request.requestedAmount)} · {isDailyExpense ? 'บันทึกได้หลายรายการต่อวัน' : 'เดือนละ 1 รายการต่อ PO'}</p>
      </div>
      <div className="form-grid">
        <label>
          <span>{isDailyExpense ? 'วันที่ค่าใช้จ่าย' : 'เดือนค่าใช้จ่าย'} <span className="field-required" aria-hidden="true">*</span></span>
          <input autoComplete="off" type={isDailyExpense ? 'date' : 'month'} required min={isDailyExpense ? request.usageStartDate : request.usageStartDate.slice(0, 7)} max={isDailyExpense ? request.usageEndDate : request.usageEndDate.slice(0, 7)} value={isDailyExpense ? expenseDate : expenseDate.slice(0, 7)} onChange={(event) => setExpenseDate(isDailyExpense ? event.target.value : expenseDateForMonth(event.target.value))} />
        </label>
        <label>
          <span>ยอดจริง <span className="field-required" aria-hidden="true">*</span></span>
          <MoneyInput
            ref={amountRef}
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
          idPrefix="service-pr-usage"
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
          onInvoiceEnter={() => amountRef.current?.focus()}
        />
        <label>
          <span>หมายเหตุ</span>
          <input autoComplete="off" value={note} onChange={(event) => setNote(event.target.value)} />
        </label>
      </div>
      <Button type="button" disabled={pending || !expenseAmount || amountExceedsRequestLimit} onClick={submitExpense}>บันทึกค่าใช้จ่าย</Button>
      {error && <p className="form-error" role="alert">{error}</p>}
      <p className="field-help">{autoCloseAfterExpense ? 'เมื่อบันทึกค่าใช้จ่าย ระบบจะปิด PO และตัดยอดแผนอัตโนมัติ' : 'ระบบจะตัดยอดแผนเมื่อปิดใบ PO'}</p>
    </section>
  )
}
