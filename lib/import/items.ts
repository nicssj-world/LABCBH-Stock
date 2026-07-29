import { sourceCoordinateKey } from './contracts'
import { planLegacyAllocations } from './legacy-allocations'
import {
  classifySheetRow,
  normalizeContractNumber,
  normalizeLsCode,
  normalizeSheetText,
  toFiniteNumber,
} from './normalize'
import type {
  ImportConflict,
  ImportWarning,
  PlannedAlias,
  PlannedContractItem,
  PlannedInventoryItem,
  PlannedLegacyAllocation,
  RawItemRow,
} from './types'

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export function planItems(
  rows: RawItemRow[],
  knownContracts: Set<string>,
): {
  contractItems: PlannedContractItem[]
  inventoryItems: PlannedInventoryItem[]
  aliases: PlannedAlias[]
  legacyAllocations: PlannedLegacyAllocation[]
  conflicts: ImportConflict[]
  warnings: ImportWarning[]
} {
  const sortedRows = [...rows].sort((a, b) => sourceCoordinateKey(a.source).localeCompare(sourceCoordinateKey(b.source)))
  const contractItems: PlannedContractItem[] = []
  const inventoryByLs = new Map<string, PlannedInventoryItem>()
  const aliasesByKey = new Map<string, PlannedAlias>()
  const conflictsByKey = new Map<string, ImportConflict>()
  const legacyAllocations: PlannedLegacyAllocation[] = []
  const warnings: ImportWarning[] = []
  const nextLineByContract = new Map<string, number>()

  for (const raw of sortedRows) {
    const classification = classifySheetRow(raw)
    if (classification === 'contract_summary') continue
    if (classification === 'ignored') {
      warnings.push({ kind: 'ignored_row', message: 'แถวไม่ใช่รายการสัญญาหรือรายการคลัง', source: raw.source })
      continue
    }

    const contractNumber = normalizeContractNumber(raw.contractNumber)
    const lsCode = normalizeLsCode(raw.lsCode)
    const name = normalizeSheetText(raw.name)
    const unit = normalizeSheetText(raw.unit)
    const quantity = toFiniteNumber(raw.quantity)
    const unitPrice = toFiniteNumber(raw.unitPrice)

    if (!contractNumber || !lsCode || !name || !unit || quantity === null || quantity <= 0 || unitPrice === null || unitPrice < 0) {
      warnings.push({ kind: 'invalid_item', message: 'ข้อมูลรายการสัญญาไม่ครบหรือจำนวนไม่ถูกต้อง', source: raw.source })
      continue
    }
    if (!knownContracts.has(contractNumber.toLocaleLowerCase('th-TH'))) {
      warnings.push({ kind: 'unmatched_contract', message: `ไม่พบสัญญา ${contractNumber}`, source: raw.source })
      continue
    }

    if (typeof raw.stockOnHand === 'string' && /^#(?:REF|VALUE|N\/A|DIV\/0)!?$/i.test(raw.stockOnHand.trim())) {
      warnings.push({ kind: 'broken_stock_formula', message: 'ไม่นำเข้ายอดคงเหลือจากสูตรที่เสีย', source: raw.source })
    }

    const lineNumber = (nextLineByContract.get(contractNumber) ?? 0) + 1
    nextLineByContract.set(contractNumber, lineNumber)
    contractItems.push({ contractNumber, lineNumber, lsCode, name, unit, quantity, unitPrice, source: raw.source })

    const existing = inventoryByLs.get(lsCode)
    if (!existing) {
      inventoryByLs.set(lsCode, { lsCode, name, unit, defaultUnitPrice: unitPrice, source: raw.source })
    } else {
      for (const variant of [
        { kind: 'name' as const, canonical: existing.name, value: name, conflict: 'name_variant' as const },
        { kind: 'unit' as const, canonical: existing.unit, value: unit, conflict: 'unit_variant' as const },
      ]) {
        if (variant.value === variant.canonical) continue
        const key = `${lsCode}|${variant.kind}|${variant.value}`
        aliasesByKey.set(key, { lsCode, kind: variant.kind, value: variant.value, source: raw.source })
        conflictsByKey.set(key, {
          kind: variant.conflict,
          key: lsCode,
          canonicalValue: variant.canonical,
          variantValue: variant.value,
          sources: [existing.source, raw.source],
        })
      }
    }

    const rawLsCode = normalizeSheetText(raw.lsCode)
    if (rawLsCode !== lsCode) {
      aliasesByKey.set(`${lsCode}|ls_code|${rawLsCode}`, {
        lsCode,
        kind: 'ls_code',
        value: rawLsCode,
        source: raw.source,
      })
    }

    legacyAllocations.push(...planLegacyAllocations(raw, contractNumber, lsCode))
  }

  return {
    contractItems: contractItems.sort((a, b) => a.contractNumber.localeCompare(b.contractNumber, 'th-TH') || a.lineNumber - b.lineNumber),
    inventoryItems: [...inventoryByLs.values()].sort((a, b) => a.lsCode.localeCompare(b.lsCode)),
    aliases: [...aliasesByKey.values()].sort((a, b) => `${a.lsCode}|${a.kind}|${a.value}`.localeCompare(`${b.lsCode}|${b.kind}|${b.value}`, 'th-TH')),
    legacyAllocations: legacyAllocations.sort((a, b) => a.sourceIdentity.localeCompare(b.sourceIdentity, 'th-TH')),
    conflicts: [...conflictsByKey.values()].sort((a, b) => `${a.key}|${a.kind}|${a.variantValue}`.localeCompare(`${b.key}|${b.kind}|${b.variantValue}`, 'th-TH')),
    warnings: warnings.sort((a, b) => sourceCoordinateKey(a.source).localeCompare(sourceCoordinateKey(b.source)) || a.kind.localeCompare(b.kind)),
  }
}

export function sumContractValue(items: PlannedContractItem[]): number {
  return roundMoney(items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0))
}
