# Vercel Environment Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Configure isolated Supabase environments in Vercel, deploy the current commit to Preview, prove it against Staging, and leave Production gated on PITR and migrations.

**Architecture:** Vercel Preview reads the Staging Supabase values from the ignored `.env.local`; Vercel Production reads the Production Supabase values from the ignored `.env.production-backup.local`. Only Preview is deployed in this plan. Verification combines the repository gate, HTTP boundary checks, fixture-backed Playwright tests, and a post-run Vercel log scan.

**Tech Stack:** PowerShell, Vercel CLI 58.4.4 through `npm exec`, Next.js 16, Supabase, Playwright 1.62, Git.

## Global Constraints

- Preview must target Supabase project `stogulcfwsvunydmwrex`.
- Production must target Supabase project `fslagsuorkcckvvtrmyi`.
- Required Vercel keys are `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`.
- Never print, commit, or copy secret values into tracked files.
- Never put Production credentials in Preview or point the production alias at Staging.
- Do not deploy or promote to Production, apply migrations, copy documents, import data, or modify the legacy portal.
- All Staging E2E mutation tests run with fresh fixtures and `--workers=1`.
- Stop immediately if a project-ref check, local verification, HTTP smoke, E2E test, or log scan fails.

---

### Task 1: Configure isolated Vercel environments

**Files:**
- Read: `.env.local`
- Read: `.env.production-backup.local`
- Read: `.vercel/project.json`
- Modify: none (Vercel project configuration only)

**Interfaces:**
- Consumes: ignored dotenv files containing the three required keys.
- Produces: the same three sensitive keys in Vercel Preview and Production, each scoped to the correct Supabase project.

- [ ] **Step 1: Confirm the repository and linked Vercel project**

Run:

```powershell
git status --short --branch
npm exec --yes vercel -- whoami
Get-Content -Raw .vercel/project.json
```

Expected: the branch is `main`; the working tree has no unexpected changes;
Vercel reports `nicssj-world`; the linked project name is `labcbh-stock`.

- [ ] **Step 2: Validate required keys and project refs without printing values**

Run:

```powershell
$requiredKeys = @(
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY'
)

function Read-DotEnvValue([string]$path, [string]$name) {
  $line = Get-Content -LiteralPath $path |
    Where-Object { $_ -match "^$([regex]::Escape($name))=" } |
    Select-Object -First 1
  if (-not $line) { throw "Missing $name in $path" }
  $value = ($line -split '=', 2)[1].Trim()
  if (-not $value) { throw "Empty $name in $path" }
  return $value
}

foreach ($key in $requiredKeys) {
  [void](Read-DotEnvValue '.env.local' $key)
  [void](Read-DotEnvValue '.env.production-backup.local' $key)
}

$previewUrl = Read-DotEnvValue '.env.local' 'NEXT_PUBLIC_SUPABASE_URL'
$productionUrl = Read-DotEnvValue '.env.production-backup.local' 'NEXT_PUBLIC_SUPABASE_URL'
if ($previewUrl -notmatch 'stogulcfwsvunydmwrex') { throw 'Preview source is not Staging' }
if ($productionUrl -notmatch 'fslagsuorkcckvvtrmyi') { throw 'Production source is not Production' }
'Validated 3 keys in each source; project refs match.'
```

Expected: `Validated 3 keys in each source; project refs match.` No secret value
appears in the output.

- [ ] **Step 3: Add the Staging values to Vercel Preview**

Run in the same PowerShell session as Step 2:

```powershell
foreach ($key in $requiredKeys) {
  $value = Read-DotEnvValue '.env.local' $key
  $value | npm exec --yes vercel -- env add $key preview --sensitive --force --yes
  if ($LASTEXITCODE -ne 0) { throw "Failed to set Preview key $key" }
}
```

Expected: Vercel confirms all three names were added to Preview. Values are not
shown.

- [ ] **Step 4: Add the Production values to Vercel Production**

Run in the same PowerShell session:

```powershell
foreach ($key in $requiredKeys) {
  $value = Read-DotEnvValue '.env.production-backup.local' $key
  $value | npm exec --yes vercel -- env add $key production --sensitive --force --yes
  if ($LASTEXITCODE -ne 0) { throw "Failed to set Production key $key" }
}
```

Expected: Vercel confirms all three names were added to Production. Values are
not shown. No deployment is created.

- [ ] **Step 5: Verify names and scopes**

Run:

```powershell
npm exec --yes vercel -- env ls preview
npm exec --yes vercel -- env ls production
```

Expected: each scope lists exactly the three required application keys, plus
only Vercel-managed system values if the CLI displays them. Preview and
Production entries are marked sensitive.

### Task 2: Verify and deploy the current commit to Preview

