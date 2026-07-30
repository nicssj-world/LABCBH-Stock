# Equipment Lease Budget Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the portal's equipment-lease budget management into LABCBH Stock so lease contracts are tracked in baht per month instead of by stock deduction.

**Architecture:** Contracts keep the existing six-stage procurement lifecycle. At `contract_started` behaviour forks on `contract_type`: `equipment_lease` uses budget mode (baht consumption in the existing `public.contract_usage`), every other type keeps the existing line-item allocation mode. A database trigger keeps the two modes mutually exclusive per contract.

**Tech Stack:** Next.js 16 App Router, TypeScript, Supabase Postgres + Storage, zod, Playwright, `tsx` for tests.

## Global Constraints

- Design spec: `docs/superpowers/specs/2026-07-30-equipment-lease-budget-design.md`. It governs; this plan implements it.
- Reuse `public.contract_usage`. Do not create a replacement table and do not migrate its 180 rows.
- Never delete anything from Cloudflare R2. Files are copied out, originals stay for rollback.
- All mutations go through a Postgres RPC invoked with `supabaseAdmin` (service role), matching `lib/contracts/actions.ts`. No table writes from application code.
- Thai user-facing copy, matching the tone already in `lib/contracts/presenter.ts` and `schema.ts`.
- Expiring threshold: months remaining ≤ 6 when `total > 10000000`, otherwise ≤ 3. No `end_date` is never expiring. Months are floored whole 30-day periods.
- Low budget threshold: remaining < 30% of `total`. Null `total` is never low; it is unknown.
- Money is `numeric(15,2)` in Postgres and a JS `number` at the boundary. Round to 2 decimals before comparing.
- Tests are `node:assert/strict` scripts run with `tsx`, registered in `package.json` and added to the `verify` chain.
- Schema and transaction tests assert against migration SQL text, matching `scripts/contracts-schema.test.ts`.

## File Structure

**Create**

| Path | Responsibility |
|---|---|
| `lib/contracts/budget.ts` | Pure budget math and mode selection. No I/O. |
| `lib/contracts/budget-queries.ts` | Read expense history and budget rollups. |
| `lib/contracts/budget-actions.ts` | Server actions for expense and responsible-user mutations. |
| `lib/contracts/files.ts` | Contract document upload, signed download, delete. |
| `lib/contracts/export.ts` | CSV and Excel serialisation of expense history. |
| `components/contracts/BudgetPanel.tsx` | Budget mode container: gauge, history, form. |
| `components/contracts/BudgetGauge.tsx` | Remaining-budget bar with warning state. |
| `components/contracts/ExpenseForm.tsx` | Add a monthly expense. |
| `components/contracts/ExpenseHistory.tsx` | Monthly history table plus export buttons. |
| `components/contracts/ContractFileCard.tsx` | Attach, download, remove the contract document. |
| `components/contracts/ResponsibleUserPicker.tsx` | Assign responsible users. |
| `supabase/migrations/20260730120000_lab_stock_contract_budget.sql` | Column, audit table, mode guard, bucket, policies. |
| `supabase/migrations/20260730120500_lab_stock_contract_budget_rpc.sql` | Expense and responsible-user RPCs. |
| `scripts/contract-budget-domain.test.ts` | Budget math and mode selection. |
| `scripts/contract-budget-schema.test.ts` | Migration shape. |
| `scripts/contract-budget-transaction.test.ts` | Locking and guard properties in RPC SQL. |
| `scripts/contract-files.test.ts` | Storage policy and path rules. |
| `scripts/migrate-contract-files.mts` | One-time R2 → Supabase Storage copy. |
| `tests/e2e/contract-budget.spec.ts` | Responsible-user recording, editor file attach. |

**Modify**

| Path | Change |
|---|---|
| `lib/contracts/schema.ts` | Make `items` conditional on contract type; add expense and responsible-user schemas. |
| `lib/contracts/types.ts` | Export the new inferred types. |
| `lib/contracts/authorization.ts` | Add `assertContractExpenseRecorder`. |
| `app/(protected)/contracts/[id]/page.tsx` | Render `BudgetPanel` in budget mode. |
| `components/contracts/ContractForm.tsx` | Add responsible-user picker; hide items for leases. |
| `lib/dashboard/contracts.ts` | Add expiring and low-budget watchlist. |
| `package.json` | Register the new test scripts. |

---

### Task 1: Budget math and mode selection

Pure functions first: everything later depends on these and none of them need a database.

**Files:**
- Create: `lib/contracts/budget.ts`
- Create: `scripts/contract-budget-domain.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `ContractType` from `lib/contracts/types`.
- Produces: `contractMode(contractType): 'budget' | 'supply'`; `normalizeUsageMonth(value: string): string | null`; `budgetSnapshot(input: BudgetSnapshotInput): BudgetSnapshot`; `monthsLeft(endDate: string | null, now?: Date): number`; `isExpiring(total, endDate, now?)`; `isLowBudget(total, used)`; `expenseMonthOptions(startDate, endDate): string[]`.

- [ ] **Step 1: Write the failing test**

```ts
// scripts/contract-budget-domain.test.ts
import assert from 'node:assert/strict'
import {
  budgetSnapshot,
  contractMode,
  expenseMonthOptions,
  isExpiring,
  isLowBudget,
  monthsLeft,
  normalizeUsageMonth,
} from '../lib/contracts/budget'

// Only equipment leases are tracked in baht. Everything else keeps line items.
assert.equal(contractMode('equipment_lease'), 'budget')
assert.equal(contractMode('e_bidding'), 'supply')
assert.equal(contractMode('awaiting_equipment_lease'), 'supply')

// A month is stored as its first day so two entries for the same month collide.
assert.equal(normalizeUsageMonth('2026-07'), '2026-07-01')
assert.equal(normalizeUsageMonth('2026-07-19'), '2026-07-01')
assert.equal(normalizeUsageMonth('2026-13'), null, 'month 13 is not a month')
assert.equal(normalizeUsageMonth('2026-00'), null)
assert.equal(normalizeUsageMonth('rubbish'), null)

// Remaining is rounded to satang before comparison so float drift cannot make
// an exactly-exhausted budget look like it has a fraction left.
const snap = budgetSnapshot({ total: 1000, entries: [{ amount: 333.33 }, { amount: 666.67 }] })
assert.equal(snap.used, 1000)
assert.equal(snap.remaining, 0)
assert.equal(snap.exhausted, true)
assert.equal(snap.percentUsed, 100)

// A contract with no total has an unknown budget, not a zero one.
const unknown = budgetSnapshot({ total: null, entries: [{ amount: 500 }] })
assert.equal(unknown.remaining, null)
assert.equal(unknown.percentUsed, null)
assert.equal(unknown.used, 500)

const now = new Date('2026-07-30T00:00:00Z')
// Large contracts get a longer runway because replacing them takes longer.
assert.equal(isExpiring(20_000_000, '2026-12-01', now), true, 'big contract, 4 months out')
assert.equal(isExpiring(5_000_000, '2026-12-01', now), false, 'small contract, 4 months out')
assert.equal(isExpiring(5_000_000, '2026-09-15', now), true, 'small contract, under 3 months')
assert.equal(isExpiring(5_000_000, null, now), false, 'no end date never expires')
assert.equal(monthsLeft(null, now), 999)

