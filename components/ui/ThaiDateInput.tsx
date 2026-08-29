'use client'

import { useEffect, useId, useRef, useState, type InputHTMLAttributes, type FocusEvent, type ChangeEvent } from 'react'
import { formatThaiDateInput, parseThaiDateInput } from '@/lib/date/thai'
import { CalendarPicker } from '@/components/ui/CalendarPicker'

export interface ThaiDateInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'defaultValue' | 'onChange'> {
  value: string
  onChange: (isoDate: string) => void
}

/** A text date field that displays Buddhist Era dates while emitting ISO dates, with a calendar popup as an alternative to typing. */
export function ThaiDateInput({ value, onChange, onBlur, placeholder, ...props }: ThaiDateInputProps) {
  const titleId = useId()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [displayValue, setDisplayValue] = useState(() => formatThaiDateInput(value))
  const [hasFormatError, setHasFormatError] = useState(false)
  const [hasRangeError, setHasRangeError] = useState(false)
  const invalidValueRef = useRef(false)
  const minDate = typeof props.min === 'string' ? props.min : undefined
  const maxDate = typeof props.max === 'string' ? props.max : undefined

  const isWithinRange = (isoDate: string) => (!minDate || isoDate >= minDate) && (!maxDate || isoDate <= maxDate)

  useEffect(() => {
    if (invalidValueRef.current && !value) return
    invalidValueRef.current = false
    setHasFormatError(false)
    setHasRangeError(false)
    setDisplayValue(formatThaiDateInput(value))
  }, [value])

  const change = (event: ChangeEvent<HTMLInputElement>) => {
    const nextValue = event.target.value
    setDisplayValue(nextValue)

    const parsed = parseThaiDateInput(nextValue)
    if (parsed) {
      if (!isWithinRange(parsed)) {
        invalidValueRef.current = true
        setHasFormatError(false)
        setHasRangeError(true)
        onChange('')
        return
      }
      invalidValueRef.current = false
      setHasFormatError(false)
      setHasRangeError(false)
      onChange(parsed)
    } else if (!nextValue.trim()) {
      invalidValueRef.current = false
      setHasFormatError(false)
      setHasRangeError(false)
      onChange('')
    } else {
      // Clear the ISO value while the user is entering an incomplete date so
      // an unparsed value can never submit the previous date by accident.
      invalidValueRef.current = true
      setHasRangeError(false)
      onChange('')
    }
  }

  const blur = (event: FocusEvent<HTMLInputElement>) => {
    const parsed = parseThaiDateInput(displayValue)
    if (parsed) {
      if (!isWithinRange(parsed)) {
        invalidValueRef.current = true
        setHasFormatError(false)
        setHasRangeError(true)
        setDisplayValue('')
        onChange('')
        onBlur?.(event)
        return
      }
      invalidValueRef.current = false
      setHasFormatError(false)
      setHasRangeError(false)
      setDisplayValue(formatThaiDateInput(parsed))
      onChange(parsed)
    } else if (displayValue.trim()) {
      invalidValueRef.current = true
      setHasFormatError(true)
      setHasRangeError(false)
      setDisplayValue('')
      onChange('')
    }

    onBlur?.(event)
  }

  const pick = (isoDate: string) => {
    if (!isWithinRange(isoDate)) return
    invalidValueRef.current = false
    setHasFormatError(false)
    setHasRangeError(false)
    setDisplayValue(formatThaiDateInput(isoDate))
    onChange(isoDate)
    dialogRef.current?.close()
  }

  return (
    <div className="thai-date-input">
      <input
        {...props}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={displayValue}
        placeholder={placeholder ?? 'วว/ดด/พ.ศ.'}
        onChange={change}
        onBlur={blur}
        aria-invalid={hasFormatError || hasRangeError || props['aria-invalid'] || undefined}
      />
      <button
        type="button"
        className="thai-date-input__trigger"
        aria-label="เลือกวันที่จากปฏิทิน"
        disabled={props.disabled}
        onClick={() => dialogRef.current?.showModal()}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3.5" y="5" width="17" height="15" rx="2" />
          <path d="M8 3v4M16 3v4M3.5 9.5h17" />
        </svg>
      </button>
      <dialog
        ref={dialogRef}
        className="app-dialog thai-date-input__dialog"
        aria-labelledby={titleId}
        onCancel={(event) => { event.preventDefault(); dialogRef.current?.close() }}
        onClick={(event) => { if (event.target === event.currentTarget) dialogRef.current?.close() }}
      >
        <header className="app-dialog__header">
          <div><h2 id={titleId}>เลือกวันที่</h2></div>
          <button type="button" className="app-dialog__close" aria-label="ปิดหน้าต่างเลือกวันที่" onClick={() => dialogRef.current?.close()}>×</button>
        </header>
        <div className="app-dialog__body">
          <CalendarPicker value={value} min={minDate} max={maxDate} onSelect={pick} />
        </div>
      </dialog>
      {hasFormatError && <small className="field-error">กรุณากรอกวันที่เป็น วว/ดด/พ.ศ. เช่น 02/08/2569</small>}
      {hasRangeError && <small className="field-error">กรุณาเลือกวันที่ตามช่วงที่กำหนด</small>}
    </div>
  )
}
