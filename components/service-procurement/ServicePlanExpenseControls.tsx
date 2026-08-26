'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { adjustServicePlanExpense, deleteServicePlan, recordServicePlanHistoricalExpense, reviseServicePlanBudget } from '@/lib/service-procurement/actions'
import { fiscalYearRange, isDateInFiscalYear } from '@/lib/service-procurement/domain'
import type { ServicePlanRecord } from '@/lib/service-procurement/types'
import { formatBaht } from '@/lib/service-procurement/presenter'

export function ServicePlanExpenseControls({ plan, canManage }: { plan: ServicePlanRecord; canManage: boolean }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [budget, setBudget] = useState(String(plan.budget))
  const [budgetReason, setBudgetReason] = useState('')
  const [expenseAmount, setExpenseAmount] = useState('')
  const [expenseDate, setExpenseDate] = useState('')
  const [expenseReason, setExpenseReason] = useState('')
  const [source, setSource] = useState('')
  const [adjustment, setAdjustment] = useState('')
  const [adjustmentReason, setAdjustmentReason] = useState('')
  const today = new Date().toISOString().slice(0, 10)
  const [adjustmentDate, setAdjustmentDate] = useState(isDateInFiscalYear(today, plan.fiscalYear) ? today : fiscalYearRange(plan.fiscalYear).end)

  function run(operation: () => Promise<unknown>) {
    setError(null)
    startTransition(async () => {
      try { await operation(); router.refresh() } catch (caught) { setError(caught instanceof Error ? caught.message : 'บันทึกไม่สำเร็จ') }
    })
  }

  return (
    <section className="service-plan-controls" aria-label="การจัดการยอดแผนงานจ้าง">
      {canManage && <section className="bench-panel">
        <div className="bench-panel__header"><div><p className="section-kicker">BUDGET CONTROL</p><h2>ปรับวงเงินแผน</h2></div><p>ใช้จริง + สำรอง {formatBaht(plan.balance.spent + plan.balance.reserved)}</p></div>
        <div className="form-grid">
          <label><span>วงเงินใหม่</span><input type="number" min="0.01" step="0.01" value={budget} onChange={(event) => setBudget(event.target.value)} /></label>
          <label><span>เหตุผล</span><input value={budgetReason} onChange={(event) => setBudgetReason(event.target.value)} placeholder="เช่น ได้รับจัดสรรเพิ่ม" /></label>
        </div>
        <Button disabled={pending || !budgetReason.trim()} onClick={() => run(() => reviseServicePlanBudget({ planId: plan.id, budget: Number(budget), reason: budgetReason }))}>บันทึกวงเงินใหม่</Button>
      </section>}
      <section className="bench-panel">
        <div className="bench-panel__header"><div><p className="section-kicker">HISTORICAL ENTRY</p><h2>บันทึกค่าใช้จ่ายย้อนหลัง</h2></div></div>
        <p className="items-editor__note">ใช้ได้เฉพาะวันที่ผ่านมาแล้วในปีงบของแผน และต้องระบุแหล่งอ้างอิง</p>
        <div className="form-grid">
          <label><span>วันที่</span><input type="date" value={expenseDate} onChange={(event) => setExpenseDate(event.target.value)} /></label>
          <label><span>ยอดเงิน</span><input type="number" min="0.01" step="0.01" value={expenseAmount} onChange={(event) => setExpenseAmount(event.target.value)} /></label>
          <label><span>เหตุผล</span><input value={expenseReason} onChange={(event) => setExpenseReason(event.target.value)} /></label>
          <label><span>แหล่งอ้างอิง</span><input value={source} onChange={(event) => setSource(event.target.value)} placeholder="เลขเอกสาร/ใบสำคัญ" /></label>
        </div>
        <Button disabled={pending || !expenseDate || !expenseAmount || !expenseReason.trim() || !source.trim()} onClick={() => run(() => recordServicePlanHistoricalExpense({ planId: plan.id, amount: Number(expenseAmount), expenseDate, reason: expenseReason, sourceReference: source }))}>บันทึกย้อนหลัง</Button>
      </section>
      <section className="bench-panel">
        <div className="bench-panel__header"><div><p className="section-kicker">AUDITED ADJUSTMENT</p><h2>ปรับยอดค่าใช้จ่าย</h2></div></div>
        <div className="form-grid">
          <label><span>วันที่ปรับ</span><input type="date" value={adjustmentDate} onChange={(event) => setAdjustmentDate(event.target.value)} /></label>
          <label><span>ยอดปรับ (+ / −)</span><input type="number" step="0.01" value={adjustment} onChange={(event) => setAdjustment(event.target.value)} placeholder="เช่น -1200" /></label>
          <label><span>เหตุผล</span><input value={adjustmentReason} onChange={(event) => setAdjustmentReason(event.target.value)} /></label>
        </div>
        <Button disabled={pending || !adjustmentDate || !adjustment || !adjustmentReason.trim()} onClick={() => run(() => adjustServicePlanExpense({ planId: plan.id, amount: Number(adjustment), expenseDate: adjustmentDate, reason: adjustmentReason, sourceReference: 'ปรับปรุงจากหน้ารายละเอียดแผน', sourceLedgerId: null }))}>บันทึกการปรับยอด</Button>
      </section>
      {error && <p className="form-error" role="alert">{error}</p>}
      {canManage && <div className="service-plan-danger-zone"><Button variant="danger" disabled={pending} onClick={() => { if (window.confirm('ลบแผนนี้ถาวรหรือไม่? การลบจะย้อนคืนไม่ได้')) run(() => deleteServicePlan(plan.id)) }}>ลบแผนถาวร</Button></div>}
    </section>
  )
}
