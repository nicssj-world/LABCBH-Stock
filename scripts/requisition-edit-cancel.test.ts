import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { canManageRequisition } from '../lib/requisitions/authorization'
import type { Actor, LabStockRole } from '../lib/auth/actor'

/**
 * Editing and cancelling a requisition.
 *
 * The whole feature rests on one fact about this domain: stock is deducted
 * when the officer dispenses, not when the requisition is raised. That is why
 * a waiting requisition can be rewritten or withdrawn without any compensating
 * ledger entry — and why neither is allowed once it has been fulfilled. The
 * first section below pins that fact down, because if it ever stopped being
 * true these two RPCs would start losing stock silently.
 */

const migrationsDir = join(process.cwd(), 'supabase', 'migrations')
const readMigration = (suffix: string) => {
  const name = readdirSync(migrationsDir).find((file) => file.endsWith(suffix))
  assert.ok(name, `missing migration ${suffix}`)
  return readFileSync(join(migrationsDir, name), 'utf8')
}
const read = (path: string) => readFileSync(path, 'utf8')

const requisitionSql = readMigration('_lab_stock_requisitions.sql')
const editCancelSql = readMigration('_requisition_edit_cancel.sql')

const fn = (sql: string, name: string) => {
  const body = sql.match(
    new RegExp(`create or replace function public\\.${name}[\\s\\S]*?\\$function\\$;`, 'i'),
  )?.[0]
  assert.ok(body, `${name} must exist`)
  return body
}

// 1. Raising a requisition moves no stock. create_requisition writes the
//    request and its lines only; the ledger is untouched until fulfilment.
const create = fn(requisitionSql, 'create_requisition')
assert.doesNotMatch(
  create,
  /stock_movements/i,
  'creating a requisition must not write to the stock ledger — if it ever does, editing and cancelling must start compensating for it',
)
assert.match(
  fn(requisitionSql, 'fulfill_requisition'),
  /insert into public\.stock_movements/i,
  'fulfilment is the only step that moves stock',
)
assert.equal(
  readdirSync(migrationsDir).filter((name) =>
    /create or replace function public\.create_requisition/i.test(
      readFileSync(join(migrationsDir, name), 'utf8'),
    ),
  ).length,
  1,
  'only the base migration may define create_requisition, so the no-ledger-write claim above covers the live definition',
)

// 2. Both new RPCs lock the row before trusting its status, so an edit or a
//    cancel cannot land while a stock officer is dispensing the same request.
for (const [name, verb] of [
  ['update_requisition', 'edited'],
  ['cancel_requisition', 'cancelled'],
] as const) {
  const body = fn(editCancelSql, name)
  assert.match(body, /from public\.requisitions[\s\S]*?for update/i, `${name} must lock the requisition`)
  assert.match(body, /status <> 'waiting'/i, `${name} must refuse anything but a waiting requisition`)
  assert.ok(
    body.indexOf('for update') < body.indexOf("status <> 'waiting'"),
    `${name} must re-read the status under the lock, not before it`,
  )
  assert.match(body, new RegExp(`cannot be ${verb}`, 'i'))
  assert.match(
    body,
    /perform public\.assert_requisition_manager\(p_actor_id, locked_requisition\.requester_id\)/i,
    `${name} must re-check ownership in the database, not trust the UI`,
  )
  assert.ok(
    body.indexOf("status <> 'waiting'") < body.indexOf('assert_requisition_manager'),
    `${name} must decide on status before spending a lookup on authorization`,
  )
}

// 3. Ownership in the database mirrors the application predicate: the
//    requester, an admin, a stock officer, or E-Phis 9495. A head who is not
//    the requester is deliberately absent.
const manager = fn(editCancelSql, 'assert_requisition_manager')
assert.match(manager, /profile\.id = p_requester_id/i)
assert.match(manager, /profile\.ephis_id = '9495'/i)
assert.match(manager, /membership\.role in \('admin', 'stock_officer'\)/i)
assert.doesNotMatch(manager, /'head'/i, 'a head who is not the requester must not manage someone else\'s requisition')
assert.match(manager, /profile\.status = 'active'/i)
assert.match(manager, /profile\.deleted_at is null/i)

