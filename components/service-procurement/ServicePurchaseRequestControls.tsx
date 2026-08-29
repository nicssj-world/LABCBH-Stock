'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { DEPARTMENTS } from '@/lib/organization/departments'
import { Button } from '@/components/ui/Button'
import { MoneyInput } from '@/components/ui/MoneyInput'
import {
  cancelServiceLabExpense,
  cancelServicePo,
  cancelServicePurchaseRequest,
  closeServicePo,
  confirmServicePurchaseRequest,
  recordServiceLabExpense,
  setServiceEphisPrNumber,
  setServicePoNumber,
  updateServiceLabExpense,
  uploadServicePoFile,
} from '@/lib/service-procurement/actions'
import { notifyServicePurchaseRequestInLine } from '@/lib/service-procurement/line-notification-actions'
import { serviceRequestDisplayStatus, serviceRequestDisplayStatusLabel, serviceRequestDisplayStatusTone } from '@/lib/service-procurement/presenter'
import type { ServicePurchaseRequestRecord } from '@/lib/service-procurement/types'
import { formatBaht } from '@/lib/service-procurement/presenter'
import { ServicePurchaseRequestHeaderEdit } from './ServicePurchaseRequestHeaderEdit'

interface Props {
  request: ServicePurchaseRequestRecord
  canOperate: boolean
  canEdit: boolean
  canRecord?: boolean
  canClose?: boolean
  canCancel?: boolean
}

