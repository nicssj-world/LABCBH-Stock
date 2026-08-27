'use client'

import { useId, useMemo, useRef, useState, useTransition, type FormEvent, type RefObject } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { deleteServicePlan, recordServicePlanHistoricalExpense, reviseServicePlanBudget } from '@/lib/service-procurement/actions'
import { fiscalYearRange, servicePlanExpenseMonthOptions } from '@/lib/service-procurement/domain'
import type { ServicePlanRecord } from '@/lib/service-procurement/types'
import { formatBaht } from '@/lib/service-procurement/presenter'

const monthLabel = new Intl.DateTimeFormat('th-TH-u-ca-buddhist', {
  year: 'numeric',
  month: 'long',
  timeZone: 'Asia/Bangkok',
})

type ControlsMode = 'budget' | 'expense' | 'danger'
type FinancialAction = Exclude<ControlsMode, 'danger'>

interface ServicePlanExpenseControlsProps {
  plan: ServicePlanRecord
  canManage: boolean
  mode?: ControlsMode
}

function monthName(value: string) {
  return monthLabel.format(new Date(`${value}-01T00:00:00+07:00`))
}

export function ServicePlanExpenseControls({
  plan,
  canManage,
  mode = 'expense',
}: ServicePlanExpenseControlsProps) {
  const router = useRouter()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [activeAction, setActiveAction] = useState<FinancialAction | null>(null)
  const [expenseOpen, setExpenseOpen] = useState(false)
  const [budget, setBudget] = useState(String(plan.budget))
  const [budgetReason, setBudgetReason] = useState('')
  const expenseMonths = useMemo(() => servicePlanExpenseMonthOptions(plan.fiscalYear), [plan.fiscalYear])
  const [expenseMonth, setExpenseMonth] = useState(expenseMonths[expenseMonths.length - 1] ?? '')
  const [expenseAmount, setExpenseAmount] = useState('')
  const [note, setNote] = useState('')
  const [source, setSource] = useState('')
  const idPrefix = useId()
  const titleId = idPrefix + '-title'
  const descriptionId = idPrefix + '-description'
  const budgetId = idPrefix + '-budget'
  const budgetReasonId = idPrefix + '-budget-reason'
  const expenseMonthId = idPrefix + '-expense-month'
  const expenseAmountId = idPrefix + '-expense-amount'
  const sourceId = idPrefix + '-source'
  const noteId = idPrefix + '-note'
  const errorId = idPrefix + '-error'
  const expenseFormId = idPrefix + '-expense-form'
  const dialogAction: FinancialAction | null = mode === 'budget' || mode === 'expense' ? mode : null
  const fiscalPeriod = fiscalYearRange(plan.fiscalYear)
  const parsedExpenseAmount = Number(expenseAmount)
  const expenseReady = Boolean(
    expenseMonth &&
    expenseAmount &&
    Number.isFinite(parsedExpenseAmount) &&
    parsedExpenseAmount > 0 &&
    source.trim(),
  )

  const closeDialog = () => {
    dialogRef.current?.close()
    setActiveAction(null)
    setError(null)
  }

  const openDialog = (action: FinancialAction) => {
    setActiveAction(action)
    setError(null)
    if (!dialogRef.current?.open) dialogRef.current?.showModal()
  }

  const toggleExpense = () => {
    if (expenseOpen) setError(null)
    setExpenseOpen(!expenseOpen)
  }

  const run = (operation: () => Promise<unknown>, afterSuccess?: () => void) => {
    setError(null)
    startTransition(async () => {
      try {
        await operation()
        afterSuccess?.()
        if (dialogRef.current?.open) closeDialog()
        router.refresh()
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'บันทึกไม่สำเร็จ')
      }
    })
  }

  const submitBudget = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!budgetReason.trim() || !budget.trim()) return
    run(() => reviseServicePlanBudget({
      planId: plan.id,
      budget: Number(budget),
      reason: budgetReason.trim(),
    }))
  }

  const submitExpense = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!expenseReady) return
    run(async () => {
      await recordServicePlanHistoricalExpense({
        planId: plan.id,
        amount: parsedExpenseAmount,
        expenseDate: expenseMonth + '-01',
        reason: note.trim() || null,
        sourceReference: source.trim(),
      })
      setExpenseAmount('')
      setNote('')
      setSource('')
      setExpenseMonth(expenseMonths[expenseMonths.length - 1] ?? '')
    }, () => setExpenseOpen(false))
  }

  if (mode === 'budget') {
    if (!canManage) return null

    return (
      <>
        <Button
          variant="secondary"
          className="service-plan-header-action"
          aria-haspopup="dialog"
          onClick={() => openDialog('budget')}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path d="M4 7.5h16M6.5 4v16M17.5 4v16M4 16.5h16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          </svg>
          ปรับวงเงินแผน
        </Button>
        {dialogAction && (
          <FinancialDialog
            action={activeAction ?? dialogAction}
            dialogRef={dialogRef}
            titleId={titleId}
            descriptionId={descriptionId}
            errorId={errorId}
            budgetId={budgetId}
            budgetReasonId={budgetReasonId}
            expenseMonthId={expenseMonthId}
            expenseAmountId={expenseAmountId}
            sourceId={sourceId}
            noteId={noteId}
            budget={budget}
            budgetReason={budgetReason}
            expenseMonths={expenseMonths}
            expenseMonth={expenseMonth}
            expenseAmount={expenseAmount}
            source={source}
            note={note}
            fiscalYear={plan.fiscalYear}
            fiscalPeriod={fiscalPeriod}
            currentBudget={plan.budget}
            committedAmount={plan.balance.spent + plan.balance.reserved}
            error={error}
            pending={pending}
            onClose={closeDialog}
            onBudgetSubmit={submitBudget}
            onExpenseSubmit={submitExpense}
            onBudgetChange={setBudget}
            onBudgetReasonChange={setBudgetReason}
            onExpenseMonthChange={setExpenseMonth}
            onExpenseAmountChange={setExpenseAmount}
            onSourceChange={setSource}
            onNoteChange={setNote}
          />
        )}
      </>
    )
  }

  if (mode === 'danger') {
    if (!canManage) return null

    return (
      <section className="bench-panel service-plan-danger-panel" aria-labelledby={idPrefix + '-danger-title'}>
        <div className="bench-panel__header">
          <div>
            <p className="section-kicker">PERMANENT ACTIONS</p>
            <h2 id={idPrefix + '-danger-title'}>การดำเนินการถาวร</h2>
          </div>
        </div>
        <div className="service-plan-danger-zone">
          <div>
            <strong>ลบแผนถาวร</strong>
            <small>ลบได้เฉพาะแผนที่ยังไม่มีรายการอ้างอิง และไม่สามารถย้อนคืนได้</small>
          </div>
          <Button
            variant="danger"
            disabled={pending}
            onClick={() => {
              if (window.confirm('ลบแผนนี้ถาวรหรือไม่? การลบจะย้อนคืนไม่ได้')) {
                run(() => deleteServicePlan(plan.id), () => router.push('/service-procurement/plans'))
              }
            }}
          >
            ลบแผนถาวร
          </Button>
        </div>
        {error && <p className="form-error service-plan-controls__feedback" role="alert">{error}</p>}
      </section>
    )
  }

  return (
    <section className="expense-entry expense-entry--contract service-plan-expense-entry" aria-labelledby={expenseFormId + '-title'}>
      <button
        type="button"
        className="expense-entry__toggle"
        aria-expanded={expenseOpen}
        aria-controls={expenseFormId}
        disabled={pending}
        onClick={toggleExpense}
      >
        <span className="expense-entry__glyph" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="20" height="20">
            <path d="M12 5v14m-7-7h14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </span>
        <span className="expense-entry__copy">
          <strong id={expenseFormId + '-title'}>บันทึกค่าใช้จ่าย</strong>
          <small>{expenseOpen ? 'กรอกข้อมูลและบันทึกรายการใหม่' : 'กดเพื่อเพิ่มยอดใช้จ่ายประจำเดือน'}</small>
        </span>
        <svg className={expenseOpen ? 'expense-entry__chevron expense-entry__chevron--open' : 'expense-entry__chevron'} viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {expenseOpen && (
        <form id={expenseFormId} className="expense-form service-plan-expense-form" onSubmit={submitExpense}>
          <div className="expense-form__primary">
            <label htmlFor={expenseMonthId}>
              <span>เดือนที่ใช้จ่าย <span className="field-required" aria-hidden="true">*</span></span>
              <select id={expenseMonthId} value={expenseMonth} onChange={(event) => setExpenseMonth(event.target.value)} required disabled={expenseMonths.length === 0}>
                {expenseMonths.length === 0 && <option value="">ยังไม่มีเดือนสำหรับบันทึก</option>}
                {expenseMonths.map((month) => <option key={month} value={month}>{monthName(month)}</option>)}
              </select>
              <small className="expense-form__remaining-hint">เลือกได้ถึงเดือนปัจจุบันในปีงบประมาณ {plan.fiscalYear}</small>
            </label>
            <label htmlFor={expenseAmountId}>
              <span>ยอดใช้จ่าย (บาท) <span className="field-required" aria-hidden="true">*</span></span>
              <input id={expenseAmountId} type="number" inputMode="decimal" min="0.01" step="0.01" value={expenseAmount} onChange={(event) => setExpenseAmount(event.target.value)} placeholder="เช่น 111463.20" required />
              <small className="expense-form__remaining-hint">คงเหลือใช้งานได้ {formatBaht(plan.balance.available)}</small>
            </label>
          </div>

          <div className="expense-form__secondary">
            <label htmlFor={sourceId}>
              <span>เลข PR/PO <span className="field-required" aria-hidden="true">*</span></span>
              <input id={sourceId} value={source} onChange={(event) => setSource(event.target.value)} placeholder="เช่น PR-2569-0001 หรือ PO-0001" maxLength={240} required />
            </label>
            <label htmlFor={noteId}>
              <span>หมายเหตุ <span className="field-optional">ไม่บังคับ</span></span>
              <input id={noteId} value={note} onChange={(event) => setNote(event.target.value)} placeholder="รายละเอียดเพิ่มเติม (ถ้ามี)" maxLength={1000} />
            </label>
          </div>

          {expenseMonths.length === 0 && <p className="completion-note">แผนนี้ยังไม่มีช่วงเดือนที่สามารถบันทึกค่าใช้จ่ายได้</p>}
          {error && <p className="form-error" role="alert">{error}</p>}

          <div className="expense-form__footer">
            <Button type="submit" disabled={pending || !expenseReady}>
              {pending ? 'กำลังบันทึก…' : 'บันทึกค่าใช้จ่าย'}
            </Button>
          </div>
        </form>
      )}
    </section>
  )
}

