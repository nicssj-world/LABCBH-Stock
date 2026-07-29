import { readFile } from 'node:fs/promises'
import { hashReconciliationReport, stableStringify } from '../lib/import/report'
import type { ReconciliationReport } from '../lib/import/types'

interface SavedImportReport {
  reportHash: string
  report: ReconciliationReport
}

async function main() {
  const reportIndex = process.argv.indexOf('--report')
  const reportFile = reportIndex >= 0 ? process.argv[reportIndex + 1] : undefined
  if (!reportFile) throw new Error('--report is required')

  const saved = JSON.parse(await readFile(reportFile, 'utf8')) as SavedImportReport
  const actualHash = hashReconciliationReport(saved.report)
  if (actualHash !== saved.reportHash) throw new Error('reportHash does not match report content')

  console.log(stableStringify({
    reportHash: actualHash,
    counts: saved.report.counts,
    totals: saved.report.totals,
    conflicts: saved.report.conflicts.length,
    warnings: saved.report.warnings.length,
    comparisonWarnings: saved.report.comparisonWarnings,
  }).trimEnd())
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
