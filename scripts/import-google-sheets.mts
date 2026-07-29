import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'
import { readWorkbookFile } from '../lib/import/files'
import {
  buildOpeningCountPlan,
  hashOpeningCountPlan,
  parseOpeningCountCsv,
} from '../lib/import/opening-count'
import {
  applyImportPlan,
  buildImportPlan,
  hashReconciliationReport,
  reconcileImport,
  stableStringify,
} from '../lib/import/report'

const OBSERVED_BASELINE = {
  contractNumbers: 74,
  itemRows: 289,
  uniqueLsCodes: 185,
} as const

function parseArgs(values: string[]) {
  const flags = new Map<string, string | true>()
  for (let index = 0; index < values.length; index += 1) {
    const flag = values[index]
    if (!flag?.startsWith('--')) throw new Error(`unknown argument: ${flag}`)
    const next = values[index + 1]
    if (!next || next.startsWith('--')) {
      flags.set(flag, true)
    } else {
      flags.set(flag, next)
      index += 1
    }
  }
  return flags
}

function required(flags: Map<string, string | true>, name: string): string {
  const value = flags.get(name)
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required`)
  return value
}

function optional(flags: Map<string, string | true>, name: string): string | undefined {
  const value = flags.get(name)
  return typeof value === 'string' && value.trim() ? value : undefined
}

async function main() {
  const flags = parseArgs(process.argv.slice(2))
  const applyMode = flags.has('--apply')
  if (applyMode && flags.has('--dry-run')) throw new Error('choose either --dry-run or --apply')

  const contractsFile = required(flags, '--contracts-file')
  const itemsFile = required(flags, '--items-file')
  const outputFile = optional(flags, '--output') ?? 'import-report.json'

  const contracts = await readWorkbookFile(contractsFile, 'contracts', {
    sheet: optional(flags, '--contracts-tab') ?? 1,
    spreadsheetId: optional(flags, '--contracts-spreadsheet-id'),
  })
  const items = await readWorkbookFile(itemsFile, 'items', {
    sheet: optional(flags, '--items-tab') ?? 1,
    spreadsheetId: optional(flags, '--items-spreadsheet-id'),
  })

  const plan = buildImportPlan({ contracts, items })
  const report = reconcileImport(plan, OBSERVED_BASELINE)
  const reportHash = hashReconciliationReport(report)
  const openingCountFile = optional(flags, '--opening-count-file')
  const openingCountPlan = openingCountFile
    ? buildOpeningCountPlan(parseOpeningCountCsv(await readFile(openingCountFile, 'utf8')))
    : null
  const openingCountHash = openingCountPlan ? hashOpeningCountPlan(openingCountPlan) : null

  await writeFile(
    outputFile,
    stableStringify({
      reportHash,
      report,
      plan,
      openingCount: openingCountPlan
        ? { reportHash: openingCountHash, plan: openingCountPlan }
        : null,
    }),
    { encoding: 'utf8', flag: 'wx' },
  )

  if (!applyMode) {
    console.log(`dry-run report: ${outputFile}`)
    console.log(`approved hash: ${reportHash}`)
    if (openingCountHash) console.log(`opening-count hash: ${openingCountHash}`)
    return
  }

  const approvedReportHash = required(flags, '--approved-hash')
  const actorId = required(flags, '--actor-id')
  if (existsSync('.env.local')) process.loadEnvFile('.env.local')
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) throw new Error('Supabase server environment is incomplete')

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const result = await applyImportPlan(plan, false, {
    approvedReportHash,
    actorId,
    report,
    apply: async (approvedPlan, context) => {
      const response = await admin.rpc('apply_lab_stock_import', {
        p_plan: approvedPlan,
        p_reconciliation_report: report,
        p_report_hash: context.reportHash,
        p_actor_id: context.actorId,
      })
      if (response.error) throw new Error(`apply import failed: ${response.error.message}`)
      if (typeof response.data !== 'string') throw new Error('apply import returned no run ID')
      return { importRunId: response.data }
    },
  })
  console.log(`import run: ${result.importRunId}`)

  if (openingCountPlan && openingCountHash) {
    const approvedOpeningHash = required(flags, '--approved-opening-count-hash')
    if (approvedOpeningHash !== openingCountHash) {
      throw new Error('approved opening-count hash does not match this file')
    }
    if (openingCountPlan.approverId !== actorId) {
      throw new Error('opening-count approver must match --actor-id')
    }
    const response = await admin.rpc('apply_lab_stock_opening_counts', {
      p_plan: openingCountPlan,
      p_report_hash: openingCountHash,
      p_actor_id: actorId,
    })
    if (response.error) throw new Error(`apply opening count failed: ${response.error.message}`)
    console.log(`opening-count batch: ${String(response.data)}`)
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
