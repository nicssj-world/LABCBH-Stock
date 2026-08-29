'use client'

import { forwardRef } from 'react'
import { FormattedNumberInput, type FormattedNumberInputProps } from '@/components/ui/FormattedNumberInput'

export interface QuantityInputProps extends Omit<FormattedNumberInputProps, 'maxFractionDigits'> {
  maxFractionDigits?: number
}

export const QuantityInput = forwardRef<HTMLInputElement, QuantityInputProps>(function QuantityInput(
  { maxFractionDigits = 3, className, ...props },
  ref,
) {
  return (
    <FormattedNumberInput
      {...props}
      ref={ref}
      maxFractionDigits={maxFractionDigits}
      className={['quantity-input', className].filter(Boolean).join(' ')}
    />
  )
})
