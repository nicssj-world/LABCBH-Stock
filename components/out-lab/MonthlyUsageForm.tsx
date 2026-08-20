'use client'

import { useId, useMemo, useState, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { bangkokIsoDate } from '@/lib/date/thai'
import { expenseMonthOptions } from '@/lib/contracts/budget'
import { recordOutLabMonthlyUsage } from '@/lib/out-lab/actions'
import type { OutLabKind, OutLabUsageRecord } from '@/lib/out-lab/types'

const monthLabel = new Intl.DateTimeFormat('th-TH-u-ca-buddhist', {
  year: 'numeric',
  month: 'long',
  timeZone: 'Asia/Bangkok',
})
const money = new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2 })

interface MonthlyUsageFormProps {
  contractId: string
  kind: OutLabKind
  startDate: string
  endDate: string
  remaining: number | null
  entries: OutLabUsageRecord[]
}

/**
 * One figure per month, so this is an upsert rather than an append: choosing a
 * month that already holds a figure loads it and says plainly that saving will
 * replace it. The lease form appends instead, which is why the two are separate
 * components rather than one with a flag.
 */
export function MonthlyUsageForm({
  contractId,
  kind,
  startDate,
  endDate,
  remaining,
  entries,
}: MonthlyUsageFormProps) {
  const router = useRouter()
  const formId = useId()
  const months = useMemo(() => expenseMonthOptions(startDate, endDate), [startDate, endDate])
  const byMonth = useMemo(
    () => new Map(entries.map((entry) => [entry.usageMonth, entry])),
    [entries],
  )

  // Default to last month: a month is billed once it has closed, which is also
  // why the overdue-period chip ignores the current month.
  const defaultMonth = useMemo(() => {
    if (months.length === 0) return ''
    const [year, month] = bangkokIsoDate().split('-').map(Number)
    const previous = new Date(Date.UTC(year, month - 2, 1))
    const previousIso = `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, '0')}-01`
    return months.includes(previousIso) ? previousIso : months[months.length - 1]
  }, [months])

  const [usageMonth, setUsageMonth] = useState(defaultMonth)
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [touchedMonth, setTouchedMonth] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  if (months.length === 0) {
    return <p className="completion-note">สัญญานี้ยังไม่มีช่วงเวลา จึงยังบันทึกยอดรายเดือนไม่ได้</p>
  }

  const existing = byMonth.get(usageMonth)

  const selectMonth = (month: string) => {
    setUsageMonth(month)
    setTouchedMonth(month)
    const current = byMonth.get(month)
    setAmount(current ? String(current.amount) : '')
    setNote(current?.note ?? '')
  }

  const parsedAmount = Number(amount)
  // A contract ceiling is refused by the database; a plan is not. Only warn
  // ahead of a refusal that will actually happen.
  const replacedAmount = existing?.amount ?? 0
  const overRemaining =
    kind === 'contract_ceiling' &&
    remaining !== null &&
    Number.isFinite(parsedAmount) &&
    parsedAmount > remaining + replacedAmount

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    startTransition(async () => {
      try {
        await recordOutLabMonthlyUsage({
          contractId,
          amount: parsedAmount,
          usageMonth,
          note: note.trim() || null,
        })
        setAmount('')
        setNote('')
        setTouchedMonth(null)
        setOpen(false)
        router.refresh()
      } catch (caught) {
        // The RPC message is shown verbatim: it carries the remaining balance
        // as the database saw it, which is the authoritative number.
        setError(caught instanceof Error ? caught.message : 'บันทึกยอดใช้จ่ายไม่สำเร็จ')
      }
    })
  }

  return (
    <section className="expense-entry" aria-labelledby={`${formId}-title`}>
      <button
        type="button"
        className="expense-entry__toggle"
        aria-expanded={open}
        aria-controls={formId}
        onClick={() => {
          if (open) setError(null)
          else if (!touchedMonth) selectMonth(usageMonth)
          setOpen(!open)
        }}
      >
        <span className="expense-entry__glyph" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="20" height="20">
            <path d="M12 5v14m-7-7h14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </span>
        <span className="expense-entry__copy">
          <strong id={`${formId}-title`}>บันทึกยอดใช้จ่ายรายเดือน</strong>
          <small>{open ? 'เลือกเดือนแล้วกรอกยอดของเดือนนั้น' : 'กดเพื่อลงยอดของเดือน'}</small>
        </span>
        <svg
          className={open ? 'expense-entry__chevron expense-entry__chevron--open' : 'expense-entry__chevron'}
          viewBox="0 0 24 24"
          width="20"
          height="20"
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <form id={formId} className="expense-form" onSubmit={submit}>
          <div className="expense-form__primary">
            <label>
              เดือนที่ใช้จ่าย
              <select value={usageMonth} onChange={(event) => selectMonth(event.target.value)} required>
                {months.map((month) => (
                  <option key={month} value={month}>
                    {monthLabel.format(new Date(`${month}T00:00:00+07:00`))}
                    {byMonth.has(month) ? ' · มียอดแล้ว' : ''}
                  </option>
                ))}
              </select>
            </label>
            <label>
              จำนวนเงิน (บาท)
              <input
                type="number"
                inputMode="decimal"
                min="0.01"
                step="0.01"
                required
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder="เช่น 12720.00"
                aria-invalid={overRemaining}
                aria-describedby={overRemaining ? 'out-lab-budget-alert' : undefined}
              />
            </label>
          </div>

          {existing && (
            <p className="form-notice" role="status">
              เดือนนี้มียอด {money.format(existing.amount)} บาทอยู่แล้ว การบันทึกจะแทนที่ยอดเดิม
            </p>
          )}

          {overRemaining && (
            <p id="out-lab-budget-alert" className="expense-form__budget-alert" role="alert">
              จำนวนเงินเกินมูลค่าคงเหลือของสัญญา กรุณาตรวจสอบยอดอีกครั้ง
            </p>
          )}

          <div className="expense-form__secondary">
            <label>
              หมายเหตุ (ถ้ามี)
              <input value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} />
            </label>
          </div>

          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}

          <div className="expense-form__footer">
            <Button type="submit" disabled={isPending || overRemaining}>
              {isPending ? 'กำลังบันทึก…' : existing ? 'แทนที่ยอดของเดือนนี้' : 'บันทึกยอด'}
            </Button>
          </div>
        </form>
      )}
    </section>
  )
}
