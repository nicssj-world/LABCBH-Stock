# LABCBH Stock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and deploy LABCBH Stock as the full contract, PR, receiving, inventory, requisition, and executive-dashboard system while sharing Supabase users with lab-management-portal and retiring the portal’s legacy contract editor.

**Architecture:** A Next.js 16 App Router application performs authenticated reads with Supabase SSR and authorized mutations through Server Actions. Existing `contracts` rows are expanded in place; normalized contract items, procurement documents, lots, and an immutable stock ledger supply all calculated balances. Cross-document confirmations run as service-role-only, security-invoker PostgreSQL transactions.

**Tech Stack:** Next.js 16.2.12 (July 2026 security patch), React 19.2.4, TypeScript 5, Tailwind CSS 4, Supabase JS 2.106.0, Supabase SSR 0.10.3, Zod 3.25.76, Recharts 3.8.1, Node.js 24, Playwright, Vercel Fluid Compute.

## Global Constraints

- The approved specification is `docs/superpowers/specs/2026-07-29-labcbh-stock-design.md`.
- Use the same Supabase project, `auth.users`, `profiles`, and session cookies as `../lab-management-portal`.
- LABCBH Stock owns contract mutations after cutover; the portal contract module becomes a redirect and its write APIs stop mutating data.
- Preserve existing contract IDs, legacy columns, foreign keys, and rent-machine data.
- `contract_number` is null before `contract_started` and unique when present.
- Every public table has RLS and explicit grants; never expose service-role or secret keys to the browser.
- Do not authorize from `user_metadata`; resolve access from `profiles` and `lab_stock_memberships`.
- Use Node.js Fluid Compute; do not set `runtime = 'edge'`.
- Use Noto Sans Thai for UI/print text and DM Mono only for codes and tabular identifiers.
- Follow `DESIGN.md`: Laboratory Control Bench, Dashboard Composition C plus the Composition B watchlist.
- Use Thai labels, Buddhist fiscal years, locale-aware dates/currency, WCAG AA, visible focus, and 44px minimum interactive targets.
- Generate each migration with `npx supabase migration new <name>`; do not invent migration timestamps.
- Check `npx supabase --help` and the relevant command `--help` before using the CLI.
- Before Next.js code, read the relevant installed guide under `../lab-management-portal/node_modules/next/dist/docs/` because Next.js 16 conventions override remembered APIs.
- Pin package versions and commit `package-lock.json`.
- Use test-first changes and end every task with a focused commit.

---

## File and Module Map

- `app/(auth)/login/`: shared Supabase password login.
- `app/(protected)/`: authenticated shell and page routes.
- `app/(protected)/dashboard/`: approved workflow-ribbon Dashboard and watchlist.
- `app/(protected)/contracts/`: contract list, detail, create/edit, items, and stage history.
- `app/(protected)/purchase-requests/`: Manager PR creation and stock-officer confirmation.
- `app/(protected)/receipts/`: PO-linked receiving, images, and lots.
- `app/(protected)/requisitions/`: request, FIFO fulfillment, and A4 print.
- `app/(protected)/inventory/`: catalog, lots, balances, minimum stock, and adjustments.
- `app/(protected)/settings/access/`: app-specific membership administration.
- `components/ui/`: accessible Laboratory Control Bench primitives.
- `components/dashboard/`: ribbon, queue, watchlist, and chart components.
- `lib/auth/`: actor resolution and permission decisions.
- `lib/contracts/`, `lib/pr/`, `lib/inventory/`, `lib/requisitions/`: domain types, validation, queries, and actions.
- `lib/supabase/`: browser, server-session, and server-only admin clients.
- `lib/import/`: deterministic Sheet normalization and reconciliation.
- `supabase/migrations/`: generated schema migrations and transaction functions.
- `scripts/`: import, reconciliation, and static contract tests.
- `tests/e2e/`: Playwright acceptance scenarios.
- `../lab-management-portal/app/(protected)/staff/contracts/`: legacy route retirement.
- `../lab-management-portal/app/api/admin/contracts/`: legacy write shutdown.

---

### Task 1: Scaffold the App, Shared Auth, and Laboratory Control Bench Shell

**Files:**
- Create: `package.json`, `package-lock.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`
- Create: `app/layout.tsx`, `app/globals.css`, `app/(auth)/login/page.tsx`
- Create: `app/(protected)/layout.tsx`, `app/(protected)/dashboard/page.tsx`, `proxy.ts`
- Create: `lib/supabase/client.ts`, `lib/supabase/server.ts`, `lib/supabase/admin.ts`
- Create: `lib/auth/actor.ts`, `lib/auth/access.ts`
- Create: `components/ui/AppShell.tsx`, `components/ui/Button.tsx`, `components/ui/StatusChip.tsx`
- Test: `scripts/app-shell-contract.test.ts`, `scripts/auth-contract.test.ts`

**Interfaces:**
- Produces: `createClient(): SupabaseClient`, `supabaseAdmin: SupabaseClient`, `getActor(): Promise<Actor | null>`
- Produces: `requireActor(): Promise<Actor>`, where `Actor = { id: string; ephisId: string | null; name: string | null; profileRole: string | null; appRoles: LabStockRole[] }`

- [ ] **Step 1: Read Next.js 16 local guides and scaffold pinned dependencies**

Run:

