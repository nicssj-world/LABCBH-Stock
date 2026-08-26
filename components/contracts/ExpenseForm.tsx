'use client'

import { useId, useMemo, useState, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { ThaiDateInput } from '@/components/ui/ThaiDateInput'
import { bangkokIsoDate } from '@/lib/date/thai'
import { recordContractExpense } from '@/lib/contracts/budget-actions'
import { expenseMonthOptions } from '@/lib/contracts/budget'

const monthLabel = new Intl.DateTimeFormat('th-TH-u-ca-buddhist', { year: 'numeric', month: 'long', timeZone: 'Asia/Bangkok' })
const money = new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2 })

function todayIso() {
  return bangkokIsoDate()
}

interface ExpenseFormProps {
  contractId: number
  startDate: string | null
  endDate: string | null
  remaining: number | null
}

export function ExpenseForm({ contractId, startDate, endDate, remaining }: ExpenseFormProps) {
  const router = useRouter()
  const formId = useId()
  const months = useMemo(() => expenseMonthOptions(startDate, endDate), [startDate, endDate])

  // Default to last month (expenses are usually logged after the month
  // closes) when the contract covers it, otherwise the closest month it
  // does cover, so the common case needs no thought.
  const defaultMonth = useMemo(() => {
    if (months.length === 0) return ''
    const [year, month] = bangkokIsoDate().split('-').map(Number)
    const previous = new Date(Date.UTC(year, month - 2, 1))
    const previousIso = `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, '0')}-01`
    return months.includes(previousIso) ? previousIso : months[months.length - 1]
  }, [months])

  const [usageMonth, setUsageMonth] = useState(defaultMonth)
  const [amount, setAmount] = useState('')
  const [usageDate, setUsageDate] = useState(todayIso())
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  if (months.length === 0) {
    return (
      <p className="completion-note">
        สัญญานี้ยังไม่มีช่วงเวลาเริ่ม–สิ้นสุด จึงยังบันทึกค่าใช้จ่ายรายเดือนไม่ได้
      </p>
    )
  }

  const parsedAmount = Number(amount)
  const overRemaining =
    remaining !== null && Number.isFinite(parsedAmount) && parsedAmount > remaining

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    startTransition(async () => {
      try {
        await recordContractExpense({
          contractId,
          amount: parsedAmount,
          usageMonth,
          usageDate: usageDate || null,
          note: note.trim() || null,
        })
        setAmount('')
        setNote('')
        setOpen(false)
        router.refresh()
      } catch (caught) {
        // The RPC message is shown verbatim: it carries the remaining balance
        // as the database saw it, which is the authoritative number.
        setError(caught instanceof Error ? caught.message : 'บันทึกค่าใช้จ่ายไม่สำเร็จ')
      }
    })
  }

  return (
    <section className="expense-entry expense-entry--contract" aria-labelledby={`${formId}-title`}>
      <button
        type="button"
        className="expense-entry__toggle"
        aria-expanded={open}
        aria-controls={formId}
        onClick={() => {
          if (open) setError(null)
          setOpen(!open)
        }}
      >
        <span className="expense-entry__glyph" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="20" height="20">
            <path d="M12 5v14m-7-7h14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </span>
        <span className="expense-entry__copy">
          <strong id={`${formId}-title`}>บันทึกค่าใช้จ่าย</strong>
          <small>{open ? 'กรอกข้อมูลและบันทึกรายการใหม่' : 'กดเพื่อเพิ่มยอดใช้จ่ายประจำเดือน'}</small>
        </span>
        <svg className={open ? 'expense-entry__chevron expense-entry__chevron--open' : 'expense-entry__chevron'} viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
      <form id={formId} className="expense-form" onSubmit={submit}>
      <div className="expense-form__primary">
        <label>
          <span>เดือนที่ใช้จ่าย <span className="field-required" aria-hidden="true">*</span></span>
          <select value={usageMonth} onChange={(event) => setUsageMonth(event.target.value)} required>
            {months.map((month) => (
              <option key={month} value={month}>
                {monthLabel.format(new Date(`${month}T00:00:00+07:00`))}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>จำนวนเงิน (บาท) <span className="field-required" aria-hidden="true">*</span></span>
          <input
            type="number"
            inputMode="decimal"
            min="0.01"
            step="0.01"
            required
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder="เช่น 111463.20"
            aria-invalid={overRemaining}
            aria-describedby={overRemaining ? 'expense-budget-alert' : remaining !== null ? 'expense-remaining-hint' : undefined}
          />
          {remaining !== null && !overRemaining && (
            <small id="expense-remaining-hint" className="expense-form__remaining-hint">
              บันทึกได้สูงสุด {money.format(remaining)} บาท
            </small>
          )}
        </label>
      </div>

      {overRemaining && (
        <p id="expense-budget-alert" className="expense-form__budget-alert" role="alert">
          จำนวนเงินเกินงบคงเหลือ {money.format(remaining!)} บาท กรุณาตรวจสอบยอดอีกครั้ง
        </p>
      )}

      <div className="expense-form__secondary">
        <label>
          วันที่บันทึก
          <ThaiDateInput value={usageDate} onChange={setUsageDate} />
        </label>
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
          {isPending ? 'กำลังบันทึก…' : 'บันทึกค่าใช้จ่าย'}
        </Button>
      </div>
      </form>
      )}
    </section>
  )
}