assert.equal(isLowBudget(1000, 701), true, 'under 30% remaining')
assert.equal(isLowBudget(1000, 700), false, 'exactly 30% is not low')
assert.equal(isLowBudget(null, 700), false, 'unknown total is not low')
assert.equal(isLowBudget(0, 0), false, 'zero total cannot be a ratio')

// Options are bounded by the contract term so nobody bills a month it did not cover.
assert.deepEqual(
  expenseMonthOptions('2026-05-10', '2026-08-20'),
  ['2026-05-01', '2026-06-01', '2026-07-01', '2026-08-01'],
)
assert.deepEqual(expenseMonthOptions(null, '2026-08-20'), [])

console.log('contract budget domain tests passed')
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx tsx scripts/contract-budget-domain.test.ts`
Expected: FAIL, cannot find module `../lib/contracts/budget`.

- [ ] **Step 3: Implement**

```ts
// lib/contracts/budget.ts
import type { ContractType } from '@/lib/contracts/types'

export type ContractMode = 'budget' | 'supply'

// Equipment leases are billed as a monthly baht draw against a ceiling. Every
// other contract type delivers goods and is tracked by line item instead.
export function contractMode(contractType: ContractType): ContractMode {
  return contractType === 'equipment_lease' ? 'budget' : 'supply'
}

export function normalizeUsageMonth(value: string): string | null {
  const match = /^(\d{4})-(\d{2})(?:-\d{2})?$/.exec(value.trim())
  if (!match) return null
  const month = Number(match[2])
  if (month < 1 || month > 12) return null
  return `${match[1]}-${match[2]}-01`
}

function satang(value: number): number {
  return Math.round(value * 100)
}

export interface BudgetSnapshotInput {
  total: number | null
  entries: { amount: number }[]
}

export interface BudgetSnapshot {
  used: number
  remaining: number | null
  percentUsed: number | null
  exhausted: boolean
}

export function budgetSnapshot({ total, entries }: BudgetSnapshotInput): BudgetSnapshot {
  const usedSatang = entries.reduce((sum, entry) => sum + satang(entry.amount), 0)
  const used = usedSatang / 100

  if (total === null || total === 0) {
    return { used, remaining: null, percentUsed: null, exhausted: false }
  }

  const totalSatang = satang(total)
  const remainingSatang = totalSatang - usedSatang
  return {
    used,
    remaining: remainingSatang / 100,
    percentUsed: (usedSatang / totalSatang) * 100,
    exhausted: remainingSatang <= 0,
  }
}

const MS_PER_MONTH = 1000 * 60 * 60 * 24 * 30

export function monthsLeft(endDate: string | null, now: Date = new Date()): number {
  if (!endDate) return 999
  return Math.floor((new Date(endDate).getTime() - now.getTime()) / MS_PER_MONTH)
}

// A larger contract needs more lead time to re-tender, so it warns earlier.
export function isExpiring(total: number | null, endDate: string | null, now: Date = new Date()): boolean {
  if (!endDate) return false
  const left = monthsLeft(endDate, now)
  return (total ?? 0) > 10_000_000 ? left <= 6 : left <= 3
}

export function isLowBudget(total: number | null, used: number): boolean {
  if (!total) return false
  return (satang(total) - satang(used)) / satang(total) < 0.3
}