```powershell
Get-ChildItem '..\lab-management-portal\node_modules\next\dist\docs' -Recurse -File |
  Where-Object Name -Match 'proxy|server-action|app-router|authentication' |
  Select-Object -First 20 FullName
npm init -y
npm install next@16.2.12 react@19.2.4 react-dom@19.2.4 @supabase/supabase-js@2.106.0 @supabase/ssr@0.10.3 zod@3.25.76 recharts@3.8.1
npm install -D typescript@^5 @types/node@^24 @types/react@^19 @types/react-dom@^19 tailwindcss@^4 @tailwindcss/postcss@^4 tsx@^4 eslint@^9 eslint-config-next@16.2.12 @playwright/test
```

Expected: `package-lock.json` exists and `npm ls next react @supabase/supabase-js` reports the pinned versions without invalid dependencies. Next.js `16.2.12` is the July 2026 security patch within the approved `16.2` minor line.

- [ ] **Step 2: Write failing shell and auth contract tests**

```ts
// scripts/app-shell-contract.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const shell = readFileSync('components/ui/AppShell.tsx', 'utf8')
const css = readFileSync('app/globals.css', 'utf8')
assert.match(shell, /ภาพรวม/)
assert.match(shell, /สัญญา/)
assert.match(shell, /ใบ PR/)
assert.match(shell, /รับเข้า/)
assert.match(shell, /เบิกจ่าย/)
assert.match(css, /--lab-navy:/)
assert.match(css, /Noto Sans Thai/)
assert.doesNotMatch(css, /linear-gradient/)
```

```ts
// scripts/auth-contract.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const actor = readFileSync('lib/auth/actor.ts', 'utf8')
const admin = readFileSync('lib/supabase/admin.ts', 'utf8')
assert.match(actor, /auth\.getUser\(\)/)
assert.match(actor, /lab_stock_memberships/)
assert.doesNotMatch(actor, /user_metadata/)
assert.doesNotMatch(admin, /NEXT_PUBLIC_.*SERVICE/)
```

- [ ] **Step 3: Run tests to verify the scaffold contracts fail**

Run: `npx tsx scripts/app-shell-contract.test.ts; npx tsx scripts/auth-contract.test.ts`

Expected: FAIL because the referenced files do not exist.

- [ ] **Step 4: Implement Supabase clients and actor boundary**

```ts
// lib/auth/actor.ts
import 'server-only'
import { createClient } from '@/lib/supabase/server'

export type LabStockRole = 'admin' | 'head' | 'stock_officer' | 'viewer' | 'reporter'
export interface Actor {
  id: string
  ephisId: string | null
  name: string | null
  profileRole: string | null
  appRoles: LabStockRole[]
}

export async function getActor(): Promise<Actor | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data, error } = await supabase
    .from('profiles')
    .select('id,ephis_id,name,role,lab_stock_memberships(role,active)')
    .eq('id', user.id)
    .single()
  if (error || !data) return null
  const roles = (data.lab_stock_memberships ?? [])
    .filter((row: { active: boolean }) => row.active)
    .map((row: { role: LabStockRole }) => row.role)
  if (data.ephis_id === '9495' && !roles.includes('admin')) roles.push('admin')
  if (data.role === 'Manager' && !roles.includes('head')) roles.push('head')
  return { id: data.id, ephisId: data.ephis_id, name: data.name, profileRole: data.role, appRoles: roles }
}
```

Implement SSR cookie clients using the current local Next.js/Supabase patterns; `supabaseAdmin` must be server-only and read `SUPABASE_SERVICE_ROLE_KEY`.

```ts
// lib/supabase/server.ts
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createClient() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: values => {
          try {
            values.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
          } catch {
            // A Server Component cannot set cookies; proxy.ts performs refresh writes.
          }
        },
      },
    },
  )
}
```

```ts
// lib/supabase/admin.ts
import 'server-only'
import { createClient } from '@supabase/supabase-js'

export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
)
```

- [ ] **Step 5: Implement the app shell and protected redirect**

The protected layout calls `requireActor()`, redirects unauthenticated users to `/login`, and renders a compact navy sidebar with Thai navigation. Define semantic color tokens in `app/globals.css`, use Noto Sans Thai from local font files, and keep navigation icon labels visible.

- [ ] **Step 6: Run shell verification**

Run:

```powershell
npx tsx scripts/app-shell-contract.test.ts
npx tsx scripts/auth-contract.test.ts
npm run build
```

Expected: both scripts print no assertion errors and the production build exits 0.

- [ ] **Step 7: Commit**

```powershell
git add package.json package-lock.json tsconfig.json next.config.ts postcss.config.mjs app proxy.ts lib components scripts
git commit -m "feat: scaffold LABCBH stock shell and shared auth"
```

---

### Task 2: Expand Contracts and Add App Permissions in Supabase

**Files:**
- Create via CLI: `supabase/migrations/*_lab_stock_contracts_and_access.sql`
- Create: `lib/contracts/types.ts`, `lib/contracts/schema.ts`, `lib/contracts/stages.ts`
- Create: `scripts/contracts-schema.test.ts`, `scripts/contracts-domain.test.ts`
- Modify: `lib/auth/access.ts`

**Interfaces:**
- Produces: `CONTRACT_TYPES`, `PROCUREMENT_STAGES`, `contractInputSchema`, `allowedNextStages(stage)`
- Produces tables: `contract_items`, `contract_stage_history`, `contract_item_allocations`, `lab_stock_memberships`
- Produces service-only RPC: `advance_contract_stage(p_contract_id bigint, p_actor_id uuid, p_to_stage text, p_effective_date date, p_contract_number text, p_note text)`