interface FinancialDialogProps {
  action: FinancialAction
  dialogRef: RefObject<HTMLDialogElement | null>
  titleId: string
  descriptionId: string
  errorId: string
  budgetId: string
  budgetReasonId: string
  expenseMonthId: string
  expenseAmountId: string
  sourceId: string
  noteId: string
  budget: string
  budgetReason: string
  expenseMonths: string[]
  expenseMonth: string
  expenseAmount: string
  source: string
  note: string
  fiscalYear: number
  fiscalPeriod: { start: string; end: string }
  currentBudget: number
  committedAmount: number
  error: string | null
  pending: boolean
  onClose: () => void
  onBudgetSubmit: (event: FormEvent<HTMLFormElement>) => void
  onExpenseSubmit: (event: FormEvent<HTMLFormElement>) => void
  onBudgetChange: (value: string) => void
  onBudgetReasonChange: (value: string) => void
  onExpenseMonthChange: (value: string) => void
  onExpenseAmountChange: (value: string) => void
  onSourceChange: (value: string) => void
  onNoteChange: (value: string) => void
}

function FinancialDialog({
  action,
  dialogRef,
  titleId,
  descriptionId,
  errorId,
  budgetId,
  budgetReasonId,
  expenseMonthId,
  expenseAmountId,
  sourceId,
  noteId,
  budget,
  budgetReason,
  expenseMonths,
  expenseMonth,
  expenseAmount,
  source,
  note,
  fiscalYear,
  fiscalPeriod,
  currentBudget,
  committedAmount,
  error,
  pending,
  onClose,
  onBudgetSubmit,
  onExpenseSubmit,
  onBudgetChange,
  onBudgetReasonChange,
  onExpenseMonthChange,
  onExpenseAmountChange,
  onSourceChange,
  onNoteChange,
}: FinancialDialogProps) {
  const isBudget = action === 'budget'
  const title = isBudget ? 'ปรับวงเงินแผน' : 'บันทึกค่าใช้จ่าย'
  const description = isBudget
    ? 'ใช้เมื่อต้องปรับวงเงินตั้งต้นของสัญญาเท่านั้น'
    : 'เลือกเดือนที่ใช้จ่ายและบันทึกยอดจริงของเดือนนั้น'

  return (
    <dialog
      ref={dialogRef}
      className="app-dialog service-plan-financial-dialog"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <header className="app-dialog__header">
        <div>
          <h2 id={titleId}>{title}</h2>
          <p id={descriptionId}>{description}</p>
        </div>
        <button type="button" className="app-dialog__close" aria-label="ปิดหน้าต่าง" onClick={onClose} disabled={pending}>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path d="m6 6 12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </header>

      <form className="app-dialog__body service-plan-financial-dialog__body" onSubmit={isBudget ? onBudgetSubmit : onExpenseSubmit}>
        <div className="service-plan-financial-dialog__context">
          {isBudget ? (
            <>
              <div><span>วงเงินปัจจุบัน</span><strong>{formatBaht(currentBudget)}</strong></div>
              <div><span>ใช้จริง + สำรอง</span><strong>{formatBaht(committedAmount)}</strong></div>
            </>
          ) : (
            <>
              <div><span>ปีงบประมาณ</span><strong>{fiscalYear}</strong></div>
              <div><span>ช่วงแผน</span><strong>{fiscalPeriod.start.slice(0, 7)} – {fiscalPeriod.end.slice(0, 7)}</strong></div>
            </>
          )}
        </div>

        {isBudget ? (
          <div className="service-plan-financial-dialog__fields">
            <label className="field-row" htmlFor={budgetId}>
              <span>วงเงินใหม่ <span className="field-required" aria-hidden="true">*</span></span>
              <input id={budgetId} type="number" inputMode="decimal" min="0.01" step="0.01" value={budget} onChange={(event) => onBudgetChange(event.target.value)} required />
            </label>
            <label className="field-row" htmlFor={budgetReasonId}>
              <span>เหตุผล <span className="field-required" aria-hidden="true">*</span></span>
              <input id={budgetReasonId} value={budgetReason} onChange={(event) => onBudgetReasonChange(event.target.value)} placeholder="เช่น ได้รับจัดสรรเพิ่ม" maxLength={1000} required />
            </label>
          </div>
        ) : (
          <div className="service-plan-financial-dialog__fields">
            <label className="field-row" htmlFor={expenseMonthId}>
              <span>เดือนที่ใช้จ่าย <span className="field-required" aria-hidden="true">*</span></span>
              <select id={expenseMonthId} value={expenseMonth} onChange={(event) => onExpenseMonthChange(event.target.value)} required disabled={expenseMonths.length === 0}>
                {expenseMonths.length === 0 && <option value="">ยังไม่มีเดือนที่ปิดแล้ว</option>}
                {expenseMonths.map((month) => <option key={month} value={month}>{monthName(month)}</option>)}
              </select>
              <small>เลือกได้ตั้งแต่เดือนเริ่มแผนถึงเดือนปัจจุบันในปีงบประมาณ {fiscalYear}</small>
            </label>
            <label className="field-row" htmlFor={expenseAmountId}>
              <span>ยอดใช้จ่าย (บาท) <span className="field-required" aria-hidden="true">*</span></span>
              <input id={expenseAmountId} type="number" inputMode="decimal" min="0.01" step="0.01" value={expenseAmount} onChange={(event) => onExpenseAmountChange(event.target.value)} placeholder="เช่น 111463.20" required />
            </label>
            <label className="field-row" htmlFor={sourceId}>
              <span>เลข PR/PO <span className="field-required" aria-hidden="true">*</span></span>
              <input id={sourceId} value={source} onChange={(event) => onSourceChange(event.target.value)} placeholder="เช่น PR-2569-0001 หรือ PO-0001" maxLength={240} required />
            </label>
            <label className="field-row" htmlFor={noteId}>
              <span>หมายเหตุ <span className="field-optional">ไม่บังคับ</span></span>
              <textarea id={noteId} value={note} onChange={(event) => onNoteChange(event.target.value)} placeholder="รายละเอียดเพิ่มเติม (ถ้ามี)" maxLength={1000} />
            </label>
          </div>
        )}

        {error && <p id={errorId} className="form-error" role="alert">{error}</p>}
        <div className="service-plan-financial-dialog__actions">
          <Button variant="secondary" onClick={onClose} disabled={pending}>ยกเลิก</Button>
          <Button type="submit" disabled={pending || (isBudget ? !budget.trim() || !budgetReason.trim() : !expenseMonth || !expenseReadyForSubmit(expenseAmount, source))}>
            {pending ? 'กำลังบันทึก…' : isBudget ? 'บันทึกวงเงินใหม่' : 'บันทึกค่าใช้จ่าย'}
          </Button>
        </div>
      </form>
    </dialog>
  )
}

function expenseReadyForSubmit(amount: string, source: string) {
  const parsed = Number(amount)
  return Boolean(amount && Number.isFinite(parsed) && parsed > 0 && source.trim())
}
