import { createHash } from 'node:crypto'
import { parse } from 'csv-parse/sync'
import { normalizeLsCode, normalizeSheetText, toFiniteNumber } from './normalize'
import { stableStringify } from './report'

interface RawOpeningCountRow {
  ls_code?: string
  lot_number?: string
  expiry_date?: string
  quantity?: string
  storage_location?: string
  count_date?: string
  approver_id?: string
}

export interface OpeningCountRow {
  lsCode: string
  lotNumber: string
  expiryDate: string | null
  quantity: number
  storageLocation: string | null
  sourceLine: number
}

export interface OpeningCountPlan {
  version: 1
  countDate: string
  approverId: string
  rows: OpeningCountRow[]
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function parseOpeningCountCsv(csv: string): RawOpeningCountRow[] {
  return parse(csv, {
    columns: header => header.map((value: string) => value.trim().toLocaleLowerCase('en-US')),
    bom: true,
    skip_empty_lines: true,
    trim: true,
  }) as RawOpeningCountRow[]
}

export function buildOpeningCountPlan(rawRows: RawOpeningCountRow[]): OpeningCountPlan {
  if (rawRows.length === 0) throw new Error('opening count CSV has no rows')
  const countDates = new Set(rawRows.map(row => normalizeSheetText(row.count_date)))
  const approverIds = new Set(rawRows.map(row => normalizeSheetText(row.approver_id)))
  if (countDates.size !== 1 || !DATE_PATTERN.test([...countDates][0] ?? '')) {
    throw new Error('opening count date must be one ISO date for the whole file')
  }
  if (approverIds.size !== 1 || !UUID_PATTERN.test([...approverIds][0] ?? '')) {
    throw new Error('opening count approver ID must be one UUID for the whole file')
  }

  const rows = rawRows.map((raw, index) => {
    const lsCode = normalizeLsCode(raw.ls_code)
    const lotNumber = normalizeSheetText(raw.lot_number)
    const expiryDate = normalizeSheetText(raw.expiry_date) || null
    const quantity = toFiniteNumber(raw.quantity)
    if (!lsCode || !lotNumber) throw new Error(`opening count identity is invalid at line ${index + 2}`)
    if (expiryDate && !DATE_PATTERN.test(expiryDate)) {
      throw new Error(`opening count expiry date is invalid at line ${index + 2}`)
    }
    if (quantity === null || quantity <= 0) {
      throw new Error(`opening count quantity must be positive at line ${index + 2}`)
    }
    return {
      lsCode,
      lotNumber,
      expiryDate,
      quantity,
      storageLocation: normalizeSheetText(raw.storage_location) || null,
      sourceLine: index + 2,
    }
  })

  const identities = new Set<string>()
  for (const row of rows) {
    const identity = `${row.lsCode}|${row.lotNumber}`
    if (identities.has(identity)) throw new Error(`duplicate opening count lot: ${identity}`)
    identities.add(identity)
  }

  return {
    version: 1,
    countDate: [...countDates][0]!,
    approverId: [...approverIds][0]!,
    rows: rows.sort((a, b) => `${a.lsCode}|${a.lotNumber}`.localeCompare(`${b.lsCode}|${b.lotNumber}`)),
  }
}

export function hashOpeningCountPlan(plan: OpeningCountPlan): string {
  return createHash('sha256').update(stableStringify(plan)).digest('hex')
}