- [ ] **Step 1: Discover Supabase CLI and create the migration**

```powershell
npx supabase --version
npx supabase migration --help
npx supabase migration new lab_stock_contracts_and_access
```

Expected: Supabase prints its version and creates exactly one timestamped migration ending in `_lab_stock_contracts_and_access.sql`.

- [ ] **Step 2: Write failing schema and domain tests**

```ts
// scripts/contracts-domain.test.ts
import assert from 'node:assert/strict'
import { allowedNextStages, requiresContractNumber } from '../lib/contracts/stages'

assert.deepEqual(allowedNextStages('sent_to_procurement'), ['plan_published'])
assert.equal(requiresContractNumber('winner_announced'), false)
assert.equal(requiresContractNumber('contract_started'), true)
```

The schema test reads the generated migration and asserts all four tables, RLS enablement, explicit `TO authenticated` policies, indexes on policy columns, nullable `contract_number`, and a partial unique index `WHERE contract_number IS NOT NULL`.

- [ ] **Step 3: Run tests to verify failure**

Run: `npx tsx scripts/contracts-domain.test.ts; npx tsx scripts/contracts-schema.test.ts`

Expected: FAIL because domain files and migration content are incomplete.

- [ ] **Step 4: Implement contract constants and validation**

```ts
// lib/contracts/stages.ts
export const PROCUREMENT_STAGES = [
  'sent_to_procurement',
  'plan_published',
  'tender_announced',
  'result_consideration',
  'winner_announced',
  'contract_started',
] as const
export type ProcurementStage = typeof PROCUREMENT_STAGES[number]
export const allowedNextStages = (stage: ProcurementStage): ProcurementStage[] => {
  const index = PROCUREMENT_STAGES.indexOf(stage)
  return index < PROCUREMENT_STAGES.length - 1 ? [PROCUREMENT_STAGES[index + 1]] : []
}
export const requiresContractNumber = (stage: ProcurementStage) => stage === 'contract_started'
```

`contractInputSchema` validates Thai fiscal year, one of seven exact contract-type constants, date order, positive line quantities/prices, and contract number only at the final stage.

- [ ] **Step 5: Implement the migration**

The migration must:

- alter existing `contracts` without changing IDs;
- add fiscal year, contract type, stage, display name, archive state, and updated timestamp;
- backfill legacy rows as equipment leases already at `contract_started`;
- create normalized child/access tables with foreign keys and append-only allocation/history semantics;
- create `advance_contract_stage` to lock the contract row, validate the single allowed transition, require a unique number only when starting, update the contract, and append history atomically;
- revoke RPC execution from `PUBLIC`, `anon`, and `authenticated`, then grant it only to `service_role`;
- seed memberships by joining `profiles.ephis_id`: 9495 admin, 14812 and 11050 stock officer;
- rely on Manager-to-head resolution in application code, not duplicated membership rows;
- enable RLS, add explicit grants, and create read/write policies using indexed profile IDs.

- [ ] **Step 6: Validate locally and run advisors**

```powershell
npx supabase start
npx supabase db reset
npx tsx scripts/contracts-schema.test.ts
npx tsx scripts/contracts-domain.test.ts
npx supabase db advisors
```

Expected: reset succeeds, both tests pass, and advisors report no security or performance errors introduced by this migration.

- [ ] **Step 7: Commit**

```powershell
git add supabase lib/contracts lib/auth/access.ts scripts/contracts-*.test.ts
git commit -m "feat: expand contracts and add LAB stock access"
```

---

### Task 3: Implement Full Contract CRUD, Items, and Stage History

**Files:**
- Create: `lib/contracts/queries.ts`, `lib/contracts/actions.ts`, `lib/contracts/presenter.ts`
- Create: `app/(protected)/contracts/page.tsx`, `app/(protected)/contracts/new/page.tsx`
- Create: `app/(protected)/contracts/[id]/page.tsx`, `app/(protected)/contracts/[id]/edit/page.tsx`
- Create: `components/contracts/ContractForm.tsx`, `components/contracts/ContractTable.tsx`, `components/contracts/StageTimeline.tsx`, `components/contracts/ContractItemsEditor.tsx`
- Test: `scripts/contracts-actions.test.ts`, `scripts/contracts-ui.test.ts`

**Interfaces:**
- Consumes: `contractInputSchema`, `Actor`, contract tables from Task 2
- Produces: `listContracts(filters)`, `getContract(id)`, `createContract(input)`, `updateContract(id,input)`, `advanceContractStage(id,input)`, `archiveContract(id,reason)`

- [ ] **Step 1: Write failing action tests**

```ts
// scripts/contracts-actions.test.ts
import assert from 'node:assert/strict'
import { validateStageAdvance } from '../lib/contracts/actions'

assert.throws(
  () => validateStageAdvance({ from: 'winner_announced', to: 'contract_started', contractNumber: '' }),
  /เลขที่สัญญา/
)
assert.doesNotThrow(
  () => validateStageAdvance({ from: 'winner_announced', to: 'contract_started', contractNumber: '12\/2569' })
)
```

UI tests assert fiscal-year grouping, seven Thai type labels, nullable-number copy “ยังไม่มีเลขที่สัญญา,” destructive confirmation, and a six-step timeline with dates.

- [ ] **Step 2: Run tests to verify failure**

Run: `npx tsx scripts/contracts-actions.test.ts; npx tsx scripts/contracts-ui.test.ts`

Expected: FAIL because actions and screens are absent.

- [ ] **Step 3: Implement queries and authorized Server Actions**

