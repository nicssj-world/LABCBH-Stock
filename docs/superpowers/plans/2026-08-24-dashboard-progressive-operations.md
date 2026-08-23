# Progressive Operations Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ทำให้ Watchlist ของ Dashboard รองรับข้อมูลจำนวนมากด้วย preview 5 รายการ, batch disclosure ครั้งละ 10 รายการ, responsive task cards และ server read boundary โดยคงส่วนบนตามภาพที่ผู้ใช้อนุมัติไว้เหมือนเดิม

**Architecture:** แยกชนิดข้อมูลและ pagination ของ Watchlist เป็น pure read-model helpers ที่ทดสอบได้, ให้ `getExecutiveDashboard` ส่งเฉพาะ preview พร้อม total/next offset และให้ API route ที่อยู่หลัง authenticated session ส่ง batch ถัดไปผ่าน RLS เดิม. Client component `DashboardWatchlist` รับ preview, จัดการ expanded/loading/error/focus และเรียก API เฉพาะเมื่อผู้ใช้กดดูเพิ่ม; page เดิมยังคงเป็น Server Component และไม่ย้ายสูตร KPI ไป client.

**Tech Stack:** Next.js 16 App Router, React 19 client component, TypeScript 5, Supabase SSR/RLS, NextResponse, Zod, CSS ใน `app/globals.css`, `tsx` static/runtime scripts

## Global Constraints

- ส่วนบนของ Dashboard ตามภาพที่ผู้ใช้อนุมัติแล้วต้องคงเดิม: heading, quick actions, KPI cards และ scope toggle
- Admin/เจ้าหน้าที่คลังเห็นภาพรวมและดำเนินการตามสิทธิ์เดิม; Manager เห็นภาพรวมทั้งหมดแบบ read-only และ action ที่เปลี่ยนข้อมูลต้องถูกตรวจโดย authorization เดิม
- ใช้ authenticated SSR read และ RLS; ห้ามใช้ service-role ใน browser และห้ามคำนวณยอดใหม่ใน client effect
- Watchlist เรียง `remainingPercent` ต่ำสุดก่อน และใช้ stable identifiers เป็น tie-breaker
- Preview เริ่มที่ 5 รายการ; batch เพิ่มครั้งละ 10 รายการ; ไม่มี nested scroll ภายใน Watchlist
- รองรับ 0, 1–5, 6–50 และ 51–500 รายการโดยไม่ส่งทุกรายการใน first paint
- ทุก control มีพื้นที่กดอย่างน้อย 44px, visible focus, keyboard support, semantic text และไม่พึ่งสีอย่างเดียว
- ใช้ Noto Sans Thai สำหรับข้อความ, DM Mono สำหรับ identifiers/tabular figures, 4/8px spacing rhythm และ motion ที่เคารพ `prefers-reduced-motion`
- ห้ามเปลี่ยนสูตรยอดสัญญา, threshold ต่ำกว่า 30%, lease budget logic, procurement stages, role model, RLS policy หรือ workflow mutation
- ห้ามแก้ไฟล์ค้างที่ไม่เกี่ยวข้องใน worktree; ทุก commit ต้อง stage เฉพาะไฟล์ของ task นั้น

---

### Task 1: Extract and test the bounded Watchlist read model

**Files:**
- Create: `lib/dashboard/types.ts`
- Create: `lib/dashboard/watchlist.ts`
- Modify: `lib/dashboard/contracts.ts`
- Modify: `components/dashboard/ContractValueCards.tsx:4`
- Test: `scripts/dashboard-watchlist.test.ts`

**Interfaces:**
- `lib/dashboard/types.ts` produces `DashboardWatchItem`, `DashboardLeaseWatchItem`, `ContractValueScope`, `ExecutiveDashboard`, and `DashboardWatchlistPage` without importing `server-only`, so client components can import the types.
- `lib/dashboard/watchlist.ts` produces:

```ts
export const DEFAULT_WATCHLIST_LIMIT = 5
export const WATCHLIST_BATCH_LIMIT = 10

export function compareDashboardWatchItems(
  left: DashboardWatchItem,
  right: DashboardWatchItem,
): number

export function paginateDashboardWatchlist(
  items: DashboardWatchItem[],
  offset: number,
  limit: number,
): DashboardWatchlistPage
```

- `getExecutiveDashboard(options?: { watchlistOffset?: number; watchlistLimit?: number })` returns the existing KPI/lease/pipeline/type-mix values plus only the requested Watchlist slice, `watchlistTotal`, `watchlistOffset`, `watchlistLimit`, and `watchlistNextOffset`.

