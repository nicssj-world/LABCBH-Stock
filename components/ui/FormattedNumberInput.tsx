'use client'

import { forwardRef, useEffect, useState, type ChangeEvent, type InputHTMLAttributes } from 'react'
import { formatNumberInput, normalizeNumberInput } from '@/lib/format/number-input'

export interface FormattedNumberInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'defaultValue' | 'onChange' | 'inputMode'> {
  value?: string | number | null
  onValueChange: (value: string) => void
  maxFractionDigits?: number
}

/**
 * A text input is intentional here: native number inputs reject the comma
 * characters users need to see. The parent keeps the unformatted draft, so
 * existing numeric validation and server actions remain unchanged.
 */
export const FormattedNumberInput = forwardRef<HTMLInputElement, FormattedNumberInputProps>(function FormattedNumberInput(
  { value = '', onValueChange, maxFractionDigits = 3, className, ...props },
  ref,
) {
  const fractionDigits = Math.max(0, Math.floor(maxFractionDigits))
  const formattedValue = formatNumberInput(value, fractionDigits)
  const [displayValue, setDisplayValue] = useState(formattedValue)

  useEffect(() => {
    setDisplayValue(formattedValue)
  }, [formattedValue])

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget
    const caretPosition = input.selectionStart ?? input.value.length
    const rawBeforeCaret = normalizeNumberInput(input.value.slice(0, caretPosition), fractionDigits)
    const rawValue = normalizeNumberInput(input.value, fractionDigits)
    const nextDisplayValue = formatNumberInput(rawValue, fractionDigits)
    const nextCaretPosition = formatNumberInput(rawBeforeCaret, fractionDigits).length

    setDisplayValue(nextDisplayValue)
    onValueChange(rawValue)

    requestAnimationFrame(() => {
      if (document.activeElement === input) input.setSelectionRange(nextCaretPosition, nextCaretPosition)
    })
  }

  return (
    <input
      {...props}
      ref={ref}
      type="text"
      inputMode="decimal"
      value={displayValue}
      onChange={handleChange}
      className={['formatted-number-input', className].filter(Boolean).join(' ')}
    />
  )
})