```ts
// lib/contracts/actions.ts (public signature)
export interface StageAdvanceInput {
  from: ProcurementStage
  to: ProcurementStage
  contractNumber?: string | null
  effectiveDate: string
  note?: string
}

export async function advanceContractStage(contractId: number, input: StageAdvanceInput) {
  const actor = await requirePermission('contracts:edit')
  const parsed = stageAdvanceSchema.parse(input)
  return performStageAdvance({ contractId, actorId: actor.id, ...parsed })
}
```

`performStageAdvance` calls the service-only `advance_contract_stage` RPC from `supabaseAdmin`; no browser or authenticated client receives direct execute permission. Physically delete only an untouched draft with no items/history/allocation; otherwise archive with actor, reason, and timestamp.

- [ ] **Step 4: Implement the contract pages**

Use Server Components for lists/details, URL-backed filters, a progressive multi-line editor, visible line totals, stage-change confirmation, and a mobile card fallback. Long forms auto-save a local draft and warn before navigation with unsaved changes.

- [ ] **Step 5: Verify**

```powershell
npx tsx scripts/contracts-actions.test.ts
npx tsx scripts/contracts-ui.test.ts
npm run build
```

Expected: PASS and the build includes contract list/new/detail/edit routes.

- [ ] **Step 6: Commit**

```powershell
git add app components/contracts lib/contracts scripts/contracts-*.test.ts
git commit -m "feat: move full contract management to LABCBH Stock"
```

---

### Task 4: Build the Approved Dashboard and Watchlist

**Files:**
- Create: `lib/dashboard/query.ts`, `lib/dashboard/types.ts`
- Modify: `app/(protected)/dashboard/page.tsx`
- Create: `components/dashboard/WorkflowRibbon.tsx`, `QueuePanels.tsx`, `Watchlist.tsx`, `ContractBalanceBullets.tsx`, `AuditStream.tsx`
- Test: `scripts/dashboard-query.test.ts`, `scripts/dashboard-ui.test.ts`

**Interfaces:**
- Produces: `getDashboardSnapshot(filters): Promise<DashboardSnapshot>`
- `DashboardSnapshot` contains `workflowStages`, `prQueue`, `requisitionQueue`, `stockAlerts`, `contractAlerts`, `watchlist`, and `auditEvents`

- [ ] **Step 1: Write failing Dashboard contract tests**

```ts
// scripts/dashboard-ui.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const page = readFileSync('app/(protected)/dashboard/page.tsx', 'utf8')
assert.match(page, /WorkflowRibbon/)
assert.match(page, /Watchlist/)
assert.match(page, /ContractBalanceBullets/)
assert.match(page, /AuditStream/)
```

Query tests seed one item under 30%, one minimum breach, one expiring lot, and one overdue request, then assert severity ordering: overdue/depleted, under minimum, near expiry, informational.

- [ ] **Step 2: Run tests to verify failure**

Run: `npx tsx scripts/dashboard-query.test.ts; npx tsx scripts/dashboard-ui.test.ts`

Expected: FAIL because Dashboard modules are absent.

- [ ] **Step 3: Implement the read model**

```ts
export type WatchSeverity = 'critical' | 'warning' | 'info'
export interface WatchItem {
  id: string
  kind: 'contract_low' | 'minimum_stock' | 'lot_expiry' | 'overdue_work'
  severity: WatchSeverity
  title: string
  detail: string
  dueAt: string | null
  href: string
}
```

Use filtered, indexed queries; do not calculate the entire Dashboard in client effects. Cache only per-request results and invalidate relevant routes after mutations.

- [ ] **Step 4: Implement Composition C plus B watchlist**

The first viewport contains the six-stage ribbon. The middle uses aligned work queues and bullet summaries. The lower watchlist combines and sorts all exceptions. Charts include visible values and a table alternative. Mobile renders the next-action list before charts.

- [ ] **Step 5: Verify responsive and accessibility contracts**

Run:

```powershell
npx tsx scripts/dashboard-query.test.ts
npx tsx scripts/dashboard-ui.test.ts
npm run build
```

Expected: PASS, no horizontal page overflow at 375px, and all severity states include text labels.

- [ ] **Step 6: Commit**

```powershell
git add app/(protected)/dashboard components/dashboard lib/dashboard scripts/dashboard-*.test.ts
git commit -m "feat: add workflow dashboard and prioritized watchlist"
```

---

### Task 5: Add Inventory Catalog, Minimum Stock, Lots, and Ledger

**Files:**
- Create via CLI: `supabase/migrations/*_lab_stock_inventory_ledger.sql`
- Create: `lib/inventory/types.ts`, `schema.ts`, `queries.ts`, `balance.ts`, `actions.ts`
- Create: `app/(protected)/inventory/page.tsx`, `app/(protected)/inventory/[id]/page.tsx`
- Create: `components/inventory/InventoryTable.tsx`, `LotTable.tsx`, `MinimumStockEditor.tsx`
- Test: `scripts/inventory-schema.test.ts`, `scripts/inventory-domain.test.ts`, `scripts/inventory-ui.test.ts`

**Interfaces:**
- Produces tables: `inventory_items`, `inventory_item_aliases`, `inventory_lots`, `stock_movements`
- Produces: `getOnHand(itemId)`, `getLotBalance(lotId)`, `getSuggestedMinimum(itemId)`, `projectedBelowMinimum(itemId, issueQty)`

- [ ] **Step 1: Generate the migration and write failing tests**