- [ ] **Step 1: Write the failing pure pagination test.** Add fixtures with remaining percentages `0`, `10`, `10`, and `27`, then assert deterministic ordering and offsets:

```ts
import assert from 'node:assert/strict'
import { paginateDashboardWatchlist, compareDashboardWatchItems } from '@/lib/dashboard/watchlist'

const items = [
  { contractId: 2, lsCode: 'B', remainingPercent: 10 },
  { contractId: 1, lsCode: 'C', remainingPercent: 10 },
  { contractId: 1, lsCode: 'A', remainingPercent: 0 },
  { contractId: 3, lsCode: 'D', remainingPercent: 27 },
].map((item) => ({
  ...item,
  contractName: 'Contract', fiscalYear: 2569, name: item.lsCode, unit: 'test',
  contractedQuantity: 100, allocatedQuantity: 100 - item.remainingPercent,
  remainingQuantity: item.remainingPercent, remainingValue: item.remainingPercent,
}))

const ordered = [...items].sort(compareDashboardWatchItems)
assert.deepEqual(ordered.map((item) => item.lsCode), ['A', 'C', 'B', 'D'])
assert.deepEqual(paginateDashboardWatchlist(ordered, 0, 2).items.map((item) => item.lsCode), ['A', 'C'])
assert.equal(paginateDashboardWatchlist(ordered, 0, 2).nextOffset, 2)
assert.equal(paginateDashboardWatchlist(ordered, 2, 2).nextOffset, null)
console.log('dashboard watchlist pagination: ok')
```

- [ ] **Step 2: Run the test and confirm it fails because the helper module is absent.**

Run: `npx tsx scripts/dashboard-watchlist.test.ts`

Expected: FAIL with a module-not-found error for `@/lib/dashboard/watchlist`.

- [ ] **Step 3: Create the shared types and pure helpers.** Move the existing dashboard interfaces from `lib/dashboard/contracts.ts` into `lib/dashboard/types.ts`, add the pagination fields to `ExecutiveDashboard`, and implement the comparator with this exact tie-break order:

```ts
export function compareDashboardWatchItems(left: DashboardWatchItem, right: DashboardWatchItem) {
  return left.remainingPercent - right.remainingPercent
    || left.contractId - right.contractId
    || left.lsCode.localeCompare(right.lsCode, 'en')
}

export function paginateDashboardWatchlist(items: DashboardWatchItem[], offset: number, limit: number) {
  const safeOffset = Math.max(0, Math.trunc(offset))
  const safeLimit = Math.max(1, Math.trunc(limit))
  const sorted = [...items].sort(compareDashboardWatchItems)
  const pageItems = sorted.slice(safeOffset, safeOffset + safeLimit)
  const nextOffset = safeOffset + pageItems.length < sorted.length
    ? safeOffset + pageItems.length
    : null
  return {
    items: pageItems,
    totalCount: sorted.length,
    offset: safeOffset,
    limit: safeLimit,
    nextOffset,
  }
}
```

Update `lib/dashboard/contracts.ts` to import the types and helpers, keep all current Supabase/RLS and KPI formulas intact, sort the computed full Watchlist through `paginateDashboardWatchlist`, and return the requested slice. Default the options to `watchlistOffset: 0` and `watchlistLimit: DEFAULT_WATCHLIST_LIMIT`; do not change lease sorting or any totals.

Update `components/dashboard/ContractValueCards.tsx` to import `ContractValueScope` from `@/lib/dashboard/types` after the type extraction; this is type-only and does not change the locked top UI.

- [ ] **Step 4: Run the pure test and the existing contract UI test.**

Run: `npx tsx scripts/dashboard-watchlist.test.ts; npx tsx scripts/contracts-ui.test.ts`

Expected: both commands pass; the existing dashboard regexes still find `getExecutiveDashboard`, the watchlist heading, and the scope switcher.

- [ ] **Step 5: Commit the read-model seam.**

```powershell
git add -- lib/dashboard/types.ts lib/dashboard/watchlist.ts lib/dashboard/contracts.ts components/dashboard/ContractValueCards.tsx scripts/dashboard-watchlist.test.ts
git commit -m "feat: add bounded dashboard watchlist read model"
```

### Task 2: Add the authenticated Watchlist batch endpoint

**Files:**
- Create: `app/api/dashboard/watchlist/route.ts`
- Modify: `lib/dashboard/contracts.ts`
- Test: `scripts/dashboard-watchlist.test.ts`

**Interfaces:**
- `GET /api/dashboard/watchlist?offset=5&limit=10` returns JSON matching `DashboardWatchlistPage`:

