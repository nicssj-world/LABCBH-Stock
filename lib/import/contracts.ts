import {
  normalizeContractNumber,
  normalizeSheetText,
  toFiniteNumber,
} from './normalize'
import type {
  ImportConflict,
  ImportWarning,
  PlannedContract,
  RawContractRow,
  SourceCoordinate,
} from './types'

export function sourceCoordinateKey(source: SourceCoordinate): string {
  return `${source.spreadsheetId}:${source.tab}:${String(source.row).padStart(8, '0')}`
}

function contractIdentity(row: PlannedContract): string {
  return [
    row.contractNumber.toLocaleLowerCase('th-TH'),
    row.fiscalYear,
    row.vendor.toLocaleLowerCase('th-TH'),
    row.displayName.toLocaleLowerCase('th-TH'),
  ].join('|')
}

export function planContracts(rows: RawContractRow[]): {
  contracts: PlannedContract[]
  conflicts: ImportConflict[]
  warnings: ImportWarning[]
} {
  const contractsByNumber = new Map<string, PlannedContract>()
  const conflicts: ImportConflict[] = []
  const warnings: ImportWarning[] = []

  for (const raw of [...rows].sort((a, b) => sourceCoordinateKey(a.source).localeCompare(sourceCoordinateKey(b.source)))) {
    const contractNumber = normalizeContractNumber(raw.contractNumber)
    const fiscalYear = toFiniteNumber(raw.fiscalYear)
    const displayName = normalizeSheetText(raw.displayName)
    const vendor = normalizeSheetText(raw.vendor)
    const product = normalizeSheetText(raw.product) || displayName
    const startDate = normalizeSheetText(raw.startDate)
    const endDate = normalizeSheetText(raw.endDate)
    const contractType = normalizeSheetText(raw.contractType) || 'specific'

    if (!contractNumber || !fiscalYear || !displayName || !product || !startDate || !endDate) {
      warnings.push({ kind: 'invalid_contract', message: 'ข้อมูลสัญญาไม่ครบ', source: raw.source })
      continue
    }

    const contract: PlannedContract = {
      contractNumber,
      identityKey: '',
      displayName,
      vendor,
      fiscalYear: Math.trunc(fiscalYear),
      contractType,
      product,
      startDate,
      endDate,
      source: raw.source,
    }
    contract.identityKey = contractIdentity(contract)

    const numberKey = contractNumber.toLocaleLowerCase('th-TH')
    const existing = contractsByNumber.get(numberKey)
    if (!existing) {
      contractsByNumber.set(numberKey, contract)
      continue
    }
    if (existing.identityKey !== contract.identityKey) {
      conflicts.push({
        kind: 'contract_identity',
        key: contractNumber,
        canonicalValue: existing.identityKey,
        variantValue: contract.identityKey,
        sources: [existing.source, contract.source],
      })
    }
  }

  return {
    contracts: [...contractsByNumber.values()].sort((a, b) => a.contractNumber.localeCompare(b.contractNumber, 'th-TH')),
    conflicts,
    warnings,
  }
}