```powershell
npx supabase migration new lab_stock_inventory_ledger
npx tsx scripts/inventory-schema.test.ts
npx tsx scripts/inventory-domain.test.ts
```

Expected: tests fail until tables, constraints, and domain functions exist.

- [ ] **Step 2: Implement balance rules**

```ts
export function calculateSuggestedMinimum(monthlyIssues: number[]): number {
  const completed = monthlyIssues.slice(-3)
  if (completed.length === 0) return 0
  return (completed.reduce((sum, value) => sum + value, 0) / completed.length) * 1.5
}

export function resolveMinimumStock(explicit: number | null, suggested: number): number {
  return explicit ?? suggested
}
```

All on-hand and lot balances are sums of movements; no mutable balance column is authoritative.

- [ ] **Step 3: Implement schema, queries, and adjustments**

Create positive/negative checks by movement type, source-document uniqueness, RLS, explicit grants, item-code uniqueness with case-normalized LS codes, and audited adjustment actions. Reject any adjustment that would make lot or item on-hand negative.

- [ ] **Step 4: Implement inventory pages**

Provide LS/name search, department filters, current balance, minimum, projected status, lot/expiry table, alias visibility, and an admin/stock-officer minimum editor. Show “ต้องทำ PR” when on-hand is at/below the resolved minimum.

- [ ] **Step 5: Verify and commit**

```powershell
npx supabase db reset
npx tsx scripts/inventory-schema.test.ts
npx tsx scripts/inventory-domain.test.ts
npx tsx scripts/inventory-ui.test.ts
npm run build
git add supabase lib/inventory app/(protected)/inventory components/inventory scripts/inventory-*.test.ts
git commit -m "feat: add inventory catalog lots and stock ledger"
```

Expected: tests and build pass; commit succeeds.

---

### Task 6: Implement PR Submission and Atomic Contract Allocation

**Files:**
- Create via CLI: `supabase/migrations/*_lab_stock_purchase_requests.sql`
- Create: `lib/pr/types.ts`, `schema.ts`, `queries.ts`, `actions.ts`, `transaction.ts`
- Create: `app/(protected)/purchase-requests/page.tsx`, `new/page.tsx`, `[id]/page.tsx`
- Create: `components/pr/PurchaseRequestForm.tsx`, `PurchaseMethodFields.tsx`, `ContractItemPicker.tsx`, `PrReviewPanel.tsx`
- Test: `scripts/pr-schema.test.ts`, `scripts/pr-domain.test.ts`, `scripts/pr-transaction.test.ts`, `scripts/pr-ui.test.ts`

**Interfaces:**
- Produces tables: `purchase_requests`, `purchase_request_items`
- Produces service-only RPC: `confirm_purchase_request(p_pr_id uuid, p_actor_id uuid)`
- Produces: `createPurchaseRequest(input)`, `confirmPurchaseRequest(id)`, `setPurchaseOrderNumber(id, poNumber)`, `reversePurchaseRequest(id,reason)`

- [ ] **Step 1: Generate migration and write failing transaction tests**

Seed a contract item with quantity 100. Submit two pending PRs for 70 and 40, confirm concurrently, and assert exactly one succeeds and active allocations total no more than 100.

Run: `npx tsx scripts/pr-transaction.test.ts`

Expected: FAIL before the transaction function exists.

- [ ] **Step 2: Implement form schema**

```ts
export const purchaseMethodSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('annual_plan'), fiscalYear: z.number().int(), planSequence: z.string().min(1) }),
  z.object({ kind: z.literal('contract'), contractId: z.number().int(), purchaseSequence: z.number().int().positive() }),
  z.object({ kind: z.literal('awaiting_contract'), reference: z.string().min(1) }),
  z.object({ kind: z.literal('off_plan') }),
  z.object({ kind: z.literal('specific_contract') }),
  z.object({ kind: z.literal('e_bidding') }),
])
```

Each line snapshots LS, canonical name, rolling three-month usage, current on-hand, requested quantity, unit, unit price, and line total.

- [ ] **Step 3: Implement atomic confirmation and reversal**

The security-invoker function is revoked from `PUBLIC`, `anon`, and `authenticated`, granted only to `service_role`, locks the PR and contract items, validates pending status and remaining quantities, inserts one allocation per line, and sets `completed`. Reversal inserts opposite allocations and never deletes history.

- [ ] **Step 4: Implement Manager and stock-officer UI**

Managers can draft/submit. Stock officers see pending review, contract balance before/after, and acknowledge. Admin can perform both. Completed pages accept a PO number later without changing allocations.

- [ ] **Step 5: Verify and commit**

```powershell
npx supabase db reset
npx tsx scripts/pr-schema.test.ts
npx tsx scripts/pr-domain.test.ts
npx tsx scripts/pr-transaction.test.ts
npx tsx scripts/pr-ui.test.ts
npm run build
git add supabase lib/pr app/(protected)/purchase-requests components/pr scripts/pr-*.test.ts
git commit -m "feat: add PR workflow and atomic contract allocation"
```

Expected: all PR tests pass, concurrent over-allocation is prevented, and build exits 0.

---

### Task 7: Implement PO Images, Receiving, and Lot Creation