```json
{
  "items": [],
  "totalCount": 0,
  "offset": 5,
  "limit": 10,
  "nextOffset": null
}
```

- `getDashboardWatchlistPage({ offset, limit })` calls the existing authenticated dashboard read, reuses `paginateDashboardWatchlist`, and does not expose KPI data or unbounded rows to the browser.

- [ ] **Step 1: Add failing route contract assertions.** Extend `scripts/dashboard-watchlist.test.ts` to read the route and assert it contains `getActor`, `searchParams`, `limit`, `offset`, `401`, `NextResponse.json`, and the `getDashboardWatchlistPage` call.

- [ ] **Step 2: Run the route assertions and confirm they fail because the route is absent.**

Run: `npx tsx scripts/dashboard-watchlist.test.ts`

Expected: FAIL on the route file read/assertion.

- [ ] **Step 3: Implement the read-only route.** Use `getActor()` and return `401` when there is no authenticated actor. Parse `offset` as an integer `>= 0`, parse `limit` as an integer from `1` to `10`, defaulting to `offset=5` and `limit=10`; return `422` for invalid query values. Call `getDashboardWatchlistPage`, return `NextResponse.json(page, { headers: { 'Cache-Control': 'private, no-store' } })`, and return a Thai `500` error without leaking service credentials or stack traces.

```ts
export async function GET(request: Request) {
  try {
    const actor = await getActor()
    if (!actor) return NextResponse.json({ error: 'กรุณาเข้าสู่ระบบ' }, { status: 401 })

    const url = new URL(request.url)
    const offset = parseNonNegativeInteger(url.searchParams.get('offset'), 5)
    const limit = parseBoundedInteger(url.searchParams.get('limit'), 10, 1, 10)
    if (offset === null || limit === null) {
      return NextResponse.json({ error: 'พารามิเตอร์รายการไม่ถูกต้อง' }, { status: 422 })
    }

    const page = await getDashboardWatchlistPage({ offset, limit })
    return NextResponse.json(page, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch {
    return NextResponse.json({ error: 'อ่านรายการติดตามไม่สำเร็จ' }, { status: 500 })
  }
}
```

Keep `parseNonNegativeInteger` and `parseBoundedInteger` local to the route or export them from a small pure helper only if the test needs them; do not add a new dependency.

- [ ] **Step 4: Run the route/static tests and typecheck the new endpoint.**

Run: `npx tsx scripts/dashboard-watchlist.test.ts; npm run typecheck`

Expected: PASS with no route/type errors.

- [ ] **Step 5: Commit the endpoint.**

```powershell
git add -- app/api/dashboard/watchlist/route.ts lib/dashboard/contracts.ts scripts/dashboard-watchlist.test.ts
git commit -m "feat: expose authenticated dashboard watchlist batches"
```

### Task 3: Build the client disclosure component

**Files:**
- Create: `components/dashboard/DashboardWatchlist.tsx`
- Modify: `scripts/dashboard-watchlist.test.ts`

**Interfaces:**

```ts
export interface DashboardWatchlistProps {
  initialItems: DashboardWatchItem[]
  totalCount: number
  nextOffset: number | null
}

export function DashboardWatchlist(props: DashboardWatchlistProps): JSX.Element
```

- [ ] **Step 1: Add failing component contract assertions.** Assert the component is a client component and contains `แสดงเพิ่มเติม`, `ยุบรายการ`, `aria-expanded`, `/api/dashboard/watchlist`, `aria-live`, `prefers`-safe loading class, and a retry path.

- [ ] **Step 2: Run the assertions and confirm the component is absent.**

Run: `npx tsx scripts/dashboard-watchlist.test.ts`

Expected: FAIL on the component file read/assertion.

- [ ] **Step 3: Implement `DashboardWatchlist`.** Keep the current row semantics (`identifier`, contract/item identity, remaining percentage/quantity, progress track, and `เปิดสัญญา` link), but move row mapping into this component. Use `useState` for `items`, `expanded`, `nextOffset`, `isLoading`, and `error`; use `useRef` for the first newly appended row; use `useRouter`, `usePathname`, and `useSearchParams` to add/remove `watchlist=expanded` with `router.replace(..., { scroll: false })`.

Required behavior:

```tsx
const PREVIEW_COUNT = 5
const BATCH_SIZE = 10

async function loadMore() {
  if (isLoading || nextOffset === null) return
  setIsLoading(true)
  setError(null)
  const response = await fetch(`/api/dashboard/watchlist?offset=${nextOffset}&limit=${BATCH_SIZE}`, {
    headers: { Accept: 'application/json' },
  })
  if (!response.ok) throw new Error('โหลดรายการเพิ่มเติมไม่สำเร็จ')
  const page = (await response.json()) as DashboardWatchlistPage
  setItems((current) => [...current, ...page.items])
  setNextOffset(page.nextOffset)
  setIsLoading(false)
}
```

