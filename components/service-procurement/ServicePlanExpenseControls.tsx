'use client'

import { useId, useRef, useState, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { reviseServicePlanBudget } from '@/lib/service-procurement/actions'
import type { ServicePlanRecord } from '@/lib/service-procurement/types'
import { formatBaht } from '@/lib/service-procurement/presenter'

interface ServicePlanExpenseControlsProps {
  plan: ServicePlanRecord
  canManage: boolean
  /** Kept as a named prop so existing callers remain source-compatible. */
  mode?: 'budget'
}

/**
 * The plan page intentionally has no expense-entry control. Actual service
 * expenses are entered on a PR and posted to the plan only by Close PO. This
 * component therefore exposes only the existing budget-revision action.
 */
export function ServicePlanExpenseControls({ plan, canManage }: ServicePlanExpenseControlsProps) {
  const router = useRouter()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const idPrefix = useId()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [budget, setBudget] = useState(String(plan.budget))
  const [reason, setReason] = useState('')

  if (!canManage) return null

  function closeDialog() {
    dialogRef.current?.close()
    setError(null)
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const parsedBudget = Number(budget)
    if (!Number.isFinite(parsedBudget) || parsedBudget <= 0 || !reason.trim()) {
      setError('กรุณาระบุวงเงินใหม่และเหตุผล')
      return
    }
    setError(null)
    startTransition(async () => {
      try {
        await reviseServicePlanBudget({ planId: plan.id, budget: parsedBudget, reason: reason.trim() })
        closeDialog()
        router.refresh()
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'ปรับวงเงินแผนไม่สำเร็จ')
      }
    })
  }

  const titleId = `${idPrefix}-title`
  const descriptionId = `${idPrefix}-description`
  const budgetId = `${idPrefix}-budget`
  const reasonId = `${idPrefix}-reason`
  const errorId = `${idPrefix}-error`

  return (
    <>
      <Button
        variant="secondary"
        className="service-plan-header-action"
        aria-haspopup="dialog"
        onClick={() => {
          setError(null)
          if (!dialogRef.current?.open) dialogRef.current?.showModal()
        }}
      >
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <path d="M4 7.5h16M6.5 4v16M17.5 4v16M4 16.5h16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
        ปรับวงเงินแผน
      </Button>

      <dialog
        ref={dialogRef}
        className="app-dialog service-plan-financial-dialog"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onCancel={closeDialog}
        onClick={(event) => {
          if (event.target === event.currentTarget) closeDialog()
        }}
      >
        <header className="app-dialog__header">
          <div>
            <h2 id={titleId}>ปรับวงเงินแผน</h2>
            <p id={descriptionId}>ปรับวงเงินตั้งต้นของแผน โดยไม่บันทึกค่าใช้จ่ายที่หน้านี้</p>
          </div>
          <button type="button" className="app-dialog__close" aria-label="ปิดหน้าต่าง" onClick={closeDialog} disabled={pending}>
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path d="m6 6 12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <form className="app-dialog__body service-plan-financial-dialog__body" onSubmit={submit}>
          <div className="service-plan-financial-dialog__context">
            <div><span>วงเงินปัจจุบัน</span><strong>{formatBaht(plan.budget)}</strong></div>
            <div><span>ใช้จริง + สำรอง</span><strong>{formatBaht(plan.balance.spent + plan.balance.reserved)}</strong></div>
          </div>
          <div className="service-plan-financial-dialog__fields">
            <label className="field-row" htmlFor={budgetId}>
              <span>วงเงินใหม่ <span className="field-required" aria-hidden="true">*</span></span>
              <input id={budgetId} type="number" inputMode="decimal" min="0.01" step="0.01" value={budget} onChange={(event) => setBudget(event.target.value)} required />
            </label>
            <label className="field-row" htmlFor={reasonId}>
              <span>เหตุผล <span className="field-required" aria-hidden="true">*</span></span>
              <input id={reasonId} value={reason} onChange={(event) => setReason(event.target.value)} maxLength={1000} required />
            </label>
          </div>
          {error && <p id={errorId} className="form-error" role="alert">{error}</p>}
          <div className="service-plan-financial-dialog__actions">
            <Button type="button" variant="secondary" onClick={closeDialog} disabled={pending}>ยกเลิก</Button>
            <Button type="submit" disabled={pending || !budget.trim() || !reason.trim()}>{pending ? 'กำลังบันทึก…' : 'บันทึกวงเงินใหม่'}</Button>
          </div>
        </form>
      </dialog>
    </>
  )
}