**Files:**
- Create via CLI: `supabase/migrations/*_lab_stock_receiving.sql`
- Create: `lib/receipts/types.ts`, `schema.ts`, `actions.ts`, `queries.ts`
- Create: `app/(protected)/receipts/page.tsx`, `new/page.tsx`, `[id]/page.tsx`
- Create: `components/receipts/ReceiptForm.tsx`, `ReceiptLinesEditor.tsx`, `PoImageUploader.tsx`
- Test: `scripts/receiving-schema.test.ts`, `scripts/receiving-transaction.test.ts`, `scripts/storage-policy.test.ts`, `scripts/receiving-ui.test.ts`

**Interfaces:**
- Produces tables: `goods_receipts`, `goods_receipt_items`
- Produces service-only RPC: `post_goods_receipt(p_receipt_id uuid, p_actor_id uuid)`
- Produces private bucket: `lab-stock-po`

- [ ] **Step 1: Write failing receiving and storage tests**

Tests assert that posting one receipt with two lots creates two positive movements, retrying does not duplicate movements, and an upload path outside `po/<fiscal-year>/<receipt-id>/` is rejected.

- [ ] **Step 2: Generate and implement the migration**

Run: `npx supabase migration new lab_stock_receiving`

Create receipt headers/items, private bucket metadata, authenticated read policies, stock-officer upload policies, and service-only posting RPC. Storage upsert policies include INSERT, SELECT, and UPDATE.

- [ ] **Step 3: Implement upload and receiving actions**

```ts
export interface ReceiptLineInput {
  inventoryItemId: string
  lotNumber: string
  expiryDate: string
  quantity: number
  unit: string
  storageLocation: string
}
```

Upload PO images only after a draft receipt ID exists. If upload fails, preserve the draft and do not post stock.

- [ ] **Step 4: Implement receiving UI**

Support search by PO, PR, LS, or name; multi-line lots; receiver/date/department; duplicate-lot warning; private signed preview; and a single posting action with loading lock.

- [ ] **Step 5: Verify and commit**

```powershell
npx supabase db reset
npx tsx scripts/receiving-schema.test.ts
npx tsx scripts/receiving-transaction.test.ts
npx tsx scripts/storage-policy.test.ts
npx tsx scripts/receiving-ui.test.ts
npm run build
git add supabase lib/receipts app/(protected)/receipts components/receipts scripts/receiving-*.test.ts scripts/storage-policy.test.ts
git commit -m "feat: add PO receiving images and lot posting"
```

Expected: all tests pass and private PO files cannot be listed or read without permission.

---

### Task 8: Implement Requisitions, FIFO Fulfillment, and A4 Printing

**Files:**
- Create via CLI: `supabase/migrations/*_lab_stock_requisitions.sql`
- Create: `lib/requisitions/types.ts`, `schema.ts`, `fifo.ts`, `actions.ts`, `print.ts`
- Create: `app/(protected)/requisitions/page.tsx`, `new/page.tsx`, `[id]/page.tsx`, `[id]/print/page.tsx`
- Create: `components/requisitions/RequisitionForm.tsx`, `LotPicker.tsx`, `FulfillmentPanel.tsx`, `RequisitionPrint.tsx`
- Test: `scripts/requisition-schema.test.ts`, `scripts/fifo-domain.test.ts`, `scripts/requisition-transaction.test.ts`, `scripts/requisition-print.test.ts`

**Interfaces:**
- Produces tables: `requisitions`, `requisition_items`, `requisition_lot_allocations`
- Produces: `rankLotsForFifo(lots)`, `fulfillRequisition(id,input)`
- Produces service-only RPC: `fulfill_requisition(p_requisition_id uuid, p_actor_id uuid, p_allocations jsonb)`

- [ ] **Step 1: Write failing FIFO tests**

```ts
import assert from 'node:assert/strict'
import { rankLotsForFifo } from '../lib/requisitions/fifo'

const ranked = rankLotsForFifo([
  { id: 'b', receivedAt: '2026-02-01', expiryDate: '2027-01-01', balance: 5 },
  { id: 'a', receivedAt: '2026-01-01', expiryDate: '2026-12-01', balance: 5 },
])
assert.deepEqual(ranked.map(row => row.id), ['a', 'b'])
```

Also test expired/zero lots are disabled and bypassing the oldest usable lot requires a non-empty reason.

- [ ] **Step 2: Implement schema and atomic fulfillment**

Generate `lab_stock_requisitions` migration. The RPC locks selected lots, validates total selected quantity, prevents negative balance, inserts negative movements, records allocations, and marks the request `fulfilled` exactly once.

- [ ] **Step 3: Implement request and fulfillment UI**

Managers submit desired fulfillment date and items. Stock officers see FIFO-ranked lots with lot, expiry, and balance; later-lot selection reveals a required reason. The form warns when projected on-hand crosses minimum but does not block urgent submission.

- [ ] **Step 4: Implement print view**

The semantic A4 page includes hospital/system title, document number/date, department, requester, requested and fulfilled quantities, lot/expiry, fulfillment date, and signature lines for stock issuer and receiving head. Embed Noto Sans Thai and apply `@page { size: A4; margin: 12mm; }`.

- [ ] **Step 5: Verify and commit**

```powershell
npx supabase db reset
npx tsx scripts/requisition-schema.test.ts
npx tsx scripts/fifo-domain.test.ts
npx tsx scripts/requisition-transaction.test.ts
npx tsx scripts/requisition-print.test.ts
npm run build
git add supabase lib/requisitions app/(protected)/requisitions components/requisitions scripts/requisition-*.test.ts scripts/fifo-domain.test.ts
git commit -m "feat: add FIFO requisitions fulfillment and print"
```

Expected: tests pass, fulfillment is idempotent, and print output fits A4 without clipped signature blocks.

