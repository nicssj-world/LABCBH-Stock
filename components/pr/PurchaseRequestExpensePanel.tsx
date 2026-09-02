'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircleIcon, EditIcon } from '@/components/inventory/InventoryDetailIcons'
import { Button } from '@/components/ui/Button'
import { MoneyInput } from '@/components/ui/MoneyInput'
import { formatThaiDateFull } from '@/lib/date/thai'
import {
  DUPLICATE_PURCHASE_REQUEST_INVOICE_MESSAGE,
  hasDuplicatePurchaseRequestInvoice,
  purchaseRequestExpenseEventsForDisplay,
  purchaseRequestExpenseNetTotal,
} from '@/lib/pr/expense'
import { formatBaht } from '@/lib/pr/presenter'
import type {
  PurchaseRequestExpenseInputRecord,
  PurchaseRequestExpenseCancelInputRecord,
  PurchaseRequestExpenseRecord,
  PurchaseRequestExpenseUpdateInputRecord,
  PurchaseRequestRecord,
} from '@/lib/pr/types'
import { PurchaseRequestExpenseDialog } from './PurchaseRequestExpenseDialog'

interface Props {
  request: PurchaseRequestRecord
  canRecord: boolean
  recordAction?: (input: PurchaseRequestExpenseInputRecord) => Promise<unknown>
  updateAction?: (input: PurchaseRequestExpenseUpdateInputRecord) => Promise<unknown>
  cancelAction?: (input: PurchaseRequestExpenseCancelInputRecord) => Promise<unknown>
}

function CancelIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="m7 7 10 10M17 7 7 17" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  )
}

function documentLabel(event: PurchaseRequestExpenseRecord): string {
  return event.documentType === 'credit_note' ? 'ใบลดหนี้' : 'Invoice'
}

