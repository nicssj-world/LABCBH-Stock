function decimalDigits(maxFractionDigits: number): number {
  return Math.max(0, Math.floor(maxFractionDigits))
}

/** Keep a numeric draft safe to display while preserving an unfinished decimal. */
export function normalizeNumberInput(value: string, maxFractionDigits = 3): string {
  const maxDigits = decimalDigits(maxFractionDigits)
  const clean = value.replace(/[^\d.]/g, '')
  const decimalIndex = clean.indexOf('.')
  if (decimalIndex === -1) return clean

  const integerPart = clean.slice(0, decimalIndex)
  if (maxDigits === 0) return integerPart

  const fractionPart = clean.slice(decimalIndex + 1).replace(/\./g, '').slice(0, maxDigits)
  return `${integerPart}.${fractionPart}`
}

function groupInteger(value: string): string {
  const integer = value.replace(/^0+(?=\d)/, '') || '0'
  return integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function numberSource(value: string | number): string {
  if (typeof value === 'number') return value.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 20 })
  return value
}

/** Format a numeric input for humans without changing the value sent to actions. */
export function formatNumberInput(value: string | number | null | undefined, maxFractionDigits = 3): string {
  if (value === null || value === undefined || value === '') return ''

  const raw = normalizeNumberInput(numberSource(value), maxFractionDigits)
  if (!raw) return ''

  const decimalIndex = raw.indexOf('.')
  if (decimalIndex === -1) return groupInteger(raw)

  return `${groupInteger(raw.slice(0, decimalIndex))}.${raw.slice(decimalIndex + 1)}`
}

/** Convert a formatted draft to the numeric value expected by validation/actions. */
export function parseNumberInput(value: string | number | null | undefined, maxFractionDigits = 3): number | null {
  if (value === null || value === undefined || value === '') return null

  const normalized = normalizeNumberInput(numberSource(value), maxFractionDigits)
  if (!normalized || normalized === '.') return null

  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}