export function expenseMonthOptions(startDate: string | null, endDate: string | null): string[] {
  if (!startDate || !endDate) return []
  const start = new Date(`${startDate.slice(0, 7)}-01T00:00:00Z`)
  const end = new Date(`${endDate.slice(0, 7)}-01T00:00:00Z`)
  const months: string[] = []
  for (let cursor = start; cursor <= end; cursor.setUTCMonth(cursor.getUTCMonth() + 1)) {
    months.push(cursor.toISOString().slice(0, 10))
  }
  return months
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx tsx scripts/contract-budget-domain.test.ts`
Expected: PASS, `contract budget domain tests passed`.

- [ ] **Step 5: Register the script**

In `package.json`, add to `scripts`:

```json
"test:contract-budget": "tsx scripts/contract-budget-domain.test.ts"
```

Add `npm run test:contract-budget` to the `verify` chain, immediately after `npm run test:contracts`.

- [ ] **Step 6: Commit**

```bash
git add lib/contracts/budget.ts scripts/contract-budget-domain.test.ts package.json
git commit -m "feat: add equipment lease budget math and contract mode selection"
```

---

### Task 2: Schema migration

**Files:**
- Create: `supabase/migrations/20260730120000_lab_stock_contract_budget.sql`
- Create: `scripts/contract-budget-schema.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `contract_usage.recorded_by_id`; `public.contract_responsible_audit`; trigger `contract_usage_mode_guard`; trigger `contract_items_mode_guard`; storage bucket `lab-stock-contracts`.

- [ ] **Step 1: Write the failing test**

```ts
// scripts/contract-budget-schema.test.ts
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const migrationsDir = join(process.cwd(), 'supabase', 'migrations')
const names = readdirSync(migrationsDir).filter((n) => n.endsWith('_lab_stock_contract_budget.sql'))
assert.equal(names.length, 1, 'exactly one contract budget migration must exist')
const sql = readFileSync(join(migrationsDir, names[0]), 'utf8')

// The 180 existing rows must survive: additive column only, never a new table.
assert.match(sql, /alter table public\.contract_usage\s+add column if not exists recorded_by_id uuid/i)
assert.ok(
  !/create table if not exists public\.lab_stock_contract_expenses/i.test(sql),
  'contract_usage is reused, not replaced',
)
assert.ok(!/drop table[^;]*contract_usage/i.test(sql), 'contract_usage must never be dropped')

// Granting someone the right to spend against a contract has to leave a trail.
assert.match(sql, /create table if not exists public\.contract_responsible_audit/i)
for (const column of ['contract_id', 'profile_id', 'actor_id', 'previous_assigned', 'next_assigned']) {
  assert.match(sql, new RegExp(`\\b${column}\\b`), `audit table needs ${column}`)
}
assert.match(sql, /contract_responsible_audit_append_only/i)

// A contract must never carry both a budget balance and an allocation balance.
assert.match(sql, /contract_usage_mode_guard/i)
assert.match(sql, /contract_items_mode_guard/i)
assert.match(sql, /equipment_lease/i)

// RLS everywhere, service_role writes, authenticated reads only.
assert.match(sql, /alter table public\.contract_responsible_audit enable row level security/i)
assert.match(sql, /revoke all on table public\.contract_responsible_audit from anon, authenticated/i)

// Contract documents live in their own private bucket.
assert.match(sql, /insert into storage\.buckets[\s\S]*lab-stock-contracts/i)
assert.match(sql, /'lab-stock-contracts',\s*'lab-stock-contracts',\s*false/i)

console.log('contract budget schema tests passed')
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx tsx scripts/contract-budget-schema.test.ts`
Expected: FAIL on the migration count assertion.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260730120000_lab_stock_contract_budget.sql
--
-- Equipment leases are billed monthly in baht, not drawn down as stock. The
-- portal already tracks this in public.contract_usage and has two years of
-- history there, so this migration extends that table rather than replacing it.
begin;

-- recorded_by holds a display name copied at write time. New rows get a real
-- identity; the text column stays so existing history keeps its attribution.
alter table public.contract_usage
  add column if not exists recorded_by_id uuid references public.profiles(id) on delete set null;

create index if not exists contract_usage_contract_month_idx
  on public.contract_usage (contract_id, usage_month desc);
create index if not exists contract_usage_recorded_by_id_idx
  on public.contract_usage (recorded_by_id) where recorded_by_id is not null;

-- Being listed on a contract is the right to spend against it, so changes are
-- recorded the same way membership changes are.
create table if not exists public.contract_responsible_audit (
  id uuid primary key default gen_random_uuid(),
  contract_id bigint not null references public.contracts(id) on delete restrict,
  profile_id uuid not null references public.profiles(id) on delete restrict,
  actor_id uuid references public.profiles(id) on delete restrict,
  previous_assigned boolean,
  next_assigned boolean not null,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists contract_responsible_audit_contract_idx
  on public.contract_responsible_audit (contract_id, created_at desc);
create index if not exists contract_responsible_audit_profile_idx
  on public.contract_responsible_audit (profile_id, created_at desc);

drop trigger if exists contract_responsible_audit_append_only on public.contract_responsible_audit;
create trigger contract_responsible_audit_append_only
before update or delete on public.contract_responsible_audit
for each row execute function public.prevent_append_only_mutation();

-- Refuse to install the guard against data it would already reject. Production
-- has no such contract today - all 16 leases carry zero line items - but that
-- must be proven at apply time, not assumed, or the migration half-applies and
-- leaves a table nobody can write to.
do $preflight$
declare
  conflicting bigint;
begin
  select count(*) into conflicting
  from public.contracts contract
  where (
    contract.contract_type = 'equipment_lease'
    and exists (select 1 from public.contract_items item where item.contract_id = contract.id)
  ) or (
    contract.contract_type is distinct from 'equipment_lease'
    and exists (select 1 from public.contract_usage usage where usage.contract_id = contract.id)
  );

  if conflicting > 0 then
    raise exception using
      errcode = '23514',
      message = format('%s contract(s) already mix budget and line-item tracking', conflicting),
      hint = 'reclassify those contracts before installing the mode guard';
  end if;
end
$preflight$;

-- The two tracking models are mutually exclusive. Allowing both on one contract
-- would produce a budget balance and an allocation balance that disagree, with
-- no way to say which is the truth.
create or replace function public.guard_contract_tracking_mode()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  target_type text;
begin
  -- Both contract_usage and contract_items carry contract_id, so one lookup
  -- serves both triggers.
  select contract.contract_type into target_type
  from public.contracts contract
  where contract.id = new.contract_id;

  if tg_argv[0] = 'usage' and target_type is distinct from 'equipment_lease' then
    raise exception using
      errcode = '23514',
      message = 'budget entries are only valid on an equipment lease contract';
  end if;

  if tg_argv[0] = 'items' and target_type = 'equipment_lease' then
    raise exception using
      errcode = '23514',
      message = 'an equipment lease contract is tracked by budget and cannot hold line items';
  end if;

  return new;
end
$function$;

revoke execute on function public.guard_contract_tracking_mode() from public;
revoke execute on function public.guard_contract_tracking_mode() from anon;
revoke execute on function public.guard_contract_tracking_mode() from authenticated;

drop trigger if exists contract_usage_mode_guard on public.contract_usage;
create trigger contract_usage_mode_guard
before insert or update on public.contract_usage
for each row execute function public.guard_contract_tracking_mode('usage');

drop trigger if exists contract_items_mode_guard on public.contract_items;
create trigger contract_items_mode_guard
before insert or update on public.contract_items
for each row execute function public.guard_contract_tracking_mode('items');

alter table public.contract_responsible_audit enable row level security;
alter table public.contract_usage enable row level security;

revoke all on table public.contract_responsible_audit from anon, authenticated;
grant select on table public.contract_responsible_audit to authenticated;
grant select, insert on table public.contract_responsible_audit to service_role;

grant select, insert, update, delete on table public.contract_usage to service_role;

drop policy if exists contract_responsible_audit_app_read on public.contract_responsible_audit;
create policy contract_responsible_audit_app_read
on public.contract_responsible_audit for select
to authenticated
using (
  exists (
    select 1
    from public.lab_stock_memberships membership
    join public.profiles membership_profile on membership_profile.id = membership.profile_id
    where membership.profile_id = (select auth.uid())
      and membership.active
      and membership.role in ('admin', 'head')
      and membership_profile.status = 'active'
      and membership_profile.deleted_at is null
  )
);

-- Contract documents, separate from the lab-stock-po receiving evidence.
insert into storage.buckets (id, name, public)
values ('lab-stock-contracts', 'lab-stock-contracts', false)
on conflict (id) do update set public = false;

update storage.buckets
set file_size_limit = 10485760,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
where id = 'lab-stock-contracts';

commit;
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx tsx scripts/contract-budget-schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Apply it to a throwaway database and prove it works**

Docker is available. Reproduce the harness from `docs/runbooks/rollback-rehearsal.md`, apply every migration in order, and confirm the guard fires:

```bash
docker run -d --name budget-check -e POSTGRES_PASSWORD=postgres -p 55434:5432 postgres:17
# apply base + all migrations, then:
docker exec budget-check psql -U postgres -c \
  "insert into public.contract_usage (contract_id, amount) values (1, 100);"
```

Expected: the insert succeeds for an `equipment_lease` contract and fails with
`an equipment lease contract is tracked by budget and cannot hold line items`
when a line item is inserted against that same contract. Remove the container
afterwards with `docker rm -f budget-check`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260730120000_lab_stock_contract_budget.sql scripts/contract-budget-schema.test.ts package.json
git commit -m "feat: add contract budget schema, responsible-user audit, and mode guard"
```

---

### Task 3: Expense and responsible-user RPCs

**Files:**
- Create: `supabase/migrations/20260730120500_lab_stock_contract_budget_rpc.sql`
- Create: `scripts/contract-budget-transaction.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `assert_contract_expense_actor(p_actor_id uuid, p_contract_id bigint)`; `record_contract_expense(p_actor_id, p_contract_id, p_amount, p_usage_month, p_usage_date, p_note)`; `delete_contract_expense(p_actor_id, p_usage_id)`; `set_contract_responsible_users(p_actor_id, p_contract_id, p_profile_ids uuid[], p_note)`.

- [ ] **Step 1: Write the failing test**

```ts
// scripts/contract-budget-transaction.test.ts
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The portal enforced the over-budget rule inside an API handler, where two
 * simultaneous requests each read the same remaining balance and both passed.
 * Moving the check into the RPC is only a fix if it runs under a lock on the
 * contract row, in the same transaction as the insert. That is what this
 * asserts, alongside the permission union the workflow depends on.
 */
const migrationsDir = join(process.cwd(), 'supabase', 'migrations')
const names = readdirSync(migrationsDir).filter((n) => n.endsWith('_lab_stock_contract_budget_rpc.sql'))
assert.equal(names.length, 1)
const sql = readFileSync(join(migrationsDir, names[0]), 'utf8')
const compact = sql.replace(/\s+/g, ' ')

// The contract row is locked before the remaining balance is computed.
assert.match(compact, /from public\.contracts contract where contract\.id = p_contract_id for update/i)
const lockAt = compact.search(/for update/i)
const sumAt = compact.search(/coalesce\(sum\(usage\.amount\), 0\)/i)
assert.ok(lockAt >= 0 && sumAt > lockAt, 'the lock must be taken before the total is summed')

// Insert happens in the same function, so it cannot be separated from the check.
assert.match(compact, /insert into public\.contract_usage/i)
assert.match(compact, /raise exception[^;]*errcode = '23514'/i)

// Responsible users can record against their own contract without being editors.
assert.match(sql, /create or replace function public\.assert_contract_expense_actor/i)
assert.match(compact, /responsible_user_ids/i)
assert.match(compact, /assert_contract_editor_actor/i)

// Reassignment writes an audit row per added and per removed person.
assert.match(sql, /create or replace function public\.set_contract_responsible_users/i)
assert.match(compact, /insert into public\.contract_responsible_audit/i)

// Only the service role may execute these.
for (const fn of [
  'assert_contract_expense_actor',
  'record_contract_expense',
  'delete_contract_expense',
  'set_contract_responsible_users',
]) {
  assert.match(sql, new RegExp(`revoke execute on function public\\.${fn}[^;]*from authenticated`, 'i'))
  assert.match(sql, new RegExp(`grant execute on function public\\.${fn}[^;]*to service_role`, 'i'))
}

console.log('contract budget transaction tests passed')
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx tsx scripts/contract-budget-transaction.test.ts`
Expected: FAIL on the migration count assertion.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260730120500_lab_stock_contract_budget_rpc.sql
--
-- Writes for budget mode. The over-budget check runs under a lock on the
-- contract row so two concurrent entries cannot both see the same remaining
-- balance and both pass, which is how the portal's handler-level check failed.
begin;

-- Editors may record against any contract. Anyone named on a contract may
-- record against that contract only: the people doing this day to day are
-- Medical Technologists who hold no editor role.
create or replace function public.assert_contract_expense_actor(
  p_actor_id uuid,
  p_contract_id bigint
)
returns void
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if exists (
    select 1
    from public.contracts contract
    join public.profiles profile on profile.id = p_actor_id
    where contract.id = p_contract_id
      and profile.status = 'active'
      and profile.deleted_at is null
      and p_actor_id = any (coalesce(contract.responsible_user_ids, '{}'::uuid[]))
  ) then
    return;
  end if;

  perform public.assert_contract_editor_actor(p_actor_id);
end
$function$;

create or replace function public.record_contract_expense(
  p_actor_id uuid,
  p_contract_id bigint,
  p_amount numeric,
  p_usage_month date,
  p_usage_date date default null,
  p_note text default null
)
returns public.contract_usage
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  target_contract public.contracts%rowtype;
  committed numeric(15,2);
  actor_name text;
  inserted public.contract_usage%rowtype;
begin
  perform public.assert_contract_expense_actor(p_actor_id, p_contract_id);

  if p_amount is null or p_amount <= 0 then
    raise exception using errcode = '23514', message = 'จำนวนเงินต้องมากกว่า 0';
  end if;

  if p_usage_month is null then
    raise exception using errcode = '23502', message = 'กรุณาระบุเดือนที่ใช้จ่าย';
  end if;

  if date_trunc('month', p_usage_month)::date <> p_usage_month then
    raise exception using errcode = '22007', message = 'เดือนที่ใช้จ่ายต้องเป็นวันที่ 1 ของเดือน';
  end if;

  -- This lock is the whole point: it serialises every expense on this contract.
  select contract.* into target_contract
  from public.contracts contract
  where contract.id = p_contract_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'ไม่พบสัญญา';
  end if;

  if target_contract.contract_type is distinct from 'equipment_lease' then
    raise exception using errcode = '23514', message = 'สัญญานี้ไม่ได้ตัดงบเป็นรายเดือน';
  end if;

  if target_contract.start_date is not null and p_usage_month < date_trunc('month', target_contract.start_date)::date then
    raise exception using errcode = '22007', message = 'เดือนที่ใช้จ่ายอยู่ก่อนวันเริ่มสัญญา';
  end if;

  if target_contract.end_date is not null and p_usage_month > date_trunc('month', target_contract.end_date)::date then
    raise exception using errcode = '22007', message = 'เดือนที่ใช้จ่ายอยู่หลังวันสิ้นสุดสัญญา';
  end if;

  select coalesce(sum(usage.amount), 0) into committed
  from public.contract_usage usage
  where usage.contract_id = p_contract_id;

  if target_contract.total is not null and committed + p_amount > target_contract.total then
    raise exception using
      errcode = '23514',
      message = format(
        'จำนวนเงินเกินมูลค่าคงเหลือ (คงเหลือ %s บาท)',
        to_char(target_contract.total - committed, 'FM999,999,999.00')
      );
  end if;

  select profile.name into actor_name from public.profiles profile where profile.id = p_actor_id;

  insert into public.contract_usage (
    contract_id, amount, note, recorded_by, recorded_by_id, usage_date, usage_month
  ) values (
    p_contract_id,
    p_amount,
    nullif(btrim(p_note), ''),
    actor_name,
    p_actor_id,
    coalesce(p_usage_date, current_date),
    p_usage_month
  )
  returning * into inserted;

  return inserted;
end
$function$;

create or replace function public.delete_contract_expense(
  p_actor_id uuid,
  p_usage_id bigint
)
returns void
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  target_contract_id bigint;
begin
  select usage.contract_id into target_contract_id
  from public.contract_usage usage
  where usage.id = p_usage_id;

  if target_contract_id is null then
    raise exception using errcode = 'P0002', message = 'ไม่พบรายการค่าใช้จ่าย';
  end if;

  perform public.assert_contract_expense_actor(p_actor_id, target_contract_id);

  delete from public.contract_usage where id = p_usage_id;
end
$function$;

create or replace function public.set_contract_responsible_users(
  p_actor_id uuid,
  p_contract_id bigint,
  p_profile_ids uuid[],
  p_note text default null
)
returns public.contracts
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  previous uuid[];
  next_ids uuid[];
  updated public.contracts%rowtype;
  candidate uuid;
begin
  perform public.assert_contract_editor_actor(p_actor_id);

  next_ids := coalesce(p_profile_ids, '{}'::uuid[]);

  if exists (
    select 1 from unnest(next_ids) as wanted(id)
    left join public.profiles profile on profile.id = wanted.id
    where profile.id is null or profile.status <> 'active' or profile.deleted_at is not null
  ) then
    raise exception using errcode = '23503', message = 'มีผู้รับผิดชอบที่ไม่ใช่ผู้ใช้งานที่ใช้งานอยู่';
  end if;

  select contract.responsible_user_ids into previous
  from public.contracts contract
  where contract.id = p_contract_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'ไม่พบสัญญา';
  end if;

  previous := coalesce(previous, '{}'::uuid[]);

  update public.contracts
  set responsible_user_ids = next_ids
  where id = p_contract_id
  returning * into updated;

  foreach candidate in array (select array(select unnest(next_ids) except select unnest(previous))) loop
    insert into public.contract_responsible_audit
      (contract_id, profile_id, actor_id, previous_assigned, next_assigned, note)
    values (p_contract_id, candidate, p_actor_id, false, true, nullif(btrim(p_note), ''));
  end loop;

  foreach candidate in array (select array(select unnest(previous) except select unnest(next_ids))) loop
    insert into public.contract_responsible_audit
      (contract_id, profile_id, actor_id, previous_assigned, next_assigned, note)
    values (p_contract_id, candidate, p_actor_id, true, false, nullif(btrim(p_note), ''));
  end loop;

  return updated;
end
$function$;

revoke execute on function public.assert_contract_expense_actor(uuid, bigint) from public, anon, authenticated;
grant execute on function public.assert_contract_expense_actor(uuid, bigint) to service_role;

revoke execute on function public.record_contract_expense(uuid, bigint, numeric, date, date, text) from public, anon, authenticated;
grant execute on function public.record_contract_expense(uuid, bigint, numeric, date, date, text) to service_role;

revoke execute on function public.delete_contract_expense(uuid, bigint) from public, anon, authenticated;
grant execute on function public.delete_contract_expense(uuid, bigint) to service_role;

revoke execute on function public.set_contract_responsible_users(uuid, bigint, uuid[], text) from public, anon, authenticated;
grant execute on function public.set_contract_responsible_users(uuid, bigint, uuid[], text) to service_role;

commit;
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx tsx scripts/contract-budget-transaction.test.ts`
Expected: PASS.

- [ ] **Step 5: Prove the concurrency guard against a real database**

Using the throwaway container from Task 2, open two `psql` sessions against one
`equipment_lease` contract with `total = 1000` and no expenses. In both, run
`begin; select record_contract_expense(<actor>, <id>, 600, '2026-07-01');`
without committing, then commit both.

Expected: the first commits, the second raises `จำนวนเงินเกินมูลค่าคงเหลือ`.
Record the output in the commit message. Remove the container afterwards.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260730120500_lab_stock_contract_budget_rpc.sql scripts/contract-budget-transaction.test.ts package.json
git commit -m "feat: add contract expense RPCs with locked over-budget check"
```

---

### Task 4: Contract input schema accepts leases

`createContractInputSchema` currently requires `items.min(1)`, so an equipment lease cannot be created at all. This must land before any lease UI.

**Files:**
- Modify: `lib/contracts/schema.ts`
- Modify: `lib/contracts/types.ts`
- Modify: `scripts/contract-budget-domain.test.ts`

**Interfaces:**
- Produces: `contractExpenseInputSchema`; `responsibleUsersInputSchema`; `ContractExpenseInput`; `ResponsibleUsersInput`. `createContractInputSchema` gains conditional item validation.

- [ ] **Step 1: Extend the test**

Append to `scripts/contract-budget-domain.test.ts`:

```ts
import { contractExpenseInputSchema, createContractInputSchema } from '../lib/contracts/schema'

const leaseBase = {
  fiscalYear: 2569,
  contractType: 'equipment_lease' as const,
  displayName: 'เช่าเครื่อง CBC',
  vendor: 'Firmer',
  endDate: '2027-06-30',
  sentToProcurementDate: '2026-07-01',
}

// A lease has no line items, and demanding one made it impossible to create.
assert.doesNotThrow(() => createContractInputSchema.parse({ ...leaseBase, items: [] }))
assert.throws(
  () => createContractInputSchema.parse({ ...leaseBase, contractType: 'e_bidding', items: [] }),
  /ต้องมีรายการน้ำยาอย่างน้อย 1 รายการ/,
  'a supply contract still requires items',
)

assert.throws(
  () => contractExpenseInputSchema.parse({ contractId: 1, amount: 0, usageMonth: '2026-07-01' }),
  /จำนวนเงินต้องมากกว่า 0/,
)
assert.doesNotThrow(() =>
  contractExpenseInputSchema.parse({ contractId: 1, amount: 1500.5, usageMonth: '2026-07-01' }),
)
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx tsx scripts/contract-budget-domain.test.ts`
Expected: FAIL, `createContractInputSchema` rejects the empty `items` array.

- [ ] **Step 3: Implement**

In `lib/contracts/schema.ts`, relax the array and enforce the rule in a refinement so the message is unchanged for supply contracts:

```ts
export const contractExpenseInputSchema = z
  .object({
    contractId: z.number().int().positive(),
    amount: z.number().finite().positive('จำนวนเงินต้องมากกว่า 0'),
    usageMonth: isoDateSchema,
    usageDate: isoDateSchema.nullable().optional(),
    note: z.string().trim().max(500).nullable().optional(),
  })
  .strict()

export const responsibleUsersInputSchema = z
  .object({
    contractId: z.number().int().positive(),
    profileIds: z.array(z.string().uuid()),
    note: z.string().trim().max(500).nullable().optional(),
  })
  .strict()
```

Change `items` in `createContractInputSchema` from `.min(1, ...)` to a plain
`z.array(contractLineInputSchema)`, then add to the existing `.strict()` chain:

```ts
  .superRefine((value, ctx) => {
    // Equipment leases are billed in baht and never carry line items.
    if (value.contractType === 'equipment_lease') {
      if (value.items.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['items'],
          message: 'สัญญาเช่าเครื่องไม่มีรายการน้ำยา',
        })
      }
      return
    }
    if (value.items.length < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['items'],
        message: 'ต้องมีรายการน้ำยาอย่างน้อย 1 รายการ',
      })
    }
  })
```

In `lib/contracts/types.ts` add:

```ts
export type ContractExpenseInput = z.infer<typeof contractExpenseInputSchema>
export type ResponsibleUsersInput = z.infer<typeof responsibleUsersInputSchema>
```

and add both schema names to the existing `import type { ... } from './schema'` list.

- [ ] **Step 4: Run it and watch it pass**

Run: `npx tsx scripts/contract-budget-domain.test.ts && npm run test:contracts && npm run typecheck`
Expected: all PASS. `test:contracts` catches any caller that relied on the old rule.

- [ ] **Step 5: Commit**

```bash
git add lib/contracts/schema.ts lib/contracts/types.ts scripts/contract-budget-domain.test.ts
git commit -m "fix: allow equipment lease contracts to be created without line items"
```

---

### Task 5: Authorization and server actions

**Files:**
- Modify: `lib/contracts/types.ts`
- Modify: `lib/contracts/queries.ts`
- Modify: `lib/contracts/authorization.ts`
- Create: `lib/contracts/budget-actions.ts`
- Create: `lib/contracts/budget-queries.ts`

**Interfaces:**
- Consumes: `contractExpenseInputSchema`, `responsibleUsersInputSchema` (Task 4); `record_contract_expense`, `delete_contract_expense`, `set_contract_responsible_users` (Task 3).
- Produces: `ContractRecord.total` and `ContractRecord.responsibleUserIds`; `assertContractExpenseRecorder(actor, contract)`; server actions `recordContractExpense`, `deleteContractExpense`, `setResponsibleUsers`; `fetchContractBudget(contractId, total)` returning `{ entries: ContractExpenseRecord[]; snapshot: BudgetSnapshot }`.

- [ ] **Step 1: Carry the two columns the budget needs**

`ContractRecord` exposes neither `total` nor `responsibleUserIds` today, so
nothing downstream can compute a remaining balance or decide who may record.
Both columns already exist on `public.contracts`.

In `lib/contracts/types.ts`, add to `ContractRecord`:

```ts
  total: number | null
  responsibleUserIds: string[]
```

In `lib/contracts/queries.ts`, add `total` and `responsible_user_ids` to the
contract `select` list and map them in the row transformer:

```ts
  total: row.total === null ? null : Number(row.total),
  responsibleUserIds: row.responsible_user_ids ?? [],
```

Run `npm run typecheck`. Every construction site of `ContractRecord` — including
test fixtures — will fail until it supplies both fields. Fix each one; a lease
fixture should carry a real `total` so the budget path is exercised.

- [ ] **Step 2: Add the authorization guard**

```ts
// lib/contracts/authorization.ts — append
export class ContractExpenseAuthorizationError extends Error {
  constructor() {
    super('ไม่มีสิทธิ์บันทึกค่าใช้จ่ายของสัญญานี้')
    this.name = 'ContractExpenseAuthorizationError'
  }
}

// Mirrors assert_contract_expense_actor so the UI hides what the database would
// refuse. The database remains the authority.
export function assertContractExpenseRecorder(
  actor: Actor,
  contract: { responsibleUserIds: string[] },
): void {
  if (hasAppRole(actor, 'admin', 'head')) return
  if (contract.responsibleUserIds.includes(actor.id)) return
  throw new ContractExpenseAuthorizationError()
}
```

- [ ] **Step 3: Write the queries module**

```ts
// lib/contracts/budget-queries.ts
import 'server-only'
import { budgetSnapshot, type BudgetSnapshot } from '@/lib/contracts/budget'
import { supabaseAdmin } from '@/lib/supabase/admin'

export interface ContractExpenseRecord {
  id: number
  amount: number
  note: string | null
  recordedBy: string | null
  usageDate: string | null
  usageMonth: string | null
  createdAt: string
}

export async function fetchContractBudget(
  contractId: number,
  total: number | null,
): Promise<{ entries: ContractExpenseRecord[]; snapshot: BudgetSnapshot }> {
  const { data, error } = await supabaseAdmin
    .from('contract_usage')
    .select('id,amount,note,recorded_by,usage_date,usage_month,created_at')
    .eq('contract_id', contractId)
    .order('usage_month', { ascending: false, nullsFirst: false })
    .order('usage_date', { ascending: false, nullsFirst: false })

  if (error) throw new Error(`โหลดค่าใช้จ่ายไม่สำเร็จ: ${error.message}`)

  const entries: ContractExpenseRecord[] = (data ?? []).map((row) => ({
    id: Number(row.id),
    amount: Number(row.amount),
    note: row.note,
    recordedBy: row.recorded_by,
    usageDate: row.usage_date,
    usageMonth: row.usage_month,
    createdAt: row.created_at,
  }))

  return { entries, snapshot: budgetSnapshot({ total, entries }) }
}
```

- [ ] **Step 4: Write the server actions**

```ts
// lib/contracts/budget-actions.ts
'use server'

import { revalidatePath } from 'next/cache'
import { requireActor } from '@/lib/auth/actor'
import {
  contractExpenseInputSchema,
  responsibleUsersInputSchema,
} from '@/lib/contracts/schema'
import type { ContractExpenseInput, ResponsibleUsersInput } from '@/lib/contracts/types'
import { supabaseAdmin } from '@/lib/supabase/admin'

function unwrap(operation: string, result: { error: { message: string } | null }) {
  if (result.error) throw new Error(`${operation}ไม่สำเร็จ: ${result.error.message}`)
}

export async function recordContractExpense(input: ContractExpenseInput) {
  const actor = await requireActor()
  const parsed = contractExpenseInputSchema.parse(input)

  // Authorisation lives in the RPC: it is the only place that can see the
  // contract's responsible users atomically with the write.
  const result = await supabaseAdmin.rpc('record_contract_expense', {
    p_actor_id: actor.id,
    p_contract_id: parsed.contractId,
    p_amount: parsed.amount,
    p_usage_month: parsed.usageMonth,
    p_usage_date: parsed.usageDate ?? null,
    p_note: parsed.note ?? null,
  })
  unwrap('บันทึกค่าใช้จ่าย', result)

  revalidatePath(`/contracts/${parsed.contractId}`)
  revalidatePath('/dashboard')
}

export async function deleteContractExpense(contractId: number, usageId: number) {
  const actor = await requireActor()
  const result = await supabaseAdmin.rpc('delete_contract_expense', {
    p_actor_id: actor.id,
    p_usage_id: usageId,
  })
  unwrap('ลบค่าใช้จ่าย', result)

  revalidatePath(`/contracts/${contractId}`)
  revalidatePath('/dashboard')
}

export async function setResponsibleUsers(input: ResponsibleUsersInput) {
  const actor = await requireActor()
  const parsed = responsibleUsersInputSchema.parse(input)

  const result = await supabaseAdmin.rpc('set_contract_responsible_users', {
    p_actor_id: actor.id,
    p_contract_id: parsed.contractId,
    p_profile_ids: parsed.profileIds,
    p_note: parsed.note ?? null,
  })
  unwrap('บันทึกผู้รับผิดชอบ', result)

  revalidatePath(`/contracts/${parsed.contractId}`)
}
```

- [ ] **Step 5: Verify**

Run: `npm run typecheck && npm run lint`
Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add lib/contracts/authorization.ts lib/contracts/budget-actions.ts lib/contracts/budget-queries.ts
git commit -m "feat: add contract expense queries, actions, and recorder authorization"
```

---

### Task 6: Export to CSV and Excel

**Files:**
- Create: `lib/contracts/export.ts`
- Modify: `scripts/contract-budget-domain.test.ts`

**Interfaces:**
- Consumes: `ContractExpenseRecord` from `lib/contracts/budget-queries`.
- Produces: `expenseCsv(rows): string`; `expenseSheetXml(contract, rows): string`.

- [ ] **Step 1: Extend the test**

```ts
import { expenseCsv } from '../lib/contracts/export'

const csv = expenseCsv([
  { id: 1, amount: 1500.5, note: 'ค่าเช่า, กรกฎาคม', recordedBy: 'พลอย นารี',
    usageDate: '2026-07-05', usageMonth: '2026-07-01', createdAt: '2026-07-05T00:00:00Z' },
])
// A note containing a comma must not shift the columns.
assert.match(csv, /"ค่าเช่า, กรกฎาคม"/)
assert.equal(csv.split('\n')[0], 'เดือน,วันที่,จำนวนเงิน,ผู้บันทึก,หมายเหตุ')
// Excel reads UTF-8 CSV as mojibake without a BOM.
assert.ok(csv.startsWith('﻿'), 'CSV needs a BOM for Excel')
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx tsx scripts/contract-budget-domain.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// lib/contracts/export.ts
import type { ContractExpenseRecord } from '@/lib/contracts/budget-queries'

function cell(value: string | number | null): string {
  const text = value === null ? '' : String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function expenseCsv(rows: ContractExpenseRecord[]): string {
  const header = 'เดือน,วันที่,จำนวนเงิน,ผู้บันทึก,หมายเหตุ'
  const body = rows.map((row) =>
    [
      cell(row.usageMonth?.slice(0, 7) ?? ''),
      cell(row.usageDate),
      cell(row.amount.toFixed(2)),
      cell(row.recordedBy),
      cell(row.note),
    ].join(','),
  )
  // Excel assumes the system codepage unless the file opens with a BOM.
  return `﻿${[header, ...body].join('\n')}`
}
```

```ts
// lib/contracts/export.ts — continued
function xml(value: string | null): string {
  return (value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/**
 * SpreadsheetML keeps this dependency-free. A real .xlsx would mean pulling in
 * a zip writer to produce a file Excel opens either way.
 */
export function expenseSheetXml(
  contract: { contractNumber: string | null; displayName: string | null },
  rows: ContractExpenseRecord[],
): string {
  const header = ['เดือน', 'วันที่', 'จำนวนเงิน', 'ผู้บันทึก', 'หมายเหตุ']
    .map((label) => `<Cell><Data ss:Type="String">${xml(label)}</Data></Cell>`)
    .join('')

  const body = rows
    .map((row) =>
      `<Row>` +
      `<Cell><Data ss:Type="String">${xml(row.usageMonth?.slice(0, 7) ?? '')}</Data></Cell>` +
      `<Cell><Data ss:Type="String">${xml(row.usageDate)}</Data></Cell>` +
      `<Cell><Data ss:Type="Number">${row.amount.toFixed(2)}</Data></Cell>` +
      `<Cell><Data ss:Type="String">${xml(row.recordedBy)}</Data></Cell>` +
      `<Cell><Data ss:Type="String">${xml(row.note)}</Data></Cell>` +
      `</Row>`,
    )
    .join('')

  const title = xml(contract.contractNumber ?? contract.displayName ?? 'contract')

  return `<?xml version="1.0" encoding="UTF-8"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Worksheet ss:Name="${title}"><Table><Row>${header}</Row>${body}</Table></Worksheet>
</Workbook>`
}
```

Serve it as `application/vnd.ms-excel`. Add to the Step 1 test:

```ts
import { expenseSheetXml } from '../lib/contracts/export'

const sheet = expenseSheetXml({ contractNumber: '150/69', displayName: null }, [
  { id: 1, amount: 1500.5, note: 'a & b', recordedBy: 'พลอย', usageDate: '2026-07-05',
    usageMonth: '2026-07-01', createdAt: '2026-07-05T00:00:00Z' },
])
assert.match(sheet, /ss:Name="150\/69"/)
assert.match(sheet, /a &amp; b/, 'ampersands must be escaped or Excel rejects the file')
assert.match(sheet, /<Data ss:Type="Number">1500\.50<\/Data>/)
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx tsx scripts/contract-budget-domain.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/contracts/export.ts scripts/contract-budget-domain.test.ts
git commit -m "feat: export contract expense history to CSV and Excel"
```

---

### Task 7: Contract document storage

**Files:**
- Create: `lib/contracts/files.ts`
- Create: `scripts/contract-files.test.ts`
- Create: `components/contracts/ContractFileCard.tsx`
- Modify: `package.json`

**Interfaces:**
- Produces: `CONTRACT_FILE_BUCKET`; `contractFilePath(contractId, filename)`; server actions `uploadContractFile`, `removeContractFile`, `contractFileUrl`.

- [ ] **Step 1: Write the failing test**

```ts
// scripts/contract-files.test.ts
import assert from 'node:assert/strict'
import { CONTRACT_FILE_BUCKET, contractFilePath } from '../lib/contracts/files'

assert.equal(CONTRACT_FILE_BUCKET, 'lab-stock-contracts')

// Paths are namespaced per contract so one contract cannot overwrite another's.
const path = contractFilePath(19, 'สัญญา 150/69.pdf')
assert.ok(path.startsWith('contracts/19/'), path)
// Slashes and spaces in the original name must not create directories.
assert.ok(!path.slice('contracts/19/'.length).includes('/'), 'filename must be flattened')
assert.match(path, /\.pdf$/)

console.log('contract file tests passed')
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx tsx scripts/contract-files.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// lib/contracts/files.ts
'use server'

import { revalidatePath } from 'next/cache'
import { requireActor } from '@/lib/auth/actor'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const CONTRACT_FILE_BUCKET = 'lab-stock-contracts'

const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']

/**
 * One folder per contract. The filename is flattened rather than escaped: a
 * name containing a slash would otherwise create a nested path and escape the
 * folder the storage policy keys on.
 */
export function contractFilePath(contractId: number, filename: string): string {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_')
  return `contracts/${contractId}/${Date.now()}-${safe}`
}

export async function uploadContractFile(contractId: number, formData: FormData) {
  const actor = await requireActor()

  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) {
    throw new Error('กรุณาเลือกไฟล์สัญญา')
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    throw new Error('รองรับเฉพาะ PDF และรูปภาพ')
  }

  const path = contractFilePath(contractId, file.name)

  const { error: uploadError } = await supabaseAdmin.storage
    .from(CONTRACT_FILE_BUCKET)
    .upload(path, file, { upsert: true, contentType: file.type })

  if (uploadError) throw new Error(`อัปโหลดไฟล์สัญญาไม่สำเร็จ: ${uploadError.message}`)

  // Authorisation lives in the RPC so the storage write cannot be the only gate.
  const result = await supabaseAdmin.rpc('set_contract_file', {
    p_actor_id: actor.id,
    p_contract_id: contractId,
    p_file_url: path,
  })
  if (result.error) throw new Error(`บันทึกไฟล์สัญญาไม่สำเร็จ: ${result.error.message}`)

  revalidatePath(`/contracts/${contractId}`)
  return { path }
}

/** Private document, read through a short-lived signed URL, never a public one. */
export async function contractFileUrl(contractId: number, path: string) {
  await requireActor()
  const { data, error } = await supabaseAdmin.storage
    .from(CONTRACT_FILE_BUCKET)
    .createSignedUrl(path, 300)

  if (error) throw new Error(`สร้างลิงก์ดาวน์โหลดไม่สำเร็จ: ${error.message}`)
  return data.signedUrl
}

export async function removeContractFile(contractId: number) {
  const actor = await requireActor()

  const result = await supabaseAdmin.rpc('set_contract_file', {
    p_actor_id: actor.id,
    p_contract_id: contractId,
    p_file_url: null,
  })
  if (result.error) throw new Error(`ลบไฟล์สัญญาไม่สำเร็จ: ${result.error.message}`)

  // The stored object is deliberately left in place: detaching is reversible,
  // deleting is not, and orphans in a private bucket are harmless.
  revalidatePath(`/contracts/${contractId}`)
}
```

Add `set_contract_file(p_actor_id uuid, p_contract_id bigint, p_file_url text)`
to the Task 3 RPC migration, guarded by `assert_contract_editor_actor` and
granted to `service_role` only, following the pattern of the other RPCs there.
`ContractFileCard.tsx` follows `components/receipts/PoImageUploader.tsx`.

- [ ] **Step 4: Run it and watch it pass**

Run: `npx tsx scripts/contract-files.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Register and commit**

Add `"test:contract-files": "tsx scripts/contract-files.test.ts"` to `package.json`
and to the `verify` chain.

```bash
git add lib/contracts/files.ts scripts/contract-files.test.ts components/contracts/ContractFileCard.tsx package.json
git commit -m "feat: attach contract documents to Supabase Storage"
```

---

### Task 8: Copy the nine documents out of R2

**Files:**
- Create: `scripts/migrate-contract-files.mts`

**Interfaces:**
- Consumes: `CONTRACT_FILE_BUCKET`, `contractFilePath` (Task 7).

- [ ] **Step 1: Write the script**

It must be re-runnable without duplicating work, must never delete from R2, and
must report a per-file result. Read R2 credentials from the environment
(`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`) —
they live in the portal's environment and are needed once, not at runtime.
Support `--dry-run` and default to it.

For each contract with a non-null `file_url` that does not already point at a
`contracts/` Supabase path: fetch the object from R2, upload it to
`lab-stock-contracts` at `contractFilePath(contract.id, basename)`, then update
`contracts.file_url` to the new path. Print `id`, old key, new path, and bytes.

- [ ] **Step 2: Dry-run against production**

Run: `node scripts/migrate-contract-files.mts --dry-run`
Expected: exactly 9 contracts listed, no writes performed. Confirm the count
matches the 9 recorded in the design spec.

- [ ] **Step 3: Verify idempotency**

Run the dry run twice. Expected: identical output both times.

- [ ] **Step 4: Commit**

```bash
git add scripts/migrate-contract-files.mts
git commit -m "feat: add one-time R2 to Supabase Storage copy for contract documents"
```

---

### Task 9: Budget panel UI

**Files:**
- Create: `components/contracts/BudgetGauge.tsx`
- Create: `components/contracts/ExpenseForm.tsx`
- Create: `components/contracts/ExpenseHistory.tsx`
- Create: `components/contracts/BudgetPanel.tsx`
- Modify: `app/(protected)/contracts/[id]/page.tsx`

**Interfaces:**
- Consumes: `fetchContractBudget` (Task 5), `budgetSnapshot`/`expenseMonthOptions`/`contractMode` (Task 1), `recordContractExpense`/`deleteContractExpense` (Task 5), `expenseCsv` (Task 6), `ContractFileCard` (Task 7).

- [ ] **Step 1: Build the gauge**

`BudgetGauge` takes `{ snapshot: BudgetSnapshot; warn: boolean }`. When
`snapshot.remaining` is `null` it renders "ไม่ระบุมูลค่าสัญญา" rather than a
0% bar — a lease with no total has an unknown budget, not an exhausted one.
Follow the existing component styling; do not port the portal's inline styles.

- [ ] **Step 2: Build the form**

`ExpenseForm` takes `{ contractId, startDate, endDate, remaining, canRecord }`.
The month select is populated from `expenseMonthOptions(startDate, endDate)`.
Client-side it blocks an amount above `remaining`; the RPC is still the
authority and its error surfaces verbatim. Hidden entirely when `canRecord` is
false.

- [ ] **Step 3: Build the history table**

`ExpenseHistory` takes `{ entries, canRecord }` and renders month, date, amount,
recorder, and note, newest first, plus CSV and Excel download buttons. Delete is
shown only when `canRecord`.

- [ ] **Step 4: Compose and wire the page**

`BudgetPanel` composes gauge, form, history, and `ContractFileCard`. In
`app/(protected)/contracts/[id]/page.tsx`, render it only when
`contractMode(contract.contractType) === 'budget'`, and keep the existing
line-item panel for supply mode. Compute `canRecord` with
`assertContractExpenseRecorder` wrapped in a try/catch, or a boolean predicate
alongside it.

- [ ] **Step 5: Verify**

Run: `npm run lint && npm run typecheck && npm run build`
Expected: all clean.

- [ ] **Step 6: Commit**

```bash
git add components/contracts/BudgetGauge.tsx components/contracts/ExpenseForm.tsx components/contracts/ExpenseHistory.tsx components/contracts/BudgetPanel.tsx "app/(protected)/contracts/[id]/page.tsx"
git commit -m "feat: add equipment lease budget panel to the contract page"
```

---

### Task 10: Responsible users in the contract form

**Files:**
- Create: `components/contracts/ResponsibleUserPicker.tsx`
- Modify: `components/contracts/ContractForm.tsx`

**Interfaces:**
- Consumes: `setResponsibleUsers` (Task 5), `contractMode` (Task 1).

- [ ] **Step 1: Build the picker**

Searchable multi-select over active profiles, showing name and role. Selection
is a `string[]` of profile ids.

- [ ] **Step 2: Wire it into the form**

Add the picker to `ContractForm`. Hide the line-item editor when
`contractMode(contractType) === 'budget'` — Task 4 made items invalid for a
lease, so leaving the editor visible would offer input the schema rejects.

- [ ] **Step 3: Verify**

Run: `npm run lint && npm run typecheck && npm run build`
Expected: all clean.

- [ ] **Step 4: Commit**

```bash
git add components/contracts/ResponsibleUserPicker.tsx components/contracts/ContractForm.tsx
git commit -m "feat: assign contract responsible users from the contract form"
```

---

### Task 11: Dashboard watchlist

**Files:**
- Modify: `lib/dashboard/contracts.ts`
- Modify: the dashboard page that consumes it

**Interfaces:**
- Consumes: `isExpiring`, `isLowBudget`, `budgetSnapshot` (Task 1).

- [ ] **Step 1: Extend the query**

Add expiring and low-budget lease contracts to the existing dashboard contract
query, sorted most urgent first. Low budget requires the usage sum, so aggregate
`contract_usage` per contract in the same round trip rather than per row.

- [ ] **Step 2: Surface them**

Render the two groups in the existing dashboard watchlist section, matching the
surrounding components.

- [ ] **Step 3: Verify**

Run: `npm run lint && npm run typecheck && npm run build`
Expected: all clean.

- [ ] **Step 4: Commit**

```bash
git add lib/dashboard/contracts.ts
git commit -m "feat: surface expiring and low-budget leases on the dashboard"
```

---

### Task 12: End-to-end smoke

**Files:**
- Create: `tests/e2e/contract-budget.spec.ts`
- Modify: `docs/runbooks/e2e-staging.md`

**Interfaces:**
- Consumes: the fixture helpers in `tests/e2e/support.ts`.

- [ ] **Step 1: Write the spec**

Follow `tests/e2e/receiving.spec.ts` for structure. Cover the behaviour that
distinguishes this feature: a responsible user who holds no editor role records
an expense successfully, and an over-budget amount is refused with the RPC's
message. Requires a new fixture URL `E2E_LEASE_CONTRACT_URL` and a responsible
non-editor fixture account.

- [ ] **Step 2: Seed the fixture**

Extend `scripts/staging-seed-receipt-draft.mjs`, or add a sibling script, to
create an `equipment_lease` contract on Staging with a known `total` and a
responsible user who is not an editor.

- [ ] **Step 3: Run it**

Run the suite per `docs/runbooks/e2e-staging.md` — production build,
`--workers=1`, absolute fixture URLs.
Expected: the new spec passes alongside the existing five.

- [ ] **Step 4: Document the new fixture**

Add `E2E_LEASE_CONTRACT_URL` to the runbook's variable list and to
`.env.example`.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/contract-budget.spec.ts docs/runbooks/e2e-staging.md .env.example
git commit -m "test: cover responsible-user expense recording end to end"
```

---

## Final verification

- [ ] `npm run verify` passes end to end.
- [ ] The rollback script covers the new objects. `supabase/rollback/20260730_rollback_lab_stock.sql` drops tables and functions by name; add `contract_responsible_audit`, `guard_contract_tracking_mode`, `assert_contract_expense_actor`, `record_contract_expense`, `delete_contract_expense`, and `set_contract_responsible_users`, and drop the two mode-guard triggers plus `contract_usage.recorded_by_id`. **Do not drop `contract_usage` itself.** Re-run the rehearsal in `docs/runbooks/rollback-rehearsal.md` and confirm the round trip is still identical.
- [ ] Update `docs/runbooks/cutover.md`: the file copy in Task 8 is a new cutover step, and it must run before the portal is pointed at the stock system.