// 4. The document number was minted from the fiscal year and that year's
//    sequence, so a date edit may not cross into another fiscal year.
const update = fn(editCancelSql, 'update_requisition')
assert.match(update, /parsed_fiscal_year <> locked_requisition\.fiscal_year/i)
assert.match(update, /แก้วันที่ข้ามปีงบประมาณไม่ได้/)

// 5. Replacing the lines is safe only while no allocation points at them:
//    requisition_lot_allocations is append-only with a restrict FK, so an
//    existing allocation must be refused rather than deleted around.
assert.match(update, /from public\.requisition_lot_allocations/i)
assert.match(update, /requisition already has lot allocations/i)
assert.ok(
  update.indexOf('requisition already has lot allocations') < update.indexOf('delete from public.requisition_items'),
  'the allocation guard must run before the lines are deleted',
)

// 6. Cancelling keeps the record. The row, its lines, and its document number
//    all survive; the constraint on the table demands both audit columns.
const cancel = fn(editCancelSql, 'cancel_requisition')
assert.match(cancel, /status = 'cancelled'/i)
assert.match(cancel, /cancelled_by = p_actor_id/i)
assert.match(cancel, /cancelled_at = now\(\)/i)
assert.doesNotMatch(cancel, /delete from/i, 'cancelling must never delete the requisition or its lines')

// 7. Every new function is service-role only, like the rest of the domain.
for (const signature of [
  'assert_requisition_manager\\(uuid, uuid\\)',
  'update_requisition\\(uuid, uuid, jsonb, jsonb\\)',
  'cancel_requisition\\(uuid, uuid\\)',
]) {
  for (const role of ['public', 'anon', 'authenticated']) {
    assert.match(
      editCancelSql,
      new RegExp(`revoke execute on function public\\.${signature} from ${role}`, 'i'),
    )
  }
  assert.match(
    editCancelSql,
    new RegExp(`grant execute on function public\\.${signature} to service_role`, 'i'),
  )
}

// 8. The application predicate, which decides what the UI offers.
const actor = (id: string, appRoles: LabStockRole[]): Actor => ({
  id,
  ephisId: null,
  name: null,
  department: null,
  profileRole: null,
  appRoles,
})

const owner = actor('owner-id', ['head'])
assert.equal(canManageRequisition(owner, owner.id), true, 'the requester can edit or cancel their own requisition')
assert.equal(
  canManageRequisition(actor('other-head-id', ['head']), owner.id),
  false,
  'a different head cannot edit or cancel another requester\'s requisition',
)
assert.equal(
  canManageRequisition(actor('stock-id', ['stock_officer']), owner.id),
  true,
  'a stock officer can edit or cancel any waiting requisition',
)
assert.equal(
  canManageRequisition(actor('admin-id', ['admin']), owner.id),
  true,
  'an admin can edit or cancel any waiting requisition',
)
assert.equal(
  canManageRequisition(actor('viewer-id', ['viewer']), owner.id),
  false,
  'a viewer manages nothing',
)
assert.equal(
  canManageRequisition(actor('anyone', ['head']), null),
  false,
  'a requisition with no recorded requester belongs to no one — do not let a null match a null',
)

// 9. Ownership is decided by requester_id, the profile recorded at creation.
//    requester_name is a free-text field the form lets anyone type.
const queries = read('lib/requisitions/queries.ts')
assert.match(queries, /requester_id: z\.string\(\)\.uuid\(\)\.nullable\(\)/)
assert.match(queries, /requesterId: row\.requester_id/)
assert.match(read('lib/requisitions/types.ts'), /requesterId: string \| null/)

