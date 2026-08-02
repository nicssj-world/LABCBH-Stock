'use client'

import { useState } from 'react'
import { BUDDHIST_ERA_OFFSET, THAI_MONTHS, THAI_WEEKDAYS_SHORT } from '@/lib/date/thai'

export interface CalendarPickerProps {
  value: string
  onSelect: (isoDate: string) => void
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function partsFromIso(isoDate: string): { year: number; month: number } | null {
  const match = isoDate.slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null
  return { year: Number(match[1]), month: Number(match[2]) }
}

/** A month grid for picking a date by click, alongside ThaiDateInput's typed entry. */
export function CalendarPicker({ value, onSelect }: CalendarPickerProps) {
  const today = new Date()
  const todayIso = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`
  const initial = partsFromIso(value)
  const [viewYear, setViewYear] = useState(initial?.year ?? today.getFullYear())
  const [viewMonth, setViewMonth] = useState(initial?.month ?? today.getMonth() + 1)

  const changeMonth = (delta: number) => {
    const zeroBased = viewMonth - 1 + delta
    setViewYear(viewYear + Math.floor(zeroBased / 12))
    setViewMonth(((zeroBased % 12) + 12) % 12 + 1)
  }

  const firstWeekday = new Date(Date.UTC(viewYear, viewMonth - 1, 1)).getUTCDay()
  const daysInMonth = new Date(Date.UTC(viewYear, viewMonth, 0)).getUTCDate()

  const cells: Array<{ day: number; iso: string } | null> = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, index) => {
      const day = index + 1
      return { day, iso: `${viewYear}-${pad(viewMonth)}-${pad(day)}` }
    }),
  ]

  const yearOptions = Array.from({ length: 21 }, (_, index) => today.getFullYear() + 10 - index)
  if (!yearOptions.includes(viewYear)) yearOptions.push(viewYear)
  yearOptions.sort((a, b) => b - a)

  return (
    <div className="calendar-picker">
      <div className="calendar-picker__header">
        <button type="button" aria-label="เดือนก่อนหน้า" onClick={() => changeMonth(-1)}>‹</button>
        <div className="calendar-picker__jump">
          <select
            aria-label="เลือกเดือน"
            value={viewMonth}
            onChange={(event) => setViewMonth(Number(event.target.value))}
          >
            {THAI_MONTHS.map((label, index) => (
              <option key={label} value={index + 1}>{label}</option>
            ))}
          </select>
          <select
            aria-label="เลือกปี"
            value={viewYear}
            onChange={(event) => setViewYear(Number(event.target.value))}
          >
            {yearOptions.map((year) => (
              <option key={year} value={year}>{year + BUDDHIST_ERA_OFFSET}</option>
            ))}
          </select>
        </div>
        <button type="button" aria-label="เดือนถัดไป" onClick={() => changeMonth(1)}>›</button>
      </div>
      <div className="calendar-picker__weekdays" aria-hidden="true">
        {THAI_WEEKDAYS_SHORT.map((label, index) => <span key={`${label}-${index}`}>{label}</span>)}
      </div>
      <div className="calendar-picker__grid" role="group" aria-label="วันที่ในเดือน">
        {cells.map((cell, index) => cell ? (
          <button
            type="button"
            key={cell.iso}
            className={[
              cell.iso === value ? 'calendar-picker__day--selected' : '',
              cell.iso === todayIso ? 'calendar-picker__day--today' : '',
            ].filter(Boolean).join(' ') || undefined}
            aria-pressed={cell.iso === value}
            onClick={() => onSelect(cell.iso)}
          >
            {cell.day}
          </button>
        ) : <span key={`blank-${index}`} aria-hidden="true" />)}
      </div>
      <button type="button" className="calendar-picker__today" onClick={() => onSelect(todayIso)}>
        วันนี้
      </button>
    </div>
  )
}
