import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')

for (const route of [
  'app/(protected)/out-lab/page.tsx',
  'app/(protected)/out-lab/new/page.tsx',
  'app/(protected)/out-lab/[id]/page.tsx',
  'app/(protected)/out-lab/[id]/edit/page.tsx',
  'app/api/out-lab/[id]/file/route.ts',
]) {
  assert.ok(existsSync(join(process.cwd(), route)), `${route} must exist`)
}

const shell = read('components/ui/AppShell.tsx')
const css = read('app/globals.css')

// The register needs its own place in the rail, with a tone that is not shared
// with another module — the tone is a location cue, so a duplicate would read
// as the same destination.
assert.match(shell, /\{ href: '\/out-lab', label: 'Out Lab', icon: 'outlab', tone: 'teal' \}/)
assert.match(shell, /type BenchIconName =[^\n]*'outlab'/)
assert.match(shell, /type NavTone =[^\n]*'teal'/)
assert.match(shell, /^\s+outlab: <>/m, 'the nav icon needs a glyph, not just a name')
assert.match(css, /\.bench-nav__icon\[data-nav-tone="teal"\]/)
assert.equal(
  (shell.match(/tone: 'teal'/g) ?? []).length,
  1,
  'a navigation tone identifies one destination',
)

const detail = read('app/(protected)/out-lab/[id]/page.tsx')

// An annual plan is a budget line that was never procured through this
// register, so the whole procurement track is absent rather than disabled.
assert.match(detail, /const isPlan = record\.kind === 'annual_plan'/)
assert.match(detail, /const stageHistory = isPlan \? null : \(/)
assert.match(
  detail,
  /hasNextAction = canEdit && !isPlan/,
  'an annual plan must never offer a next stage',
)

// Started contracts collapse the six-stage history and drop the next-stage
// action, matching the contract register.
assert.match(detail, /isContractStarted \? <StageHistoryDisclosure>\{stageHistory\}<\/StageHistoryDisclosure> : stageHistory/)

// Correcting stage history writes through the contract RPCs, which know
// nothing about this register, so the editor must stay switched off here.
assert.doesNotMatch(detail, /canManageStageHistory/)

// A uuid id, not the contract register's bigint. Anything else is not-found
// before it can reach a query.
assert.match(detail, /if \(!UUID\.test\(id\)\) notFound\(\)/)

const budgetPanel = read('components/out-lab/OutLabBudgetPanel.tsx')

// Reused rather than reimplemented: the same gauge, chart and satang
// arithmetic as the lease pages.
assert.match(budgetPanel, /from '@\/components\/contracts\/BudgetGauge'/)
assert.match(budgetPanel, /from '@\/components\/contracts\/ExpenseMonthlyChart'/)
assert.match(budgetPanel, /expenseMonthlySeries, isLowBudget \} from '@\/lib\/contracts\/budget'/)

// Over-plan is reported, never refused — the send-out testing already happened.
assert.match(budgetPanel, /notice\.tone === 'over'/)
// Only a contract can span fiscal years; an annual plan's page is the breakdown.
assert.match(budgetPanel, /\{!isPlan && \(/)

const usageForm = read('components/out-lab/MonthlyUsageForm.tsx')

// One figure per month, so choosing a month that already has one loads it and
// says plainly that saving replaces it.
assert.match(usageForm, /การบันทึกจะแทนที่ยอดเดิม/)
assert.match(usageForm, /existing \? 'แทนที่ยอดของเดือนนี้' : 'บันทึกยอด'/)

// The client-side warning must allow for the figure being replaced, or editing
// a month downwards on a nearly-full contract would look blocked when it is not.
assert.match(usageForm, /parsedAmount > remaining \+ replacedAmount/)
// A plan is never refused by the database, so it must not be warned about here.
assert.match(usageForm, /kind === 'contract_ceiling' &&\s*\n?\s*remaining !== null/)

const history = read('components/out-lab/MonthlyUsageHistory.tsx')
// Exports always carry every month, never only the rows currently on screen.
assert.match(history, /outLabUsageCsv\(entries\)/)
assert.match(history, /outLabUsageSheetXml\(\{ contractNumber, displayName \}, entries\)/)

const form = read('components/out-lab/OutLabContractForm.tsx')
// Changing kind after creation would swap the rule an existing balance is
// judged by, so the control is disabled and the reason is stated.
assert.match(form, /disabled=\{mode === 'edit'\}/)
assert.match(form, /เปลี่ยนรูปแบบงบหลังสร้างไม่ได้/)
// An annual plan shows its derived period rather than hiding it.
assert.match(form, /planPeriod\.startDate/)

// The design system owns the styling: no second approach, no inline styles
// beyond the CSS custom property pattern the existing components use.
for (const path of [
  'components/out-lab/OutLabTable.tsx',
  'components/out-lab/OutLabBudgetPanel.tsx',
  'components/out-lab/MonthlyUsageForm.tsx',
  'components/out-lab/MonthlyUsageHistory.tsx',
  'components/out-lab/MissingPeriodNotice.tsx',
  'components/out-lab/FiscalYearBreakdown.tsx',
]) {
  assert.doesNotMatch(read(path), /style=\{\{/, `${path} must not introduce inline styles`)
}
assert.match(css, /\.out-lab-missing-periods \{/)

console.log('out lab UI tests passed')