// 10. Server actions re-check ownership against the stored record before the
//     RPC, so a direct call cannot skip the check the hidden button implies.
const actions = read('lib/requisitions/actions.ts')
for (const [action, rpc] of [
  ['updateRequisition', 'update_requisition'],
  ['cancelRequisition', 'cancel_requisition'],
] as const) {
  assert.match(actions, new RegExp(`export async function ${action}`))
  assert.match(actions, new RegExp(`supabaseAdmin\\.rpc\\('${rpc}'`))
}
assert.match(actions, /assertRequisitionManager\(actor, existing\.requesterId\)/)

// 11. The detail page is the only place the controls appear, and only while the
//     requisition is still waiting.
const detailPage = read('app/(protected)/requisitions/[id]/page.tsx')
assert.match(detailPage, /RequisitionLifecycleControls/, 'waiting requisitions expose edit and delete controls')
assert.match(
  detailPage,
  /canManageRequisition\(actor, requisition\.requesterId\) && requisition\.status === 'waiting'/,
)
assert.doesNotMatch(
  read('app/(protected)/requisitions/page.tsx'),
  /RequisitionLifecycleControls/,
  'the register lists requisitions; deleting one is a decision made on its detail page',
)

const controls = read('components/requisitions/RequisitionLifecycleControls.tsx')
assert.match(controls, /^['"]use client['"]/m)
assert.match(controls, /cancelRequisition/)
assert.match(controls, /<dialog\b/, 'deleting must be confirmed in a dialog, never on a single click')
assert.match(controls, /useTransition/)
assert.match(controls, /setError\(caught instanceof Error \? caught\.message/, 'the server error carries the authoritative reason')

// 12. The edit route repeats both gates server-side.
const editPage = read('app/(protected)/requisitions/[id]/edit/page.tsx')
assert.match(editPage, /params:\s*Promise</)
assert.match(editPage, /canManageRequisition\(actor, requisition\.requesterId\)/)
assert.match(editPage, /requisition\.status !== 'waiting'/, 'the edit route must refuse dispensed or cancelled requisitions')
assert.match(editPage, /mode="edit"/)
assert.match(editPage, /initialValues/)

// 13. The form reuses the create screen. An existing line whose item has since
//     run out is missing from the in-stock picker and must be carried over from
//     the saved requisition, or correcting a date would silently drop it.
const form = read('components/requisitions/RequisitionForm.tsx')
assert.match(form, /mode\?: 'create' \| 'edit'/)
assert.match(form, /updateRequisition\(initialValues\.requisitionId, payload\)/)
assert.match(form, /\(initialValues\?\.items \?\? \[\]\)\.map/)
assert.match(form, /onHand: stocked\?\.onHand \?\? 0/)
assert.match(form, /บันทึกการแก้ไข/)

// 14. A carried-over line whose item has since run out must be impossible to
//     miss, and must say so in words as well as in colour — the row is tinted,
//     the remaining figure turns red, and the warning names the problem.
assert.match(form, /const isDepleted = line\.onHand <= 0/)
assert.match(form, /data-depleted=\{isDepleted \|\| undefined\}/)
assert.match(form, /requisition-line__depleted/)
assert.match(form, /OUT_OF_STOCK_WARNING/)
assert.match(
  read('lib/requisitions/presenter.ts'),
  /export const OUT_OF_STOCK_WARNING = 'ของหมดคลัง คงเหลือ 0/,
  'the depleted state must be stated in words, not conveyed by red alone',
)
assert.match(
  form,
  /isDepleted \? \([\s\S]*?\) : willBreachMinimum \?/,
  'at zero on hand the minimum-stock warning is redundant — the depleted warning replaces it rather than stacking',
)

const css = read('app/globals.css')
assert.match(css, /\.requisition-line-list li\[data-depleted\] \{[^}]*var\(--lab-red-soft\)/)
assert.match(css, /\.requisition-line__warning--depleted \{ color: var\(--lab-red\); \}/)
assert.doesNotMatch(
  form,
  /#[0-9a-fA-F]{3,6}/,
  'colour belongs in globals.css against the --lab-* tokens, never inline in the form',
)

console.log('requisition edit/cancel: ok')