export function ServicePurchaseRequestControls({ request, canOperate, canEdit, canRecord = canEdit, canClose = canEdit, canCancel = canEdit }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [ephis, setEphis] = useState(request.ephisPrNumber ?? '')
  const [po, setPo] = useState(request.poNumber ?? '')
  const [expenseDate, setExpenseDate] = useState(request.usageStartDate)
  const [expenseAmount, setExpenseAmount] = useState('')
  const [invoice, setInvoice] = useState('')
  const [note, setNote] = useState('')
  const amountRef = useRef<HTMLInputElement>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDate, setEditDate] = useState(request.usageStartDate)
  const [editAmount, setEditAmount] = useState('')
  const [editInvoice, setEditInvoice] = useState('')
  const [editNote, setEditNote] = useState('')
  const displayStatus = serviceRequestDisplayStatus(request)
  const hasEvidence = Boolean(request.poNumber?.trim() && request.poFileName?.trim())
  const hasAnyEvidence = Boolean(request.poNumber?.trim() || request.poFileName?.trim())
  const activeExpenses = request.usageEvents.filter((event) => event.kind === 'lab_expense' && event.status === 'active')
  const activeTotal = activeExpenses.reduce((sum, event) => sum + event.amount, 0)
  const isDailyExpense = request.expenseFrequency === 'daily'

  function expenseDateForMonth(month: string): string {
    if (!month) return ''
    const firstDay = `${month}-01`
    return firstDay < request.usageStartDate ? request.usageStartDate : firstDay
  }

  function run(operation: () => Promise<unknown>) {
    setError(null)
    startTransition(async () => { try { await operation(); router.refresh() } catch (caught) { setError(caught instanceof Error ? caught.message : 'ดำเนินการไม่สำเร็จ') } })
  }

  async function uploadPo(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(null)
    const formData = new FormData(event.currentTarget)
    startTransition(async () => { try { await uploadServicePoFile(request.id, formData); router.refresh() } catch (caught) { setError(caught instanceof Error ? caught.message : 'แนบไฟล์ PO ไม่สำเร็จ') } })
  }

  function submitExpense() {
    const parsed = Number(expenseAmount)
    if (!expenseDate || !Number.isFinite(parsed) || parsed <= 0) return setError('กรุณาระบุวันที่และยอดค่าใช้จ่าย')
    run(() => recordServiceLabExpense({ requestId: request.id, expenseDate, amount: parsed, invoiceNumber: invoice || null, note: note || null }))
    setExpenseAmount(''); setInvoice(''); setNote('')
  }

  function startEdit(event: typeof activeExpenses[number]) {
    setEditingId(event.id); setEditDate(event.expenseDate); setEditAmount(String(event.amount)); setEditInvoice(event.invoiceNumber ?? ''); setEditNote(event.note ?? '')
  }

  function saveEdit(expenseId: string) {
    const parsed = Number(editAmount)
    const reason = window.prompt('เหตุผลที่แก้ไขรายการค่าใช้จ่าย')
    if (!reason?.trim()) return
    run(() => updateServiceLabExpense({ requestId: request.id, expenseId, expenseDate: editDate, amount: parsed, invoiceNumber: editInvoice || null, note: editNote || null, reason }))
    setEditingId(null)
  }

  function removeExpense(expenseId: string) {
    const reason = window.prompt('เหตุผลที่ยกเลิกรายการค่าใช้จ่าย')
    if (reason?.trim()) run(() => cancelServiceLabExpense({ requestId: request.id, expenseId, reason }))
  }

  function cancelPo() {
    if (!window.confirm(`ยืนยันยกเลิกใบ PO ${request.poNumber ?? ''} หรือไม่ การยกเลิกจะคืนยอดสำรองเต็มจำนวน`)) return
    const reason = window.prompt('เหตุผลที่ยกเลิก PO (จำเป็น)')
    if (reason?.trim()) run(() => cancelServicePo(request.id, reason))
  }

  function closePo() {
    if (!window.confirm(`ยืนยันปิดใบ PO ${request.poNumber ?? ''} และตัดยอดค่าใช้จ่าย ${formatBaht(activeTotal)} จากแผนหรือไม่`)) return
    run(() => closeServicePo(request.id, null))
  }

  return (
    <>
      {canEdit && request.status === 'pending' && <ServicePurchaseRequestHeaderEdit request={request} departments={DEPARTMENTS} />}
      {request.poEvents.length > 0 && <section className="bench-panel service-po-history" aria-label="ประวัติ PO"><div className="bench-panel__header"><div><p className="section-kicker">PO HISTORY</p><h2>ประวัติ PO</h2></div><p>{request.poEvents.length} รายการ</p></div><ul>{request.poEvents.map((event) => <li key={event.id}><strong>{event.kind === 'number_added' ? 'บันทึกเลข PO' : event.kind === 'file_added' ? 'แนบไฟล์ PO' : event.kind === 'closed' ? 'ปิด PO' : 'ยกเลิก PO'}</strong><span>{event.poNumber ?? 'ไม่มีเลข PO'} · {event.actorName ?? 'ไม่ระบุ'} · {event.createdAt}</span>{event.reason && <small>{event.reason}</small>}</li>)}</ul></section>}
      <section className="service-pr-controls" aria-label="การดำเนินการใบ PR งานจ้าง">
        <div className="service-pr-actions bench-panel">
          <div className="bench-panel__header"><div><p className="section-kicker">WORKFLOW</p><h2>ดำเนินการ</h2></div><span className={`status-chip status-chip--${serviceRequestDisplayStatusTone(displayStatus)}`}>{serviceRequestDisplayStatusLabel(displayStatus)}</span></div>
          {request.status === 'pending' && canOperate && <Button disabled={pending} onClick={() => run(() => confirmServicePurchaseRequest(request.id))}>ยืนยัน PR โดยคลัง</Button>}
          {request.status === 'pending' && canEdit && <Button type="button" variant="danger" disabled={pending} onClick={() => { const reason = window.prompt('เหตุผลที่ยกเลิก PR'); if (reason?.trim()) run(() => cancelServicePurchaseRequest(request.id, reason)) }}>ยกเลิก PR</Button>}
          {request.status === 'confirmed' && canOperate && <div className="service-pr-fields"><label><span>เลข PR จาก E-Phis</span><input value={ephis} onChange={(event) => setEphis(event.target.value)} /></label><Button type="button" variant="secondary" disabled={pending || !ephis.trim()} onClick={() => run(() => setServiceEphisPrNumber(request.id, ephis))}>บันทึกเลข PR</Button><label><span>เลข PO</span><input value={po} onChange={(event) => setPo(event.target.value)} /></label><Button type="button" variant="secondary" disabled={pending || !po.trim()} onClick={() => run(() => setServicePoNumber(request.id, po))}>บันทึกเลข PO</Button></div>}
          {request.status === 'confirmed' && canOperate && <form className="service-po-upload" onSubmit={uploadPo}><label><span>แนบไฟล์ PO</span><input required type="file" name="file" accept="application/pdf,image/jpeg,image/png,image/webp" /></label><Button type="submit" variant="secondary" disabled={pending}>อัปโหลดไฟล์ PO</Button></form>}
          {request.status === 'confirmed' && hasEvidence && <div className="service-pr-action-row">{canClose && <Button type="button" disabled={pending} onClick={closePo}>ปิดใบ PO</Button>}{canCancel && <Button type="button" variant="danger" disabled={pending} onClick={cancelPo}>ยกเลิกใบ PO</Button>}</div>}
          {canOperate && hasEvidence && request.status === 'confirmed' && <div className="service-pr-action-row"><Button type="button" variant="secondary" disabled={pending} onClick={() => run(() => notifyServicePurchaseRequestInLine(request.id))}>แจ้งเตือนผ่าน LINE</Button><span className="service-inline-hint">ส่งเลข PO และลิงก์ไฟล์ให้เจ้าหน้าที่ที่ตั้งค่าไว้</span></div>}
          {error && <p className="form-error" role="alert">{error}</p>}
        </div>

        {request.status === 'confirmed' && hasAnyEvidence && canRecord && <section id="service-pr-usage" className="bench-panel"><div className="bench-panel__header"><div><p className="section-kicker">ACTUAL EXPENSE</p><h2>บันทึกค่าใช้จ่ายจริง</h2></div><p>ใช้แล้ว {formatBaht(activeTotal)} / {formatBaht(request.requestedAmount)} · {isDailyExpense ? 'บันทึกได้หลายรายการต่อวัน' : 'เดือนละ 1 รายการต่อ PO'}</p></div><div className="form-grid"><label><span>{isDailyExpense ? 'วันที่ค่าใช้จ่าย' : 'เดือนค่าใช้จ่าย'} <span className="field-required" aria-hidden="true">*</span></span><input type={isDailyExpense ? 'date' : 'month'} required min={isDailyExpense ? request.usageStartDate : request.usageStartDate.slice(0, 7)} max={isDailyExpense ? request.usageEndDate : request.usageEndDate.slice(0, 7)} value={isDailyExpense ? expenseDate : expenseDate.slice(0, 7)} onChange={(event) => setExpenseDate(isDailyExpense ? event.target.value : expenseDateForMonth(event.target.value))} /></label><label><span>ยอดจริง <span className="field-required" aria-hidden="true">*</span></span><MoneyInput ref={amountRef} required min="0.01" step="0.01" max={Math.max(0, request.requestedAmount - activeTotal)} value={expenseAmount} onValueChange={setExpenseAmount} /></label><label><span>Invoice <small>(ไม่บังคับ · รองรับสแกนบาร์โค้ด)</small></span><input value={invoice} onChange={(event) => setInvoice(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); amountRef.current?.focus() } }} /></label><label><span>หมายเหตุ</span><input value={note} onChange={(event) => setNote(event.target.value)} /></label></div><Button type="button" disabled={pending || !expenseAmount} onClick={submitExpense}>บันทึกค่าใช้จ่าย</Button><p className="field-help">ระบบยังไม่ตัดยอดแผนจนกว่าจะกด “ปิดใบ PO”</p></section>}

        {request.status === 'confirmed' && hasAnyEvidence && <section className="bench-panel" aria-labelledby="service-expense-list-title"><div className="bench-panel__header"><div><p className="section-kicker">EXPENSE LOG</p><h2 id="service-expense-list-title">รายการค่าใช้จ่ายก่อนปิด PO</h2></div></div>{activeExpenses.length === 0 ? <p className="empty-state">ยังไม่มีรายการค่าใช้จ่าย</p> : <div className="service-ledger-table-wrap"><table className="data-table"><thead><tr><th>{isDailyExpense ? 'วันที่' : 'เดือน'}</th><th>Invoice</th><th>ยอด</th><th>หมายเหตุ</th><th>การทำงาน</th></tr></thead><tbody>{activeExpenses.map((event) => editingId === event.id ? <tr key={event.id}><td><input type={isDailyExpense ? 'date' : 'month'} min={isDailyExpense ? request.usageStartDate : request.usageStartDate.slice(0, 7)} max={isDailyExpense ? request.usageEndDate : request.usageEndDate.slice(0, 7)} value={isDailyExpense ? editDate : editDate.slice(0, 7)} onChange={(e) => setEditDate(isDailyExpense ? e.target.value : expenseDateForMonth(e.target.value))} /></td><td><input value={editInvoice} onChange={(e) => setEditInvoice(e.target.value)} /></td><td><MoneyInput min="0.01" step="0.01" value={editAmount} onValueChange={setEditAmount} /></td><td><input value={editNote} onChange={(e) => setEditNote(e.target.value)} /></td><td><Button type="button" onClick={() => saveEdit(event.id)} disabled={pending}>บันทึก</Button><Button type="button" variant="ghost" onClick={() => setEditingId(null)}>ยกเลิก</Button></td></tr> : <tr key={event.id}><td>{isDailyExpense ? event.expenseDate : event.expenseDate.slice(0, 7)}</td><td>{event.invoiceNumber ?? '—'}</td><td className="identifier">{formatBaht(event.amount)}</td><td>{event.note ?? '—'}</td><td>{canRecord && <><Button type="button" variant="ghost" onClick={() => startEdit(event)}>แก้ไข</Button><Button type="button" variant="ghost" onClick={() => removeExpense(event.id)}>ยกเลิก</Button></>}</td></tr>)}</tbody></table></div>}</section>}
      </section>
    </>
  )
}
