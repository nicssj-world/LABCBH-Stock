'use client'

import { useMemo, useState, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { recordContractExpense } from '@/lib/contracts/budget-actions'
import { expenseMonthOptions } from '@/lib/contracts/budget'

const monthLabel = new Intl.DateTimeFormat('th-TH', { year: 'numeric', month: 'long' })
const money = new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2 })

function todayIso() {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

interface ExpenseFormProps {
  contractId: number
  startDate: string | null
  endDate: string | null
  remaining: number | null
}

export function ExpenseForm({ contractId, startDate, endDate, remaining }: ExpenseFormProps) {
  const router = useRouter()
  const months = useMemo(() => expenseMonthOptions(startDate, endDate), [startDate, endDate])

  // Default to the current month when the contract covers it, otherwise the
  // closest month it does cover, so the common case needs no thought.
  const defaultMonth = useMemo(() => {
    if (months.length === 0) return ''
    const current = `${todayIso().slice(0, 7)}-01`
    return months.includes(current) ? current : months[months.length - 1]
  }, [months])

  const [usageMonth, setUsageMonth] = useState(defaultMonth)
  const [amount, setAmount] = useState('')
  const [usageDate, setUsageDate] = useState(todayIso())
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
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
        router.refresh()
      } catch (caught) {
        // The RPC message is shown verbatim: it carries the remaining balance
        // as the database saw it, which is the authoritative number.
        setError(caught instanceof Error ? caught.message : 'บันทึกค่าใช้จ่ายไม่สำเร็จ')
      }
    })
  }

  return (
    <form className="expense-form" onSubmit={submit}>
      <div className="expense-form__primary">
        <label>
          เดือนที่ใช้จ่าย
          <select value={usageMonth} onChange={(event) => setUsageMonth(event.target.value)} required>
            {months.map((month) => (
              <option key={month} value={month}>
                {monthLabel.format(new Date(`${month}T00:00:00+07:00`))}
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
          <input type="date" value={usageDate} onChange={(event) => setUsageDate(event.target.value)} />
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
  )
}