Wrap the fetch in `try/catch/finally` so failed batches preserve rows already rendered and expose a `ลองใหม่` button. On successful append, focus the first new `<li tabIndex={-1}>` without moving the page unexpectedly. On collapse, set `items` back to `initialItems`, restore `nextOffset` from props, clear the error, and remove the query parameter.

Render:

- `แสดง X จาก Y รายการ` in an `aria-live="polite"` summary
- `แสดงเพิ่มเติม` only when `nextOffset !== null`, with `aria-expanded={expanded}` and `aria-controls`
- `ยุบรายการ` when `expanded` and more than the preview is visible
- `แสดงครบแล้ว · แสดง N จาก N รายการ` when no batch remains
- an inline loading message/skeleton with `aria-busy="true"`
- a retry control adjacent to the failed batch message
- the existing empty body when `totalCount === 0`

Do not add mutation actions or alter the locked top quick-action links.

- [ ] **Step 4: Run component contract tests and typecheck.**

Run: `npx tsx scripts/dashboard-watchlist.test.ts; npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit the disclosure component.**

```powershell
git add -- components/dashboard/DashboardWatchlist.tsx scripts/dashboard-watchlist.test.ts
git commit -m "feat: add progressive dashboard watchlist disclosure"
```

### Task 4: Integrate the preview into the Dashboard without touching the locked top

**Files:**
- Modify: `app/(protected)/dashboard/page.tsx`
- Modify: `scripts/dashboard-watchlist.test.ts`

**Interfaces:**
- `DashboardPage` calls `getExecutiveDashboard({ watchlistLimit: 5 })`.
- `DashboardContent` passes `data.watchlist`, `data.watchlistTotal`, and `data.watchlistNextOffset` to `DashboardWatchlist`.

- [ ] **Step 1: Add failing integration assertions.** Assert the page calls `getExecutiveDashboard({ watchlistLimit: 5 })`, renders `DashboardWatchlist`, uses `watchlistTotal` for the status chip, and still contains the exact locked top labels and quick-action paths.

- [ ] **Step 2: Run the assertions and confirm the current page fails the new preview contract.**

Run: `npx tsx scripts/dashboard-watchlist.test.ts`

Expected: FAIL until the page is wired to the preview fields/component.

- [ ] **Step 3: Replace only the Watchlist body mapping.** Keep the surrounding `bench-panel`, heading, `StatusChip` tone, lease panel, pipeline panel, Contract Mix, heading copy, KPI cards, scope toggle, and quick-action links unchanged. Replace the inline `data.watchlist.length === 0`/`<ol>` body with:

```tsx
<DashboardWatchlist
  initialItems={data.watchlist}
  totalCount={data.watchlistTotal}
  nextOffset={data.watchlistNextOffset}
/>
```

Change the Watchlist header chip to use `data.watchlistTotal`, so a preview of 5 from 50 is not misreported as 5 total. Keep `DashboardContent` as a server-rendered function and import `ExecutiveDashboard` as a type from `lib/dashboard/types`.

- [ ] **Step 4: Run static integration tests and the existing contract UI suite.**

Run: `npx tsx scripts/dashboard-watchlist.test.ts; npx tsx scripts/contracts-ui.test.ts`

Expected: PASS; all locked top strings/paths remain present.

- [ ] **Step 5: Commit the page integration.**

```powershell
git add -- 'app/(protected)/dashboard/page.tsx' scripts/dashboard-watchlist.test.ts
git commit -m "feat: render dashboard watchlist preview"
```

### Task 5: Apply responsive disclosure and focus styling

**Files:**
- Modify: `app/globals.css`
- Modify: `scripts/dashboard-watchlist.test.ts`

**Interfaces:**
- New classes are scoped to `.dashboard-watchlist-*` and existing `.watchlist*` selectors; no broad token or top KPI rules are changed.
- Desktop retains the approved 2/3 + 1/3 operations layout. Tablet stacks Watchlist → Lease → Pipeline → Contract Mix. Mobile uses one-column task cards and no horizontal overflow.

- [ ] **Step 1: Add failing CSS contract assertions.** Assert the stylesheet contains named grid areas for `.dashboard-operations`, a `.dashboard-watchlist__disclosure` block with a 44px minimum target, a focus-visible rule, and mobile rules for `.watchlist li`/`.dashboard-watchlist__disclosure`.

- [ ] **Step 2: Run the assertions and confirm the new selectors are absent.**

Run: `npx tsx scripts/dashboard-watchlist.test.ts`

Expected: FAIL until the scoped CSS is added.

- [ ] **Step 3: Append scoped rules after the existing Dashboard refinement block.** Add the following behavior without changing the top surface:

```css
.dashboard-operations {
  grid-template-areas: "watchlist lease" "watchlist pipeline";
}
.dashboard-operations .watchlist-panel { grid-area: watchlist; }
.dashboard-operations .lease-watchlist-panel { grid-area: lease; }
.dashboard-operations .pipeline-panel { grid-area: pipeline; }
.watchlist li { min-width: 0; }
.watchlist__identity strong { white-space: normal; overflow-wrap: anywhere; }
.watchlist li:focus-visible { outline: 3px solid var(--lab-focus); outline-offset: -3px; }
.dashboard-watchlist__disclosure {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 64px;
  padding: 12px 20px 16px;
  border-top: 1px solid var(--lab-border);
}
.dashboard-watchlist__button { min-height: 44px; }
.dashboard-watchlist__status { color: var(--lab-muted); font-size: 11px; }
.dashboard-watchlist__error { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; color: var(--lab-red); }

