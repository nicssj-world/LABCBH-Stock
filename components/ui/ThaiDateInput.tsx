'use client'

import { useEffect, useRef, useState, type InputHTMLAttributes, type FocusEvent, type ChangeEvent } from 'react'
import { formatThaiDateInput, parseThaiDateInput } from '@/lib/date/thai'

export interface ThaiDateInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'defaultValue' | 'onChange'> {
  value: string
  onChange: (isoDate: string) => void
}

/** A text date field that displays Buddhist Era dates while emitting ISO dates. */
export function ThaiDateInput({ value, onChange, onBlur, placeholder, ...props }: ThaiDateInputProps) {
  const [displayValue, setDisplayValue] = useState(() => formatThaiDateInput(value))
  const [hasFormatError, setHasFormatError] = useState(false)
  const invalidValueRef = useRef(false)

  useEffect(() => {
    if (invalidValueRef.current && !value) return
    invalidValueRef.current = false
    setHasFormatError(false)
    setDisplayValue(formatThaiDateInput(value))
  }, [value])

  const change = (event: ChangeEvent<HTMLInputElement>) => {
    const nextValue = event.target.value
    setDisplayValue(nextValue)

    const parsed = parseThaiDateInput(nextValue)
    if (parsed) {
      invalidValueRef.current = false
      setHasFormatError(false)
      onChange(parsed)
    } else if (!nextValue.trim()) {
      invalidValueRef.current = false
      setHasFormatError(false)
      onChange('')
    } else {
      // Clear the ISO value while the user is entering an incomplete date so
      // an unparsed value can never submit the previous date by accident.
      invalidValueRef.current = true
      onChange('')
    }
  }

  const blur = (event: FocusEvent<HTMLInputElement>) => {
    const parsed = parseThaiDateInput(displayValue)
    if (parsed) {
      invalidValueRef.current = false
      setHasFormatError(false)
      setDisplayValue(formatThaiDateInput(parsed))
      onChange(parsed)
    } else if (displayValue.trim()) {
      invalidValueRef.current = true
      setHasFormatError(true)
      setDisplayValue('')
      onChange('')
    }

    onBlur?.(event)
  }

  return (
    <>
      <input
        {...props}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={displayValue}
        placeholder={placeholder ?? 'วว/ดด/พ.ศ.'}
        onChange={change}
        onBlur={blur}
        aria-invalid={hasFormatError || props['aria-invalid'] || undefined}
      />
      {hasFormatError && <small className="field-error">กรุณากรอกวันที่เป็น วว/ดด/พ.ศ. เช่น 02/08/2569</small>}
    </>
  )
}