---

### Task 9: Build Settings and Configurable Memberships

**Files:**
- Create: `app/(protected)/settings/access/page.tsx`
- Create: `components/settings/AccessMatrix.tsx`
- Create: `lib/access/actions.ts`, `lib/access/queries.ts`, `lib/access/schema.ts`
- Test: `scripts/access-policy.test.ts`, `scripts/access-ui.test.ts`

**Interfaces:**
- Produces: `listMemberships()`, `setMembership(profileId, role, active)`
- Consumes: `lab_stock_memberships` and `profiles`

- [ ] **Step 1: Write failing access tests**

Test that E-Phis 9495 always resolves admin, Manager always resolves head, 14812/11050 start as stock officers, non-admin cannot mutate memberships, and deactivating one membership changes access on the next server request.

- [ ] **Step 2: Implement admin-only actions**

```ts
export const membershipInputSchema = z.object({
  profileId: z.string().uuid(),
  role: z.enum(['admin', 'head', 'stock_officer', 'viewer', 'reporter']),
  active: z.boolean(),
})
```

Every change appends an audit event with actor, target profile, role, and before/after state.

- [ ] **Step 3: Implement the accessible matrix**

Provide profile search, current portal role, app roles, active toggle, and explicit save feedback. Do not use `role="tablist"` for filters; use buttons with `aria-pressed`.

- [ ] **Step 4: Verify and commit**

```powershell
npx tsx scripts/access-policy.test.ts
npx tsx scripts/access-ui.test.ts
npm run build
git add app/(protected)/settings components/settings lib/access scripts/access-*.test.ts
git commit -m "feat: add configurable LAB stock memberships"
```

Expected: tests pass and only Admin can change memberships.

---

### Task 10: Create the One-Time Google Sheets Import and Reconciliation

**Files:**
- Create via CLI: `supabase/migrations/*_lab_stock_import_staging.sql`
- Create: `lib/import/types.ts`, `normalize.ts`, `contracts.ts`, `items.ts`, `legacy-allocations.ts`, `report.ts`
- Create: `scripts/import-google-sheets.mts`, `scripts/reconcile-import.mts`
- Create: `fixtures/import/workbook-contracts.sample.json`, `fixtures/import/workbook-items.sample.json`
- Test: `scripts/import-normalization.test.ts`, `scripts/import-idempotency.test.ts`, `scripts/import-reconciliation.test.ts`

**Interfaces:**
- Produces: `normalizeLsCode(value)`, `classifySheetRow(row)`, `buildImportPlan(snapshot)`, `applyImportPlan(plan,dryRun)`
- Produces an immutable JSON reconciliation report with counts, conflicts, aliases, totals, and source coordinates

- [ ] **Step 1: Write failing normalization tests from observed data**

```ts
import assert from 'node:assert/strict'
import { classifySheetRow, normalizeLsCode } from '../lib/import/normalize'

assert.equal(normalizeLsCode(' ls046022 '), 'LS046022')
assert.equal(classifySheetRow({ lsCode: '', unit: 'บาท' }), 'contract_summary')
assert.equal(classifySheetRow({ lsCode: 'LS046022', unit: 'กล่อง' }), 'contract_item')
```

Fixtures include a name variant, a unit variant, a `#REF!` stock row, and horizontal purchase sequences.

- [ ] **Step 2: Implement deterministic planning**

Match contracts by normalized contract number plus identity fields, preserve aliases, separate summary/item rows, convert sequence columns to legacy allocations, and carry spreadsheet ID/tab/row/cell source metadata. Never import the broken stock-on-hand formulas.

- [ ] **Step 3: Implement dry run and physical opening-count flow**

The default command is dry-run:

```powershell
npx tsx scripts/import-google-sheets.mts --contracts-file .secure-import/contracts.xlsx --items-file .secure-import/items.xlsx --dry-run --output import-report.json
```

`--apply` requires an approved report hash. Opening stock is a separate CSV that creates `opening_adjustment` movements with approver and count date.

- [ ] **Step 4: Verify expected reconciliation**

Tests assert the observed baseline is recognized: 74 contract numbers, 289 item rows, 185 unique LS codes, and conflict reports for name/unit variants. Counts are comparison warnings rather than hard-coded production blockers if the source Sheets change before snapshot.

- [ ] **Step 5: Commit**

```powershell
npx tsx scripts/import-normalization.test.ts
npx tsx scripts/import-idempotency.test.ts
npx tsx scripts/import-reconciliation.test.ts
git add supabase lib/import scripts/import-*.ts scripts/import-*.mts scripts/reconcile-import.mts fixtures/import
git commit -m "feat: add one-time Sheets import and reconciliation"
```

Expected: tests pass and two dry runs produce byte-identical plans/reports.

---

### Task 11: Retire the Legacy Portal Contract Module Safely

**Files:**
- Modify: `../lab-management-portal/app/(protected)/staff/contracts/page.tsx`
- Modify: `../lab-management-portal/app/api/admin/contracts/route.ts`
- Modify: `../lab-management-portal/app/api/admin/contracts/[id]/route.ts`
- Modify: `../lab-management-portal/app/api/admin/contracts/[id]/usage/route.ts`
- Modify: `../lab-management-portal/app/api/admin/contracts/[id]/usage/[usageId]/route.ts`
- Modify: `../lab-management-portal/next.config.ts` or its environment helper
- Test: `../lab-management-portal/scripts/contracts-cutover.test.ts`

