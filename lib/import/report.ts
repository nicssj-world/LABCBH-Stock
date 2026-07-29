import { createHash } from 'node:crypto'
import { planContracts, sourceCoordinateKey } from './contracts'
import { planItems, sumContractValue } from './items'
import type {
  ApplyImportOptions,
  ImportBaseline,
  ImportPlan,
  ReconciliationReport,
  SourceCoordinate,
  WorkbookSnapshot,
} from './types'

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sortJson(child)]),
    )
  }
  return value
}

export function stableStringify(value: unknown): string {
  return `${JSON.stringify(sortJson(value), null, 2)}\n`
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  Object.freeze(value)
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
  return value
}

export function buildImportPlan(snapshot: WorkbookSnapshot): ImportPlan {
  const contractPlan = planContracts(snapshot.contracts.rows)
  const knownContracts = new Set(
    contractPlan.contracts.map(contract => contract.contractNumber.toLocaleLowerCase('th-TH')),
  )
  const itemPlan = planItems(snapshot.items.rows, knownContracts)

  return {
    version: 1,
    contracts: contractPlan.contracts,
    contractItems: itemPlan.contractItems,
    inventoryItems: itemPlan.inventoryItems,
    aliases: itemPlan.aliases,
    legacyAllocations: itemPlan.legacyAllocations,
    conflicts: [...contractPlan.conflicts, ...itemPlan.conflicts].sort((a, b) => `${a.key}|${a.kind}`.localeCompare(`${b.key}|${b.kind}`, 'th-TH')),
    warnings: [...contractPlan.warnings, ...itemPlan.warnings].sort((a, b) => sourceCoordinateKey(a.source).localeCompare(sourceCoordinateKey(b.source)) || a.kind.localeCompare(b.kind)),
    counts: {
      contractNumbers: contractPlan.contracts.length,
      itemRows: itemPlan.contractItems.length,
      uniqueLsCodes: itemPlan.inventoryItems.length,
      legacyAllocations: itemPlan.legacyAllocations.length,
    },
  }
}

function uniqueSources(plan: ImportPlan): SourceCoordinate[] {
  const sources = [
    ...plan.contracts.map(row => row.source),
    ...plan.contractItems.map(row => row.source),
    ...plan.aliases.map(row => row.source),
    ...plan.legacyAllocations.map(row => row.source),
    ...plan.warnings.map(row => row.source),
  ]
  return [...new Map(sources.map(source => [sourceCoordinateKey(source), source])).values()].sort(
    (a, b) => sourceCoordinateKey(a).localeCompare(sourceCoordinateKey(b)),
  )
}

export function reconcileImport(
  plan: ImportPlan,
  baseline?: ImportBaseline,
): ReconciliationReport {
  const comparisonWarnings = baseline
    ? (Object.keys(baseline) as (keyof ImportBaseline)[])
        .filter(metric => plan.counts[metric] !== baseline[metric])
        .map(metric => ({ metric, expected: baseline[metric], actual: plan.counts[metric] }))
    : []

  return deepFreeze({
    version: 1,
    counts: { ...plan.counts },
    totals: {
      contractValue: sumContractValue(plan.contractItems),
      legacyAllocatedQuantity: Math.round(
        plan.legacyAllocations.reduce((sum, row) => sum + row.quantity, 0) * 1000,
      ) / 1000,
    },
    conflicts: plan.conflicts.map(row => ({ ...row, sources: row.sources.map(source => ({ ...source })) })),
    aliases: plan.aliases.map(row => ({ ...row, source: { ...row.source } })),
    warnings: plan.warnings.map(row => ({ ...row, source: { ...row.source } })),
    comparisonWarnings,
    sourceCoordinates: uniqueSources(plan).map(source => ({ ...source })),
  })
}

export function hashReconciliationReport(report: ReconciliationReport): string {
  return createHash('sha256').update(stableStringify(report)).digest('hex')
}

export async function applyImportPlan(
  plan: ImportPlan,
  dryRun: boolean,
  options: ApplyImportOptions = {},
) {
  const reportHash = hashReconciliationReport(options.report ?? reconcileImport(plan))
  if (dryRun) return { applied: false as const, reportHash, mode: 'dry-run' as const }

  if (!options.approvedReportHash) throw new Error('approved report hash is required for apply')
  if (options.approvedReportHash !== reportHash) throw new Error('approved report hash does not match this import')
  if (!options.actorId) throw new Error('actor ID is required for apply')
  if (!options.apply) throw new Error('apply adapter is required for apply')

  const result = await options.apply(plan, { actorId: options.actorId, reportHash })
  return { applied: true as const, reportHash, mode: 'apply' as const, importRunId: result.importRunId }
}
