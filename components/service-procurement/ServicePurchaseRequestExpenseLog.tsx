'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircleIcon, EditIcon } from '@/components/inventory/InventoryDetailIcons'
import { Button } from '@/components/ui/Button'
import { MoneyInput } from '@/components/ui/MoneyInput'
import { formatThaiDateFull } from '@/lib/date/thai'
import { cancelServiceLabExpense, updateServiceLabExpense } from '@/lib/service-procurement/actions'
import { DUPLICATE_SERVICE_INVOICE_MESSAGE, hasDuplicateServiceInvoice } from '@/lib/service-procurement/invoice'
import { formatBaht } from '@/lib/service-procurement/presenter'
import type { ServicePurchaseRequestRecord } from '@/lib/service-procurement/types'

function CancelIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="m7 7 10 10M17 7 7 17" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  )
}

interface Props {
  request: ServicePurchaseRequestRecord
  canRecord: boolean
}

export function ServicePurchaseRequestExpenseLog({ request, canRecord }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [invoiceError, setInvoiceError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDate, setEditDate] = useState(request.usageStartDate)
  const [editAmount, setEditAmount] = useState('')
  const [editInvoice, setEditInvoice] = useState('')
  const [editNote, setEditNote] = useState('')
  const hasAnyEvidence = Boolean(request.poNumber?.trim() || request.poFileName?.trim())
  const activeExpenses = request.usageEvents.filter((event) => event.kind === 'lab_expense' && event.status === 'active')
  const isDailyExpense = request.expenseFrequency === 'daily'

  function expenseDateForMonth(month: string): string {
    if (!month) return ''
    const firstDay = `${month}-01`
    return firstDay < request.usageStartDate ? request.usageStartDate : firstDay
  }

  function run(operation: () => Promise<unknown>, onSuccess?: () => void) {
    setError(null)
    setInvoiceError(null)
    startTransition(async () => {
      try {
        await operation()
        onSuccess?.()
        router.refresh()
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : 'ดำเนินการไม่สำเร็จ'
        if (message === DUPLICATE_SERVICE_INVOICE_MESSAGE) {
          setInvoiceError(message)
        } else {
          setError(message)
        }
      }
    })
  }

  function startEdit(event: typeof activeExpenses[number]) {
    setEditingId(event.id)
    setEditDate(event.expenseDate)
    setEditAmount(String(event.amount))
    setEditInvoice(event.invoiceNumber ?? '')
    setEditNote(event.note ?? '')
    setError(null)
    setInvoiceError(null)
  }

  function saveEdit(expenseId: string) {
    setInvoiceError(null)
    const parsed = Number(editAmount)
    if (!Number.isFinite(parsed) || parsed <= 0 || !editDate) {
      setError('กรุณาระบุวันที่และยอดค่าใช้จ่าย')
      return
    }
    if (hasDuplicateServiceInvoice(request.usageEvents, editInvoice, expenseId)) {
      setError(null)
      setInvoiceError(DUPLICATE_SERVICE_INVOICE_MESSAGE)
      return
    }

    const reason = window.prompt('เหตุผลที่แก้ไขรายการค่าใช้จ่าย')
    if (!reason?.trim()) return
    run(
      () => updateServiceLabExpense({ requestId: request.id, expenseId, expenseDate: editDate, amount: parsed, invoiceNumber: editInvoice || null, note: editNote || null, reason }),
      () => setEditingId(null),
    )
  }

  function removeExpense(expenseId: string) {
    const reason = window.prompt('เหตุผลที่ยกเลิกรายการค่าใช้จ่าย')
    if (reason?.trim()) run(() => cancelServiceLabExpense({ requestId: request.id, expenseId, reason }))
  }

  if (request.status !== 'confirmed' || !hasAnyEvidence) return null

  return (
    <section className="bench-panel service-pr-detail__section service-pr-detail__expense-log" aria-labelledby="service-expense-list-title">
      <div className="bench-panel__header service-pr-detail__section-header">
        <div><p className="section-kicker">EXPENSE LOG</p><h2 id="service-expense-list-title">รายการค่าใช้จ่ายก่อนปิด PO</h2></div>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {activeExpenses.length === 0 ? (
        <p className="empty-state">ยังไม่มีรายการค่าใช้จ่าย</p>
      ) : (
        <div className="service-ledger-table-wrap">
          <table className="data-table">
            <thead>
              <tr><th>{isDailyExpense ? 'วันที่' : 'เดือน'}</th><th>Invoice</th><th>ยอด</th><th>หมายเหตุ</th><th>การทำงาน</th></tr>
            </thead>
            <tbody>
              {activeExpenses.map((event) => editingId === event.id ? (
                <tr key={event.id}>
                  <td><input type={isDailyExpense ? 'date' : 'month'} min={isDailyExpense ? request.usageStartDate : request.usageStartDate.slice(0, 7)} max={isDailyExpense ? request.usageEndDate : request.usageEndDate.slice(0, 7)} value={isDailyExpense ? editDate : editDate.slice(0, 7)} onChange={(e) => setEditDate(isDailyExpense ? e.target.value : expenseDateForMonth(e.target.value))} /></td>
                  <td>
                    <input
                      value={editInvoice}
                      aria-invalid={Boolean(invoiceError)}
                      aria-describedby={invoiceError ? `service-expense-${event.id}-invoice-error` : undefined}
                      onChange={(e) => {
                        setEditInvoice(e.target.value)
                        setInvoiceError(null)
                      }}
                    />
                    {invoiceError && <small id={`service-expense-${event.id}-invoice-error`} className="field-error" role="alert">{invoiceError}</small>}
                  </td>
                  <td><MoneyInput min="0.01" step="0.01" value={editAmount} onValueChange={setEditAmount} /></td>
                  <td><input value={editNote} onChange={(e) => setEditNote(e.target.value)} /></td>
                  <td className="service-expense-actions">
                    <div className="service-expense-actions__group" aria-label="การทำงานกับรายการค่าใช้จ่าย">
                      <Button type="button" className="service-expense-actions__save" onClick={() => saveEdit(event.id)} disabled={pending} aria-label="บันทึกการแก้ไขรายการค่าใช้จ่าย" title="บันทึกการแก้ไขรายการค่าใช้จ่าย"><CheckCircleIcon /><span className="visually-hidden">บันทึก</span></Button>
                      <Button type="button" className="service-expense-actions__cancel" variant="ghost" onClick={() => setEditingId(null)} aria-label="ยกเลิกการแก้ไขรายการค่าใช้จ่าย" title="ยกเลิกการแก้ไขรายการค่าใช้จ่าย"><CancelIcon /><span className="visually-hidden">ยกเลิก</span></Button>
                    </div>
                  </td>
                </tr>
              ) : (
                <tr key={event.id}>
                  <td>{formatThaiDateFull(event.expenseDate)}</td>
                  <td>{event.invoiceNumber ?? '—'}</td>
                  <td className="identifier">{formatBaht(event.amount)}</td>
                  <td>{event.note ?? '—'}</td>
                  <td className="service-expense-actions">
                    {canRecord && <div className="service-expense-actions__group" aria-label="การทำงานกับรายการค่าใช้จ่าย">
                      <Button type="button" className="service-expense-actions__edit" variant="secondary" onClick={() => startEdit(event)} aria-label="แก้ไขรายการค่าใช้จ่าย" title="แก้ไขรายการค่าใช้จ่าย"><EditIcon /><span className="visually-hidden">แก้ไข</span></Button>
                      <Button type="button" className="service-expense-actions__cancel" variant="danger" onClick={() => removeExpense(event.id)} aria-label="ยกเลิกรายการค่าใช้จ่าย" title="ยกเลิกรายการค่าใช้จ่าย"><CancelIcon /><span className="visually-hidden">ยกเลิก</span></Button>
                    </div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
