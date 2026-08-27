import type { CSSProperties } from 'react'
import type { ExpenseMonthlySeriesEntry } from '@/lib/contracts/budget'

const money = new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB', minimumFractionDigits: 0 })
const monthLabel = new Intl.DateTimeFormat('th-TH-u-ca-buddhist', { month: 'short', timeZone: 'Asia/Bangkok' })
const fullMonthLabel = new Intl.DateTimeFormat('th-TH-u-ca-buddhist', { year: 'numeric', month: 'long', timeZone: 'Asia/Bangkok' })

interface ExpenseMonthlyChartProps {
  series: ExpenseMonthlySeriesEntry[]
  title?: string
  summaryLabel?: string
  legendLabel?: string
  emptyMessage?: string
}

/**
 * A small dependency-free bar chart. The ledger table remains directly below
 * it for exact values, while every bar carries its own text alternative.
 */
export function ExpenseMonthlyChart({
  series,
  title = 'การใช้จ่ายตั้งแต่เริ่มสัญญา',
  summaryLabel = 'รวม',
  legendLabel = 'ยอดใช้จ่ายต่อเดือน',
  emptyMessage = 'ยังไม่มีช่วงเวลาสำหรับแสดงกราฟรายเดือน',
}: ExpenseMonthlyChartProps) {
  const maximum = Math.max(...series.map((entry) => entry.amount), 0)
  const total = series.reduce((sum, entry) => sum + entry.amount, 0)

  if (series.length === 0) {
    return <p className="expense-monthly-chart__empty">{emptyMessage}</p>
  }

  return (
    <figure className="expense-monthly-chart" aria-labelledby="expense-monthly-chart-title">
      <div className="expense-monthly-chart__heading">
        <div>
          <h3 id="expense-monthly-chart-title">{title}</h3>
          <p>{series.length} เดือน · {summaryLabel} {money.format(total)}</p>
        </div>
        <span className="expense-monthly-chart__legend"><i aria-hidden="true" />{legendLabel}</span>
      </div>

      <ol
        className="expense-monthly-chart__bars"
        style={{ '--expense-bar-count': series.length } as CSSProperties}
      >
        {series.map((entry) => {
          const height = entry.amount === 0 || maximum === 0
            ? '3px'
            : `${Math.max((entry.amount / maximum) * 100, 8)}%`
          const month = new Date(`${entry.month}T00:00:00+07:00`)
          const label = fullMonthLabel.format(month)
          const value = money.format(entry.amount)

          return (
            <li key={entry.month} aria-label={`${label}: ${value}`}>
              <span className="expense-monthly-chart__value" aria-hidden="true">
                {entry.amount > 0 ? money.format(entry.amount) : '—'}
              </span>
              <span
                className="expense-monthly-chart__bar"
                style={{ '--expense-bar-height': height } as CSSProperties}
                title={`${label}: ${value}`}
              />
              <span className="expense-monthly-chart__month" aria-hidden="true">{monthLabel.format(month)}</span>
            </li>
          )
        })}
      </ol>
    </figure>
  )
}
