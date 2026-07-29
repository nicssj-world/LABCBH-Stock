import type { RawItemRow } from './types'

function normalizeText(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number') return ''
  return String(value).normalize('NFKC').trim().replace(/\s+/g, ' ')
}

export function normalizeLsCode(value: unknown): string {
  const normalized = normalizeText(value).toUpperCase().replace(/[^A-Z0-9]/g, '')
  return /^LS[0-9]+$/.test(normalized) ? normalized : ''
}

export function normalizeContractNumber(value: unknown): string {
  return normalizeText(value)
    .replace(/\s*\/\s*/g, '/')
    .replace(/\s+/g, ' ')
}

export function normalizeSheetText(value: unknown): string {
  return normalizeText(value)
}

export function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'string' && !value.trim()) return null
  const number = typeof value === 'number' ? value : Number(normalizeText(value).replace(/,/g, ''))
  return Number.isFinite(number) ? number : null
}

export function classifySheetRow(
  row: Pick<RawItemRow, 'lsCode' | 'unit'>,
): 'contract_summary' | 'contract_item' | 'ignored' {
  if (normalizeLsCode(row.lsCode)) return 'contract_item'
  if (!normalizeSheetText(row.lsCode) && normalizeSheetText(row.unit) === 'บาท') {
    return 'contract_summary'
  }
  return 'ignored'
}
