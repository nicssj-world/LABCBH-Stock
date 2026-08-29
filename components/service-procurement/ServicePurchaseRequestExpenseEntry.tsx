'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { MoneyInput } from '@/components/ui/MoneyInput'
import { recordServiceLabExpense } from '@/lib/service-procurement/actions'
import { DUPLICATE_SERVICE_INVOICE_MESSAGE, hasDuplicateServiceInvoice } from '@/lib/service-procurement/invoice'
import { formatBaht } from '@/lib/service-procurement/presenter'
import type { ServicePurchaseRequestRecord } from '@/lib/service-procurement/types'

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
  const amountRef = useRef<HTMLInputElement>(null)
  const hasAnyEvidence = Boolean(request.poNumber?.trim() || request.poFileName?.trim())
  const activeTotal = request.usageEvents
    .filter((event) => event.kind === 'lab_expense' && event.status === 'active')
    .reduce((sum, event) => sum + event.amount, 0)
  const remainingExpenseAmount = Math.max(0, request.requestedAmount - activeTotal)
  const enteredExpenseAmount = Number(expenseAmount)
  const amountExceedsRequestLimit = Number.isFinite(enteredExpenseAmount) && enteredExpenseAmount > remainingExpenseAmount
  const amountErrorId = 'service-pr-usage-amount-error'
  const isDailyExpense = request.expenseFrequency === 'daily'

  function expenseDateForMonth(month: string): string {
    if (!month) return ''
    const firstDay = `${month}-01`
    return firstDay < request.usageStartDate ? request.usageStartDate : firstDay
  }

  function submitExpense() {
    setInvoiceError(null)
    const parsed = Number(expenseAmount)
    if (!expenseDate || !Number.isFinite(parsed) || parsed <= 0) {
      setError('กรุณาระบุวันที่และยอดค่าใช้จ่าย')
      return
    }
    if (amountExceedsRequestLimit) return
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
        })
        setExpenseAmount('')
        setInvoice('')
        setNote('')
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
        <p>ใช้แล้ว {formatBaht(activeTotal)} / {formatBaht(request.requestedAmount)} · {isDailyExpense ? 'บันทึกได้หลายรายการต่อวัน' : 'เดือนละ 1 รายการต่อ PO'}</p>
      </div>
      <div className="form-grid">
        <label>
          <span>{isDailyExpense ? 'วันที่ค่าใช้จ่าย' : 'เดือนค่าใช้จ่าย'} <span className="field-required" aria-hidden="true">*</span></span>
          <input type={isDailyExpense ? 'date' : 'month'} required min={isDailyExpense ? request.usageStartDate : request.usageStartDate.slice(0, 7)} max={isDailyExpense ? request.usageEndDate : request.usageEndDate.slice(0, 7)} value={isDailyExpense ? expenseDate : expenseDate.slice(0, 7)} onChange={(event) => setExpenseDate(isDailyExpense ? event.target.value : expenseDateForMonth(event.target.value))} />
        </label>
        <label>
          <span>ยอดจริง <span className="field-required" aria-hidden="true">*</span></span>
          <MoneyInput
            ref={amountRef}
            required
            min="0.01"
            step="0.01"
            max={remainingExpenseAmount}
            className="service-expense-amount-input"
            value={expenseAmount}
            aria-invalid={amountExceedsRequestLimit}
            aria-describedby={amountExceedsRequestLimit ? amountErrorId : undefined}
            onValueChange={(value) => {
              setExpenseAmount(value)
              setError(null)
            }}
          />
          {amountExceedsRequestLimit && <small id={amountErrorId} className="field-error" role="alert">ยอดจริงรวมเกินวงเงิน PR คงเหลือ {formatBaht(remainingExpenseAmount)}</small>}
        </label>
        <label>
          <span>Invoice <small>(รองรับสแกนบาร์โค้ด)</small></span>
          <input
            value={invoice}
            aria-invalid={Boolean(invoiceError)}
            aria-describedby={invoiceError ? 'service-pr-usage-invoice-error' : undefined}
            onChange={(event) => {
              setInvoice(event.target.value)
              setInvoiceError(null)
            }}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); amountRef.current?.focus() } }}
          />
          {invoiceError && <small id="service-pr-usage-invoice-error" className="field-error" role="alert">{invoiceError}</small>}
        </label>
        <label>
          <span>หมายเหตุ</span>
          <input value={note} onChange={(event) => setNote(event.target.value)} />
        </label>
      </div>
      <Button type="button" disabled={pending || !expenseAmount || amountExceedsRequestLimit} onClick={submitExpense}>บันทึกค่าใช้จ่าย</Button>
      {error && <p className="form-error" role="alert">{error}</p>}
      <p className="field-help">ระบบยังไม่ตัดยอดแผนจนกว่าจะกด “ปิดใบ PO”</p>
    </section>
  )
}
