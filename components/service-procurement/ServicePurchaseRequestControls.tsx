'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { DEPARTMENTS } from '@/lib/organization/departments'
import { Button } from '@/components/ui/Button'
import { adjustServiceLabExpense, cancelServicePo, cancelServicePurchaseRequest, closeServicePo, confirmServicePurchaseRequest, recordServiceLabExpense, recordServiceUsage, setServiceEphisPrNumber, setServicePoNumber, uploadServicePoFile } from '@/lib/service-procurement/actions'
import { fiscalYearRange, isDateInFiscalYear } from '@/lib/service-procurement/domain'
import { notifyServicePurchaseRequestInLine } from '@/lib/service-procurement/line-notification-actions'
import type { ServicePurchaseRequestRecord } from '@/lib/service-procurement/types'
import { ServicePurchaseRequestHeaderEdit } from './ServicePurchaseRequestHeaderEdit'
import { formatBaht, servicePoStatusLabel, serviceStatusLabel } from '@/lib/service-procurement/presenter'

export function ServicePurchaseRequestControls({ request, canOperate, canEdit }: { request: ServicePurchaseRequestRecord; canOperate: boolean; canEdit: boolean }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [ephis, setEphis] = useState(request.ephisPrNumber ?? '')
  const [po, setPo] = useState(request.poNumber ?? '')
  const [expenseAmount, setExpenseAmount] = useState('')
  const [labAdjustmentAmount, setLabAdjustmentAmount] = useState('')
  const [labAdjustmentReason, setLabAdjustmentReason] = useState('')
  const today = new Date().toISOString().slice(0, 10)
  const defaultServiceDate = isDateInFiscalYear(today, request.fiscalYear) ? today : fiscalYearRange(request.fiscalYear).end
  const [expenseDate, setExpenseDate] = useState(defaultServiceDate)
  const [note, setNote] = useState('')
  const [usageDate, setUsageDate] = useState(defaultServiceDate)
  const [usageQuantities, setUsageQuantities] = useState<Record<string, string>>({})
  const [reason, setReason] = useState('')

  function run(operation: () => Promise<unknown>) {
    setError(null)
    startTransition(async () => { try { await operation(); router.refresh() } catch (caught) { setError(caught instanceof Error ? caught.message : 'ดำเนินการไม่สำเร็จ') } })
  }

  async function uploadPo(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    const formData = new FormData(event.currentTarget)
    startTransition(async () => { try { await uploadServicePoFile(request.id, formData); router.refresh() } catch (caught) { setError(caught instanceof Error ? caught.message : 'แนบไฟล์ PO ไม่สำเร็จ') } })
  }

  const usageItems = request.items.map((item) => ({ itemId: item.id, quantity: Number(usageQuantities[item.id] ?? 0) })).filter((item) => item.quantity > 0)
  const latestLabExpense = request.usageEvents.filter((event) => event.kind === 'lab_expense' || event.kind === 'expense_adjustment').slice().sort((left, right) => left.createdAt.localeCompare(right.createdAt)).pop() ?? null

  return (
    <>
      {canEdit && request.status === 'pending' && <ServicePurchaseRequestHeaderEdit request={request} departments={DEPARTMENTS} />}
      {request.poEvents.length > 0 && <section className="bench-panel service-po-history" aria-label="ประวัติ PO"><div className="bench-panel__header"><div><p className="section-kicker">PO HISTORY</p><h2>ประวัติ PO</h2></div><p>{request.poEvents.length} รายการ</p></div><ul>{request.poEvents.map((event) => <li key={event.id}><strong>{event.kind === 'number_added' ? 'บันทึกเลข PO' : event.kind === 'file_added' ? 'แนบไฟล์ PO' : event.kind === 'closed' ? 'ปิด PO' : 'ยกเลิก PO'}</strong><span>{event.poNumber ?? 'ไม่มีเลข PO'} · {event.actorName ?? 'ไม่ระบุ'} · {event.createdAt}</span>{event.reason && <small>{event.reason}</small>}</li>)}</ul></section>}
      <section className="service-pr-controls" aria-label="การดำเนินการใบ PR งานจ้าง">
      <div className="service-pr-actions bench-panel">
        <div className="bench-panel__header"><div><p className="section-kicker">WORKFLOW</p><h2>ดำเนินการ</h2></div><p>{serviceStatusLabel(request.status)} · {servicePoStatusLabel(request.poStatus)}</p></div>
        {request.status === 'pending' && canOperate && <Button disabled={pending} onClick={() => run(() => confirmServicePurchaseRequest(request.id))}>ยืนยันโดยคลัง</Button>}
        {request.status === 'pending' && canEdit && <Button variant="danger" disabled={pending} onClick={() => { const value = window.prompt('เหตุผลที่ยกเลิก PR'); if (value) run(() => cancelServicePurchaseRequest(request.id, value)) }}>ยกเลิก PR</Button>}
        {request.status === 'confirmed' && canOperate && <div className="service-pr-fields"><label><span>เลข PR จาก E-Phis</span><input value={ephis} onChange={(event) => setEphis(event.target.value)} /></label><Button variant="secondary" disabled={pending || !ephis.trim()} onClick={() => run(() => setServiceEphisPrNumber(request.id, ephis))}>บันทึกเลข PR</Button><label><span>เลข PO</span><input value={po} onChange={(event) => setPo(event.target.value)} /></label><Button variant="secondary" disabled={pending || !po.trim()} onClick={() => run(() => setServicePoNumber(request.id, po))}>บันทึกเลข PO</Button></div>}
        {canOperate && request.status === 'confirmed' && <form className="service-po-upload" onSubmit={uploadPo}><label><span>แนบไฟล์ PO</span><input required type="file" name="file" accept="application/pdf,image/jpeg,image/png,image/webp" /></label><Button variant="secondary" disabled={pending}>อัปโหลดไฟล์ PO</Button></form>}
        {request.status === 'confirmed' && canOperate && (request.poNumber || request.poFileName) && <div className="service-pr-action-row"><Button disabled={pending} onClick={() => run(() => closeServicePo(request.id, null))}>ปิด PO</Button><Button variant="danger" disabled={pending} onClick={() => { const value = window.prompt('เหตุผลที่ยกเลิก PO'); if (value) run(() => cancelServicePo(request.id, value)) }}>ยกเลิก PO</Button></div>}
        {canOperate && request.poNumber && request.poFileName && request.status !== 'cancelled' && <div className="service-pr-action-row"><Button variant="secondary" disabled={pending} onClick={() => run(() => notifyServicePurchaseRequestInLine(request.id))}>แจ้งเตือนผ่าน LINE</Button><span className="service-inline-hint">ส่งเลข PO และลิงก์ไฟล์ให้เจ้าหน้าที่ที่ตั้งค่าไว้</span></div>}
      </div>
      {request.status === 'confirmed' && (request.poNumber || request.poFileName) && request.purchaseMethod === 'annual_items' && <div id="service-pr-usage" className="bench-panel"><div className="bench-panel__header"><div><p className="section-kicker">DAILY USAGE</p><h2>บันทึกการใช้</h2></div><p>ตัดยอดตามราคาที่ล็อกใน PR</p></div><label><span>วันที่ใช้</span><input type="date" value={usageDate} onChange={(event) => setUsageDate(event.target.value)} /></label><div className="service-usage-editor">{request.items.map((item) => <label key={item.id}><span>{item.name} · เหลือ {item.remainingQuantity} {item.unit}</span><input type="number" min="0" max={item.remainingQuantity} step="0.001" value={usageQuantities[item.id] ?? ''} onChange={(event) => setUsageQuantities((current) => ({ ...current, [item.id]: event.target.value }))} /></label>)}</div><label><span>หมายเหตุ</span><input value={note} onChange={(event) => setNote(event.target.value)} /></label><Button disabled={pending || usageItems.length === 0} onClick={() => run(() => recordServiceUsage({ requestId: request.id, usageDate, items: usageItems, note: note || null }))}>บันทึกการใช้</Button></div>}
      {request.status === 'confirmed' && request.poNumber && request.purchaseMethod === 'laboratory_testing' && <div id="service-pr-usage" className="bench-panel"><div className="bench-panel__header"><div><p className="section-kicker">ACTUAL EXPENSE</p><h2>บันทึกค่าใช้จ่ายจริง</h2></div><p>เพดาน PR {formatBaht(request.requestedAmount)}</p></div><div className="form-grid"><label><span>วันที่ค่าใช้จ่าย</span><input type="date" value={expenseDate} onChange={(event) => setExpenseDate(event.target.value)} /></label><label><span>ยอดจริง</span><input type="number" min="0.01" max={request.requestedAmount} step="0.01" value={expenseAmount} onChange={(event) => setExpenseAmount(event.target.value)} /></label></div><label><span>หมายเหตุ</span><input value={note} onChange={(event) => setNote(event.target.value)} /></label><Button disabled={pending || !expenseAmount} onClick={() => run(() => recordServiceLabExpense({ requestId: request.id, expenseDate, amount: Number(expenseAmount), note: note || null }))}>บันทึกและปิด PR/PO</Button></div>}
      {request.status === 'closed' && request.purchaseMethod === 'laboratory_testing' && latestLabExpense && (canOperate || canEdit) && <div className="bench-panel"><div className="bench-panel__header"><div><p className="section-kicker">AUDITED ADJUSTMENT</p><h2>ปรับยอดค่าใช้จ่ายจริง</h2></div><p>ยอดสุทธิต้องไม่เกิน {formatBaht(request.requestedAmount)}</p></div><div className="form-grid"><label><span>วันที่ปรับ</span><input type="date" value={expenseDate} onChange={(event) => setExpenseDate(event.target.value)} /></label><label><span>ยอดปรับ (+ / −)</span><input type="number" step="0.01" value={labAdjustmentAmount} onChange={(event) => setLabAdjustmentAmount(event.target.value)} placeholder="เช่น -1200" /></label></div><label><span>เหตุผล</span><input value={labAdjustmentReason} onChange={(event) => setLabAdjustmentReason(event.target.value)} /></label><Button disabled={pending || !labAdjustmentAmount || !labAdjustmentReason.trim()} onClick={() => run(() => adjustServiceLabExpense({ requestId: request.id, sourceEventId: latestLabExpense.id, expenseDate, amount: Number(labAdjustmentAmount), note: labAdjustmentReason }))}>บันทึกการปรับยอด</Button></div>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {request.status === 'closed' && canOperate && <div className="bench-panel service-pr-reversal"><h2>ยกเลิก PO หลังปิด</h2><p>หากยกเลิกหลังมีการใช้ ระบบจะย้อนยอดใช้จริงทั้งหมดและคงประวัติเดิมไว้</p><input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="เหตุผลการยกเลิก" /><Button variant="danger" disabled={pending || !reason.trim()} onClick={() => run(() => cancelServicePo(request.id, reason))}>ยกเลิก PO และย้อนยอด</Button></div>}
      </section>
    </>
  )
}
