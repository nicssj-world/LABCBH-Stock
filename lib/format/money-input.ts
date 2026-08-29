import { formatNumberInput, normalizeNumberInput, parseNumberInput } from '@/lib/format/number-input'

export function normalizeMoneyInput(value: string): string {
  return normalizeNumberInput(value, 2)
}

export function formatMoneyInput(value: string | number | null | undefined): string {
  return formatNumberInput(value, 2)
}

export function parseMoneyInput(value: string | number | null | undefined): number | null {
  return parseNumberInput(value, 2)
}