@media (max-width: 1180px) {
  .dashboard-operations { grid-template-areas: "watchlist" "lease" "pipeline"; }
}
@media (max-width: 540px) {
  .dashboard-watchlist__disclosure { align-items: stretch; flex-direction: column; padding-inline: 16px; }
  .dashboard-watchlist__button { width: 100%; }
  .watchlist li { min-height: 0; padding-block: 16px; }
}
```

Ensure any animation used for loading is disabled by the existing `prefers-reduced-motion` rule; do not add gradients, decorative shadows, or color-only status meaning.

- [ ] **Step 4: Run CSS contract assertions and lint.**

Run: `npx tsx scripts/dashboard-watchlist.test.ts; npm run lint`

Expected: PASS with no new lint errors. Existing unrelated worktree edits may still appear in the lint scope; do not rewrite them as part of this task.

- [ ] **Step 5: Commit the scoped styling.**

```powershell
git add -- app/globals.css scripts/dashboard-watchlist.test.ts
git commit -m "style: support scalable dashboard watchlist layout"
```

### Task 6: Run focused verification and visual quality gates

**Files:**
- Test: `scripts/dashboard-watchlist.test.ts`
- Test: `tests/e2e/dashboard.spec.ts` (only if the existing smoke fixture can assert the preview chip without creating data)
- Verify: changed Dashboard files and `app/globals.css`

- [ ] **Step 1: Run focused tests.**

Run: `npx tsx scripts/dashboard-watchlist.test.ts; npx tsx scripts/contracts-ui.test.ts; npm run typecheck; npm run lint`

Expected: all focused scripts, typecheck, and lint pass.

- [ ] **Step 2: Run the production build.**

Run: `npm run build`

Expected: Next.js production build completes without type, route, or client/server boundary errors.

- [ ] **Step 3: Run Impeccable's required detector once over changed UI targets.**

Run:

```powershell
node 'C:\Users\User\.agents\skills\impeccable\scripts\detect.mjs' --json 'components/dashboard/DashboardWatchlist.tsx' 'app/(protected)/dashboard/page.tsx' 'app/globals.css'
```

Expected: inspect the JSON for actionable a11y/layout findings; make one bounded correction pass only if it reports a defect in the changed selectors.

- [ ] **Step 4: Run the dashboard E2E smoke when fixtures are available.**

Run: `npx playwright test tests/e2e/dashboard.spec.ts`

Expected: the existing dashboard heading/watchlist smoke passes, or the test skips with its documented fixture reason.

- [ ] **Step 5: Inspect the final diff and worktree boundaries.**

Run: `git diff --check HEAD~6..HEAD; git status --short; git diff --stat HEAD~6..HEAD`

Expected: only the dashboard implementation commits are included in the implementation diff; pre-existing PR-related working-tree changes remain untouched and uncommitted.

- [ ] **Step 6: Commit any final bounded correction.**

```powershell
git add -- lib/dashboard/types.ts lib/dashboard/watchlist.ts lib/dashboard/contracts.ts app/api/dashboard/watchlist/route.ts components/dashboard/DashboardWatchlist.tsx 'app/(protected)/dashboard/page.tsx' app/globals.css scripts/dashboard-watchlist.test.ts
git commit -m "fix: polish dashboard watchlist verification findings"
```

Do not use a broad `git add .`, reset, checkout, or destructive cleanup because the worktree contains unrelated user changes.
