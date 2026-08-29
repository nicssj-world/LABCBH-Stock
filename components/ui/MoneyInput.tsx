'use client'

import { forwardRef } from 'react'
import { FormattedNumberInput, type FormattedNumberInputProps } from '@/components/ui/FormattedNumberInput'

export type MoneyInputProps = Omit<FormattedNumberInputProps, 'maxFractionDigits'>

export const MoneyInput = forwardRef<HTMLInputElement, MoneyInputProps>(function MoneyInput(
  { className, ...props },
  ref,
) {
  return <FormattedNumberInput {...props} ref={ref} maxFractionDigits={2} className={['money-input', className].filter(Boolean).join(' ')} />
})