**Files:**
- Read: `package.json`
- Read: `vercel.ts`
- Modify: none (creates an immutable Vercel Preview deployment)

**Interfaces:**
- Consumes: Task 1 Preview variables and the current `main` commit.
- Produces: a Ready immutable Preview URL for that commit, without modifying Production aliases.

- [ ] **Step 1: Run the repository verification gate before deployment**

Run:

```powershell
npm run verify
```

Expected: exit code 0 for lint, typecheck, all script suites, non-fixture E2E,
and the production build. Do not deploy on any failure.

- [ ] **Step 2: Record the exact source commit**

Run:

```powershell
$sourceCommit = git rev-parse HEAD
$sourceShort = git rev-parse --short HEAD
"source commit: $sourceShort"
```

Expected: the full SHA is retained in `$sourceCommit` and the short SHA is
printed for the evidence record.

- [ ] **Step 3: Create a Preview deployment**

Run in the same PowerShell session as Step 2:

```powershell
$deployOutput = npm exec --yes vercel -- deploy --yes --force 2>&1
$deployOutput | ForEach-Object { $_ }
if ($LASTEXITCODE -ne 0) { throw 'Preview deployment failed' }
$previewDeploymentUrl = ($deployOutput |
  Where-Object { $_ -match '^https://.*\.vercel\.app$' } |
  Select-Object -Last 1).Trim()
if (-not $previewDeploymentUrl) { throw 'Preview URL was not returned' }
"preview: $previewDeploymentUrl"
```

Expected: a unique `https://labcbh-stock-*.vercel.app` URL. The command must not
contain `--prod`, `--target production`, or `promote`.

- [ ] **Step 4: Inspect deployment identity and readiness**

Run:

```powershell
npm exec --yes vercel -- inspect $previewDeploymentUrl
```

Expected: target `preview`, status `Ready`, project `labcbh-stock`. Record the
deployment ID and confirm the deployment metadata corresponds to
`$sourceCommit` when shown.

- [ ] **Step 5: Smoke the public and authentication boundaries**

Run:

```powershell
$login = Invoke-WebRequest -Uri "$previewDeploymentUrl/login" -MaximumRedirection 0 -SkipHttpErrorCheck
$root = Invoke-WebRequest -Uri "$previewDeploymentUrl/" -MaximumRedirection 0 -SkipHttpErrorCheck
$dashboard = Invoke-WebRequest -Uri "$previewDeploymentUrl/dashboard" -MaximumRedirection 0 -SkipHttpErrorCheck

if ($login.StatusCode -ne 200) { throw "Login returned $($login.StatusCode)" }
if ($root.StatusCode -notin 307,308) { throw "Root returned $($root.StatusCode)" }
if ($dashboard.StatusCode -notin 307,308) { throw "Dashboard returned $($dashboard.StatusCode)" }
if ($root.Headers.Location -notmatch '/login$') { throw 'Root did not redirect to /login' }
if ($dashboard.Headers.Location -notmatch '/login$') { throw 'Dashboard did not redirect to /login' }
'HTTP smoke passed: login=200, protected routes redirect to /login.'
```

Expected: the final success line appears. A Vercel authentication page instead
of the LABCBH login is a failure and must be resolved before E2E.

### Task 3: Run fixture-backed Staging E2E and record evidence

**Files:**
- Read: `docs/runbooks/e2e-staging.md`
- Read: `tests/e2e/*.spec.ts`
- Modify: `docs/STATUS.md`

**Interfaces:**
- Consumes: Task 2 `$previewDeploymentUrl`, Staging-only fixture accounts, and fresh/unused Staging records.
- Produces: a fixture-backed Playwright result, a clean Preview error-log scan, and committed status evidence.

- [ ] **Step 1: Reset the four Staging fixture-account passwords**

Run:

```powershell
npm run e2e:staging-passwords
```

Expected: exit code 0 and confirmation for E-Phis `9495`, `99001`, `14812`, and
`11050`. The script must confirm it is targeting `stogulcfwsvunydmwrex`.

- [ ] **Step 2: Seed the consumable receipt and lease fixtures**

Run:

```powershell
$receiptOutput = npm run e2e:staging-seed-receipt --silent
$receiptPath = ($receiptOutput | Where-Object { $_ -match '^/receipts/[0-9a-f-]{36}$' } | Select-Object -Last 1).Trim()
if (-not $receiptPath) { throw 'Receipt fixture path missing' }

$leaseOutput = npm run e2e:staging-seed-lease --silent
$leasePath = ($leaseOutput | Where-Object { $_ -match '^/contracts/\d+$' } | Select-Object -Last 1).Trim()
if (-not $leasePath) { throw 'Lease fixture path missing' }
```

Expected: one new draft receipt path and one new equipment-lease contract path.

