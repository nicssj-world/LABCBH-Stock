import { sourceCoordinateKey } from './contracts'
import { toFiniteNumber } from './normalize'
import type { PlannedLegacyAllocation, RawItemRow } from './types'

export function planLegacyAllocations(
  row: RawItemRow,
  contractNumber: string,
  lsCode: string,
): PlannedLegacyAllocation[] {
  return Object.entries(row.purchaseSequences ?? {})
    .map(([label, rawQuantity]) => {
      const sequenceMatch = label.match(/(\d+)/)
      const quantity = toFiniteNumber(rawQuantity)
      if (!sequenceMatch || quantity === null || quantity <= 0) return null
      return {
        contractNumber,
        lsCode,
        sequence: Number(sequenceMatch[1]),
        quantity,
        sourceIdentity: `${sourceCoordinateKey(row.source)}:${label.normalize('NFKC').trim()}`,
        source: row.source,
      } satisfies PlannedLegacyAllocation
    })
    .filter((row): row is PlannedLegacyAllocation => row !== null)
    .sort((a, b) => a.sequence - b.sequence || a.sourceIdentity.localeCompare(b.sourceIdentity))
}