**Interfaces:**
- Consumes: `LABCBH_STOCK_URL`
- Produces: portal route redirect `/contracts` and HTTP 410 JSON for legacy write endpoints

- [ ] **Step 1: Write the failing cutover contract test**

```ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const page = readFileSync('app/(protected)/staff/contracts/page.tsx', 'utf8')
const api = readFileSync('app/api/admin/contracts/route.ts', 'utf8')
assert.match(page, /LABCBH_STOCK_URL/)
assert.match(page, /redirect/)
assert.match(api, /status:\s*410/)
assert.doesNotMatch(api, /\.from\('contracts'\)\.insert/)
```

- [ ] **Step 2: Implement redirect and write shutdown**

The page validates `LABCBH_STOCK_URL`, redirects to `<base>/contracts`, and falls back to a Thai migration notice if missing. GET endpoints may remain temporarily for reconciliation; POST/PATCH/DELETE and usage mutations return status 410 with `{ error: 'ย้ายการบริหารสัญญาไปยัง LABCBH-Stock แล้ว', url }`.

- [ ] **Step 3: Run portal verification**

```powershell
Set-Location '..\lab-management-portal'
npx tsx scripts/contracts-cutover.test.ts
npm run build
```

Expected: test and build pass; non-contract portal routes are unchanged.

- [ ] **Step 4: Commit in the portal repository**

```powershell
git add app/(protected)/staff/contracts app/api/admin/contracts scripts/contracts-cutover.test.ts next.config.ts
git commit -m "feat: hand contract management to LABCBH Stock"
```

---

### Task 12: Full Verification, Impeccable Audit, Deployment, and Cutover

**Files:**
- Create: `playwright.config.ts`
- Create: `tests/e2e/contracts.spec.ts`, `pr.spec.ts`, `receiving.spec.ts`, `requisitions.spec.ts`, `dashboard.spec.ts`
- Create: `vercel.ts`
- Create: `docs/runbooks/cutover.md`, `docs/runbooks/rollback.md`
- Modify: `package.json`

**Interfaces:**
- Produces npm scripts: `test:contracts`, `test:inventory`, `test:pr`, `test:receiving`, `test:requisitions`, `test:security`, `test:e2e`, `verify`

- [ ] **Step 1: Add end-to-end acceptance tests**

Each spec logs in as its assigned fixture user and asserts:

- Admin 9495 can perform all tasks and manage memberships.
- Manager creates contracts, PRs, and requisitions but cannot post receiving unless separately assigned.
- Stock officers 14812/11050 confirm PRs, receive lots, and fulfill requisitions.
- Contract number is required only at contract start.
- Concurrent contract allocation and lot fulfillment cannot oversubscribe.
- Dashboard ribbon/watchlist update after mutations.
- Requisition print renders A4 content and signature blocks.

- [ ] **Step 2: Add unified verification script**

```json
{
  "scripts": {
    "verify": "npm run lint && npm run typecheck && npm run test:contracts && npm run test:inventory && npm run test:pr && npm run test:receiving && npm run test:requisitions && npm run test:security && npm run test:e2e && npm run build",
    "typecheck": "tsc --noEmit",
    "test:e2e": "playwright test"
  }
}
```

- [ ] **Step 3: Run pre-delivery UX checks**

Run the required UI/UX search and Impeccable detector once after UI completion:

```powershell
python 'C:\Users\User\.codex\skills\ui-ux-pro-max\scripts\search.py' "animation accessibility z-index loading" --domain ux
node 'C:\Users\User\.agents\skills\impeccable\scripts\detect.mjs' --json app components
```

Fix all high-severity findings, then run `npm run verify`.

Expected: detector has no blocking findings and verification exits 0.

- [ ] **Step 4: Verify Supabase security and import in staging**

```powershell
npx supabase db advisors
npx supabase migration list
npx tsx scripts/import-google-sheets.mts --contracts-file .secure-import/contracts.xlsx --items-file .secure-import/items.xlsx --dry-run --output import-report.json
```

Expected: no new advisor errors, migration order is complete, and the dry-run report has no unresolved blocking collisions.

- [ ] **Step 5: Install/link Vercel CLI and pull environments**

User prerequisite:

```powershell
npm i -g vercel
```

Then:

```powershell
vercel --version
vercel link
vercel env pull .env.local --yes
```

Expected: LABCBH Stock links to its own Vercel project and environment names point to the same Supabase project as the portal. Never print secret values.

- [ ] **Step 6: Deploy preview and run smoke tests**

```powershell
vercel deploy
npm run test:e2e -- --grep "@smoke"
vercel logs
```

Expected: preview login, contract CRUD, PR confirm, receipt, requisition, print, and Dashboard smoke flows pass.

- [ ] **Step 7: Execute cutover**

Follow `docs/runbooks/cutover.md`:

1. announce a contract-editing freeze;
2. back up the database and export final Sheet snapshots;
3. apply migrations;
4. run approved import and reconciliation;
5. import approved physical opening count;
6. verify balances and permissions;
7. deploy LABCBH Stock production;
8. set `LABCBH_STOCK_URL` in the portal;
9. deploy the portal redirect/write shutdown;
10. run production smoke tests and release the freeze.

- [ ] **Step 8: Commit deployment assets**

```powershell
git add package.json playwright.config.ts tests/e2e vercel.ts docs/runbooks
git commit -m "chore: add verification deployment and cutover runbooks"
```

Expected: clean committed deployment/runbook changes; local `.env.local`, `.secure-import`, and generated reports remain untracked.