export function PurchaseRequestExpensePanel({ request, canRecord, recordAction, updateAction, cancelAction }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDate, setEditDate] = useState('')
  const [editAmount, setEditAmount] = useState('')
  const [editInvoice, setEditInvoice] = useState('')
  const [editNote, setEditNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [invoiceError, setInvoiceError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const history = purchaseRequestExpenseEventsForDisplay(request.expenseEvents)
  const activeEvents = history.filter((event) => event.status === 'active')
  const activeTotal = purchaseRequestExpenseNetTotal(history)
  const remainingTotal = Math.max(0, request.total - activeTotal)

  function startEdit(event: PurchaseRequestExpenseRecord) {
    setEditingId(event.id)
    setEditDate(event.expenseDate)
    setEditAmount(String(event.amount))
    setEditInvoice(event.invoiceNumber ?? '')
    setEditNote(event.note ?? '')
    setError(null)
    setInvoiceError(null)
    setSuccess(null)
  }

  function run(operation: () => Promise<unknown>, onSuccess?: () => void) {
    setError(null)
    setInvoiceError(null)
    setSuccess(null)
    startTransition(async () => {
      try {
        await operation()
        onSuccess?.()
        setSuccess('บันทึกการเปลี่ยนแปลงแล้ว')
        router.refresh()
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : 'ดำเนินการไม่สำเร็จ'
        if (message === DUPLICATE_PURCHASE_REQUEST_INVOICE_MESSAGE) setInvoiceError(message)
        else setError(message)
      }
    })
  }

  function saveEdit(event: PurchaseRequestExpenseRecord) {
    const amount = Number(editAmount)
    if (!editDate || !Number.isFinite(amount) || amount <= 0 || Math.round(amount * 100) !== amount * 100) {
      setError('กรุณาระบุวันที่และยอดค่าใช้จ่ายให้ถูกต้อง โดยยอดต้องมีทศนิยมไม่เกิน 2 ตำแหน่ง')
      return
    }
    if (hasDuplicatePurchaseRequestInvoice(request.expenseEvents, editInvoice, event.id)) {
      setInvoiceError(DUPLICATE_PURCHASE_REQUEST_INVOICE_MESSAGE)
      return
    }
    const reason = window.prompt('เหตุผลที่แก้ไขรายการค่าใช้จ่าย')
    if (!reason?.trim()) return
    run(
      () => updateAction!({
        requestId: request.id,
        expenseId: event.id,
        expenseDate: editDate,
        amount,
        invoiceNumber: editInvoice || null,
        note: editNote || null,
        documentType: event.documentType,
        sourceExpenseId: event.sourceExpenseId,
        reason,
      }),
      () => setEditingId(null),
    )
  }

  function cancelExpense(event: PurchaseRequestExpenseRecord) {
    const reason = window.prompt('เหตุผลที่ยกเลิกรายการค่าใช้จ่าย')
    if (!reason?.trim()) return
    run(() => cancelAction!({ requestId: request.id, expenseId: event.id, reason }))
  }

  function hasActiveCreditNotes(expenseId: string): boolean {
    return activeEvents.some((event) => event.documentType === 'credit_note' && event.sourceExpenseId === expenseId)
  }

  if (request.purchaseMethod !== 'red_cross') return null

  return (
    <section className="bench-panel purchase-expense-panel" aria-labelledby="purchase-expense-panel-title">
      <div className="bench-panel__header purchase-expense-panel__header">
        <div>
          <p className="section-kicker">ACTUAL EXPENSE</p>
          <h2 id="purchase-expense-panel-title">บันทึกค่าใช้จ่าย PR จัดซื้อ</h2>
        </div>
        <div className="purchase-expense-panel__header-actions">
          <p>Invoice หลายรายการต่อวัน · ไม่กระทบยอดสินค้า/การรับเข้า</p>
          <PurchaseRequestExpenseDialog request={request} canRecord={canRecord} recordAction={recordAction} />
        </div>
      </div>

      <div className="purchase-expense-summary" aria-label="สรุปยอดค่าใช้จ่าย PR">
        <div><span>ยอดรวม PR</span><strong className="identifier">{formatBaht(request.total)}</strong></div>
        <div><span>ยอดสุทธิ active</span><strong className="identifier">{formatBaht(activeTotal)}</strong></div>
        <div><span>ยอดคงเหลือ</span><strong className="identifier">{formatBaht(remainingTotal)}</strong></div>
      </div>

      {!canRecord && (
        <p className="purchase-expense-panel__notice" role="status">
          การบันทึกจะเปิดเมื่อ PR ยืนยันแล้วและมีเลข PO หรือไฟล์ PO โดยผู้ขอ, เจ้าหน้าที่คลัง และผู้ดูแลระบบจึงจัดการได้
        </p>
      )}
      {error && <p className="form-error purchase-expense-panel__error" role="alert">{error}</p>}
      {success && <p className="form-success purchase-expense-panel__success" role="status" aria-live="polite">{success}</p>}

      {history.length === 0 ? (
        <p className="empty-state purchase-expense-panel__empty">ยังไม่มีรายการค่าใช้จ่าย</p>
      ) : (
        <div className="purchase-expense-panel__table-wrap">
          <table className="data-table purchase-expense-panel__table">
            <caption className="sr-only">ประวัติค่าใช้จ่ายของใบ PR</caption>
            <thead>
              <tr><th>วันที่</th><th>เอกสาร</th><th className="numeric-cell">ยอดสุทธิ</th><th>หมายเหตุ</th><th>ผู้บันทึก</th><th>การทำงาน</th></tr>
            </thead>
            <tbody>
              {history.map((event) => {
                const isCreditNote = event.documentType === 'credit_note'
                const sourceInvoice = event.sourceExpenseId ? history.find((source) => source.id === event.sourceExpenseId) : null
                const isEditing = editingId === event.id
                return (
                  <tr key={event.id} className={`${isCreditNote ? 'purchase-expense-row--credit' : ''}${isCreditNote && event.sourceExpenseId ? ' purchase-expense-row--child' : ''}${event.status === 'cancelled' ? ' purchase-expense-row--cancelled' : ''}`}>
                    <td>
                      {isEditing ? (
                        <input type="date" value={editDate} disabled={pending} onChange={(input) => setEditDate(input.target.value)} />
                      ) : <span className="identifier">{formatThaiDateFull(event.expenseDate)}</span>}
                    </td>
                    <td>
                      <span className={`purchase-expense-document-badge${isCreditNote ? ' purchase-expense-document-badge--credit' : ''}`}>{documentLabel(event)}</span>
                      {isEditing ? (
                        <>
                          {isCreditNote && <small className="purchase-expense-source-reference">อ้างอิง {sourceInvoice?.invoiceNumber ?? 'Invoice ต้นทาง'}</small>}
                          <input
                            value={editInvoice}
                            disabled={pending}
                            aria-invalid={Boolean(invoiceError)}
                            aria-describedby={invoiceError ? `purchase-expense-${event.id}-invoice-error` : undefined}
                            onChange={(input) => { setEditInvoice(input.target.value); setInvoiceError(null) }}
                          />
                          {invoiceError && <small id={`purchase-expense-${event.id}-invoice-error`} className="field-error" role="alert">{invoiceError}</small>}
                        </>
                      ) : (
                        <>
                          <span className="purchase-expense-document-number-display">{event.invoiceNumber ?? '—'}</span>
                          {isCreditNote && <small className="purchase-expense-source-reference">อ้างอิง {sourceInvoice?.invoiceNumber ?? 'Invoice ต้นทาง'}</small>}
                        </>
                      )}
                    </td>
                    <td className={`numeric-cell identifier${isCreditNote ? ' purchase-expense-value--credit' : ''}`}>
                      {isEditing ? <MoneyInput min="0.01" step="0.01" value={editAmount} disabled={pending} onValueChange={setEditAmount} /> : formatBaht(isCreditNote ? -event.amount : event.amount)}
                    </td>
                    <td>{isEditing ? <input value={editNote} disabled={pending} onChange={(input) => setEditNote(input.target.value)} /> : event.note ?? '—'}</td>
                    <td>{isEditing ? <span className="purchase-expense-panel__edit-lock">{event.actorName ?? '—'}</span> : <>{event.actorName ?? '—'}<small>{event.status === 'cancelled' ? 'ยกเลิกแล้ว' : 'ใช้งานอยู่'}</small></>}</td>
                    <td className="purchase-expense-actions">
                      {isEditing ? (
                        <div className="purchase-expense-actions__group" aria-label="บันทึกหรือยกเลิกการแก้ไข">
                          <Button type="button" className="purchase-expense-actions__save" disabled={pending} onClick={() => saveEdit(event)} aria-label="บันทึกการแก้ไขรายการค่าใช้จ่าย" title="บันทึกการแก้ไขรายการค่าใช้จ่าย"><CheckCircleIcon /><span className="visually-hidden">บันทึก</span></Button>
                          <Button type="button" variant="ghost" className="purchase-expense-actions__cancel" disabled={pending} onClick={() => setEditingId(null)} aria-label="ยกเลิกการแก้ไขรายการค่าใช้จ่าย" title="ยกเลิกการแก้ไขรายการค่าใช้จ่าย"><CancelIcon /><span className="visually-hidden">ยกเลิก</span></Button>
                        </div>
                      ) : canRecord && updateAction && cancelAction && event.status === 'active' ? (
                        <div className="purchase-expense-actions__group" aria-label="การทำงานกับรายการค่าใช้จ่าย">
                          <Button type="button" variant="secondary" className="purchase-expense-actions__edit" onClick={() => startEdit(event)} aria-label="แก้ไขรายการค่าใช้จ่าย" title="แก้ไขรายการค่าใช้จ่าย"><EditIcon /><span className="visually-hidden">แก้ไข</span></Button>
                          <Button type="button" variant="danger" className="purchase-expense-actions__cancel" disabled={pending || (event.documentType === 'invoice' && hasActiveCreditNotes(event.id))} onClick={() => cancelExpense(event)} aria-label="ยกเลิกรายการค่าใช้จ่าย" title="ยกเลิกรายการค่าใช้จ่าย"><CancelIcon /><span className="visually-hidden">ยกเลิก</span></Button>
                        </div>
                      ) : null}
                      {event.status === 'active' && event.documentType === 'invoice' && hasActiveCreditNotes(event.id) && <small className="purchase-expense-cancel-hint">ยกเลิกใบลดหนี้ที่อ้างอิงก่อน</small>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot><tr><th colSpan={2}>ยอด active สุทธิ</th><td className="numeric-cell identifier">{formatBaht(activeTotal)}</td><td colSpan={3}>จาก {formatBaht(request.total)} ของยอดรวม PR</td></tr></tfoot>
          </table>
        </div>
      )}
    </section>
  )
}