- [ ] **Step 3: Select unused pending PR and waiting requisition fixtures**

Run:

```powershell
$fixtureJson = node --env-file=.env.local --input-type=module -e "
import { createClient } from '@supabase/supabase-js';
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
if (!process.env.NEXT_PUBLIC_SUPABASE_URL.includes('stogulcfwsvunydmwrex')) throw new Error('not Staging');
const [{ data: pr, error: prError }, { data: req, error: reqError }] = await Promise.all([
  db.from('purchase_requests').select('id').eq('status', 'pending').limit(1).maybeSingle(),
  db.from('requisitions').select('id').eq('status', 'waiting').limit(1).maybeSingle(),
]);
if (prError) throw prError;
if (reqError) throw reqError;
if (!pr) throw new Error('no unused pending purchase request');
if (!req) throw new Error('no unused waiting requisition');
console.log(JSON.stringify({ pr: '/purchase-requests/' + pr.id, req: '/requisitions/' + req.id }));
"
$fixtures = $fixtureJson | ConvertFrom-Json
```

Expected: `$fixtures.pr` and `$fixtures.req` contain Staging paths. If either
record is unavailable, stop and create a reviewed Staging fixture rather than
using Production.

- [ ] **Step 4: Run all seven smoke specs serially against Preview**

Run in the same PowerShell session as Steps 2–3:

```powershell
$env:E2E_BASE_URL = $previewDeploymentUrl
$env:E2E_REQUIRE_FIXTURES = '1'
$env:E2E_ALLOW_MUTATIONS = '1'
$env:E2E_ADMIN_IDENTIFIER = '9495'
$env:E2E_ADMIN_PASSWORD = '123456'
$env:E2E_MANAGER_IDENTIFIER = '99001'
$env:E2E_MANAGER_PASSWORD = '123456'
$env:E2E_STOCK_IDENTIFIER = '14812'
$env:E2E_STOCK_PASSWORD = '123456'
$env:E2E_STOCK_ALT_IDENTIFIER = '11050'
$env:E2E_STOCK_ALT_PASSWORD = '123456'
$env:E2E_PR_READY_URL = "$previewDeploymentUrl$($fixtures.pr)"
$env:E2E_RECEIPT_DRAFT_URL = "$previewDeploymentUrl$receiptPath"
$env:E2E_REQUISITION_WAITING_URL = "$previewDeploymentUrl$($fixtures.req)"
$env:E2E_LEASE_CONTRACT_URL = "$previewDeploymentUrl$leasePath"

npm run test:e2e -- --workers=1
```

Expected: 7 passed, 0 failed, 0 skipped. Because the run consumes fixtures, do
not retry it without repeating Steps 2–3.

- [ ] **Step 5: Scan Preview runtime logs after the smoke run**

Run:

```powershell
$errorLogs = npm exec --yes vercel -- logs $previewDeploymentUrl --level error --since 1h --no-follow 2>&1
$errorLogs | ForEach-Object { $_ }
if ($errorLogs -match 'Error running|Internal Server Error|SUPABASE_SERVICE_ROLE_KEY|eyJ[A-Za-z0-9_-]+') {
  throw 'Preview log scan found an application error or possible secret value'
}
'Preview error-log scan is clean.'
```

Expected: no application error and no token-like value. CLI informational lines
such as `Fetched 0 logs` are acceptable.

- [ ] **Step 6: Update the status document with exact evidence**

Modify `docs/STATUS.md` with `apply_patch`. Add one bullet stating that Preview
points to Staging and Production points to Production, with all three required
Supabase keys sensitive in both scopes. Add a second bullet containing the
literal immutable URL from `$previewDeploymentUrl`, the literal full SHA from
`$sourceCommit`, the deployment ID printed by `vercel inspect`, and the current
Asia/Bangkok timestamp. The same bullet must record the observed results of
`npm run verify`, the HTTP auth-boundary smoke, fixture-backed E2E 7/7, and the
Preview error-log scan. Do not leave angle-bracket tokens or other placeholder
text in the document.

Move the deployment item out of “broken” status, but keep Production promotion,
migrations, document copy, import, and portal handoff blocked. State explicitly
that the existing production alias is not the validated Preview and that PITR
still requires the release owner.

- [ ] **Step 7: Verify the evidence diff**

Run:

```powershell
git diff --check
git diff -- docs/STATUS.md
git status --short
```

Expected: no whitespace errors; only the intentional `docs/STATUS.md` change is
uncommitted.

- [ ] **Step 8: Commit the verified status**

Run:

```powershell
git add -- docs/STATUS.md
git commit -m "chore: validate isolated Vercel preview"
git status --short --branch
```

Expected: commit succeeds and the working tree is clean. The branch is ahead of
`origin/main`; do not push or promote as part of this plan.
