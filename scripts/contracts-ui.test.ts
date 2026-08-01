import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(path, 'utf8')

const contractRoutes = [
  'app/(protected)/contracts/page.tsx',
  'app/(protected)/contracts/new/page.tsx',
  'app/(protected)/contracts/[id]/page.tsx',
  'app/(protected)/contracts/[id]/edit/page.tsx',
]

for (const route of contractRoutes) {
  assert.ok(read(route).length > 0, `${route} must exist`)
}

const listPage = read(contractRoutes[0])
assert.match(listPage, /searchParams:\s*Promise</, 'Next 16 searchParams must be awaited')
assert.match(listPage, /listContracts\(/, 'contract list must read on the server')
assert.match(listPage, /ปีงบประมาณ/, 'contract list must group by fiscal year')

const detailPage = read(contractRoutes[2])
assert.match(detailPage, /params:\s*Promise</, 'Next 16 detail params must be awaited')
assert.match(detailPage, /StageTimeline/, 'detail must show six-step history')
assert.match(detailPage, /StageAdvanceControl/, 'detail must expose confirmed stage advance')
assert.match(detailPage, /contract\.procurementStage\s*===\s*['"]contract_started['"]/, 'started contracts must use a dedicated completed state')
assert.match(detailPage, /isContractStarted\s*\?\s*\(/, 'started contracts must branch to collapsed history')
assert.match(detailPage, /!isContractStarted\s*&&[\s\S]*StageAdvanceControl/, 'started contracts must not render the next action')
assert.match(detailPage, /ArchiveContractControl/, 'detail must expose reasoned archive')

const historyDisclosure = read('components/contracts/StageHistoryDisclosure.tsx')
assert.match(historyDisclosure, /^['"]use client['"]/m, 'history disclosure must be an interactive client boundary')
assert.match(historyDisclosure, /aria-expanded=\{open\}/, 'history disclosure must expose its expanded state')
assert.match(historyDisclosure, /aria-controls=\{historyId\}/, 'history disclosure must connect the button to its content')
assert.match(historyDisclosure, /ดูประวัติขั้นตอนสัญญา/, 'collapsed history must have a clear Thai action label')
assert.match(historyDisclosure, /ซ่อนประวัติขั้นตอนสัญญา/, 'expanded history must have a clear Thai action label')

const form = read('components/contracts/ContractForm.tsx')
assert.match(form, /^['"]use client['"]/m, 'only the interactive form is a client boundary')
assert.match(form, /createContract|updateContract/, 'form must call typed Server Actions')
assert.match(form, /localStorage/, 'form must autosave a local draft')
assert.match(form, /beforeunload/, 'form must warn before leaving an unsaved draft')
assert.doesNotMatch(form, /createBrowserClient|supabase\.from/, 'browser form must not mutate Supabase')

const itemsEditor = read('components/contracts/ContractItemsEditor.tsx')
assert.match(itemsEditor, /ยอดรวมทั้งสัญญา/, 'item editor must expose a grand total')
assert.match(itemsEditor, /item\.id/, 'edit rows must preserve stable item IDs')

const table = read('components/contracts/ContractTable.tsx')
assert.match(table, /contract-table--desktop/, 'desktop table variant must exist')
assert.match(table, /contract-task-cards/, 'mobile task-card variant must exist')

const dashboardPage = read('app/(protected)/dashboard/page.tsx')
assert.match(dashboardPage, /getExecutiveDashboard/, 'dashboard must use a real SSR\/RLS read boundary')
assert.match(dashboardPage, /รายการที่ต้องเฝ้าระวัง/, 'Composition C must lead with a watchlist')
assert.match(dashboardPage, /มูลค่าคงเหลือในสัญญา/, 'dashboard must show remaining contract value')
assert.doesNotMatch(dashboardPage, /minimum stock/i, 'stock-ledger alert stays out until Milestone 4')

const dashboardData = read('lib/dashboard/contracts.ts')
assert.match(dashboardData, /quantity\s*-\s*allocatedQuantity/, 'remaining quantity must use the allocation ledger')
assert.match(dashboardData, /remainingPercent\s*<\s*30/, 'watchlist threshold must be below 30%')
assert.match(dashboardData, /createClient/, 'dashboard reads must use authenticated SSR Supabase')
assert.doesNotMatch(dashboardData, /supabaseAdmin/, 'dashboard reads must stay under RLS')

console.log('contract UI and executive dashboard contract ok')
