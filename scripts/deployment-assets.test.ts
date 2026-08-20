import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

function read(relativePath: string) {
  const path = join(root, relativePath)
  assert.equal(existsSync(path), true, `${relativePath} must exist`)
  return readFileSync(path, 'utf8')
}

const packageJson = JSON.parse(read('package.json')) as {
  scripts: Record<string, string>
  devDependencies: Record<string, string>
}

assert.equal(packageJson.scripts['test:e2e'], 'playwright test')
assert.match(packageJson.scripts['test:security'], /auth-access-behavior\.test\.ts/)
assert.match(packageJson.scripts.verify, /test:e2e/)
assert.match(packageJson.scripts.verify, /test:deployment/)
assert.equal(packageJson.devDependencies['csv-parse'], '7.0.1')
assert.equal(packageJson.devDependencies['read-excel-file'], '9.3.5')

const playwrightConfig = read('playwright.config.ts')
assert.match(playwrightConfig, /tests\/e2e/)
assert.match(playwrightConfig, /trace:\s*'on-first-retry'/)
assert.match(playwrightConfig, /E2E_BASE_URL/)
assert.match(playwrightConfig, /E2E_RUN_LOCAL_SERVER/)
assert.match(playwrightConfig, /VERCEL_AUTOMATION_BYPASS_SECRET/)
assert.match(playwrightConfig, /x-vercel-protection-bypass/)

const requiredSpecs: Record<string, RegExp[]> = {
  'tests/e2e/contracts.spec.ts': [/manager/, /contract_started/, /เลขที่สัญญา/],
  'tests/e2e/pr.spec.ts': [/manager/, /stock/, /concurr/i],
  'tests/e2e/receiving.spec.ts': [/manager/, /stock/, /post/i],
  'tests/e2e/requisitions.spec.ts': [/manager/, /stock/, /FIFO/, /concurr/i, /A4/],
  'tests/e2e/dashboard.spec.ts': [/admin/, /watchlist/i, /settings/, /Dashboard บริหารสัญญา/],
  'tests/e2e/contract-budget.spec.ts': [/admin/, /stock/, /budget/i, /overspend/i],
}

for (const [path, patterns] of Object.entries(requiredSpecs)) {
  const source = read(path)
  assert.match(source, /@smoke/, `${path} must expose a release smoke test`)
  for (const pattern of patterns) assert.match(source, pattern, `${path} must cover ${pattern}`)
}

const vercelConfig = read('vercel.ts')
assert.match(vercelConfig, /framework:\s*'nextjs'/)
assert.match(vercelConfig, /fluid:\s*true/)
// Functions must run beside the database. Both Supabase projects are in AWS
// ap-southeast-2, and the unset default put the functions in iad1 — every
// query crossed the Pacific twice, and a page makes at least two in sequence.
assert.match(
  vercelConfig,
  /regions:\s*\['syd1'\]/,
  'serverless functions must stay co-located with the ap-southeast-2 database',
)

// Vercel CLI does not inherit every project-specific Git ignore. Keep database
// dumps and local import inputs out of the upload manifest explicitly.
const vercelIgnore = read('.vercelignore')
const vercelIgnoreLines = vercelIgnore.split(/\r?\n/).map((line) => line.trim())
for (const privatePath of [
  '.backups',
  '.secure-import',
  '.env*',
  '.claude',
  '.codex',
  '.impeccable',
]) {
  assert.equal(
    vercelIgnoreLines.includes(privatePath),
    true,
    `.vercelignore must exclude ${privatePath}`,
  )
}

const cutover = read('docs/runbooks/cutover.md')
for (const checkpoint of [
  'change freeze',
  'backup',
  'migration',
  'approved hash',
  'physical count',
  'preview',
  'smoke',
  'promote',
  'LABCBH_STOCK_URL',
]) {
  assert.match(cutover, new RegExp(checkpoint, 'i'), `cutover runbook must include ${checkpoint}`)
}

const observability = read('docs/runbooks/observability.md')
for (const checkpoint of ['test:e2e:strict', 'preflight:lots', 'read-only', 'PITR']) {
  assert.match(observability, new RegExp(checkpoint.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), `observability runbook must include ${checkpoint}`)
}

const rollback = read('docs/runbooks/rollback.md')
for (const checkpoint of ['trigger', 'freeze', 'previous deployment', 'forward-only', 'reconciliation']) {
  assert.match(rollback, new RegExp(checkpoint, 'i'), `rollback runbook must include ${checkpoint}`)
}

const envExample = read('.env.example')
for (const key of [
  'E2E_BASE_URL',
  'E2E_ADMIN_IDENTIFIER',
  'E2E_MANAGER_IDENTIFIER',
  'E2E_STOCK_IDENTIFIER',
  'E2E_STOCK_ALT_IDENTIFIER',
]) {
  assert.match(envExample, new RegExp(`^${key}=`, 'm'), `.env.example must document ${key}`)
}

console.log('deployment assets contract tests passed')
