import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { CONTRACT_FILE_BUCKET, contractFilePath, isContractFilePathAllowed } from '../lib/contracts/files'

assert.equal(CONTRACT_FILE_BUCKET, 'lab-stock-contracts')

// Paths are namespaced per contract so one contract cannot overwrite another's.
const path = contractFilePath(19, 'สัญญา 150/69.pdf')
const secondPath = contractFilePath(19, 'สัญญา 150/69.pdf')
assert.ok(path.startsWith('contracts/19/'), path)
assert.notEqual(path, secondPath, 'replacing a contract document must create a new object before the pointer changes')
// Slashes and spaces in the original name must not create directories, or a
// crafted filename could write outside the folder the storage policy keys on.
assert.ok(!path.slice('contracts/19/'.length).includes('/'), 'filename must be flattened')
assert.match(path, /\.pdf$/)

// Traversal attempts are flattened rather than resolved.
const traversal = contractFilePath(19, '../../etc/passwd')
assert.ok(traversal.startsWith('contracts/19/'), traversal)
assert.ok(!traversal.includes('..'), 'dot segments must not survive')

// The path is re-checked before use rather than trusted from the caller.
assert.equal(isContractFilePathAllowed(path, 19), true)
assert.equal(isContractFilePathAllowed(path, 20), false, 'another contract must not claim it')
assert.equal(isContractFilePathAllowed('contracts/19/../20/x.pdf', 19), false)
assert.equal(isContractFilePathAllowed('other/19/x.pdf', 19), false)

// Both entry points share one helper, and that helper must resolve and check
// the current session before it can write to the service-role Storage client.
const actionsSource = readFileSync(join(process.cwd(), 'lib', 'contracts', 'file-actions.ts'), 'utf8')
assert.match(actionsSource, /const actor = await requireActor\(\)/)
assert.match(actionsSource, /assertContractEditor\(actor\)/)
assert.ok(
  actionsSource.indexOf('assertContractEditor(actor)') < actionsSource.indexOf('.upload(path'),
  'contract upload authorization must happen before Storage writes',
)
assert.match(actionsSource, /\.remove\(\[path\]\)/, 'a failed RPC must clean up the newly uploaded object')
assert.match(actionsSource, /hardDeleteContractFiles/, 'contract close must have a separate hard-delete path')
assert.match(actionsSource, /\.list\(contractFolder/, 'contract close must include replaced or detached contract objects')
assert.match(actionsSource, /p_file_paths:\s*paths/, 'the close RPC must audit every object selected for deletion')

const lifecycleSql = readFileSync(join(process.cwd(), 'supabase', 'migrations', '20260825160000_contract_file_reuse.sql'), 'utf8')
assert.match(lifecycleSql, /create table if not exists public\.contract_file_audit/i)
assert.match(lifecycleSql, /create or replace function public\.finalize_contract_file_hard_delete/i)
assert.match(lifecycleSql, /p_file_paths jsonb/i)
assert.match(lifecycleSql, /contract_file_reference_deleted/i)

const uploadRouteSource = readFileSync(
  join(process.cwd(), 'app', 'api', 'contracts', '[id]', 'file', 'route.ts'),
  'utf8',
)
assert.match(uploadRouteSource, /ContractAuthorizationError/)
assert.match(uploadRouteSource, /status\s*=\s*.*403/)

// ── storage policies ────────────────────────────────────────────────────────
// The bucket was created with none, which denied everything by default and so
// exposed nothing, but left the application relying on the service role alone.
const migrationsDir = join(process.cwd(), 'supabase', 'migrations')
const names = readdirSync(migrationsDir).filter((n) =>
  n.endsWith('_lab_stock_contract_file_policies.sql'),
)
assert.equal(names.length, 1, 'exactly one contract file policy migration must exist')
const sql = readFileSync(join(migrationsDir, names[0]), 'utf8')

for (const policy of [
  'lab_stock_contract_file_editor_insert',
  'lab_stock_contract_file_app_select',
  'lab_stock_contract_file_editor_update',
]) {
  assert.match(sql, new RegExp(`create policy ${policy}`, 'i'), `missing ${policy}`)
}
// Legacy UPDATE remains in the storage policy for backwards compatibility;
// new application uploads use unique paths and never overwrite an old object.
assert.match(sql, /for update/i)
assert.match(actionsSource, /\.upload\(path, file, \{ upsert: false/)
// Writing is limited to contract editors; reading follows the contract record.
assert.match(sql, /membership\.role in \('admin', 'head'\)/i)

// The guard must name the real problem rather than blaming the contract type.
assert.match(sql, /requires a contract_id/i)
assert.match(sql, /does not exist/i)

// The frozen portal contains an 18,219,021-byte legal document. The private
// destination bucket must accept that known source without widening the PO
// evidence bucket or removing the MIME allow-list.
const sizeMigrations = readdirSync(migrationsDir).filter((n) =>
  n.endsWith('_lab_stock_contract_file_size.sql'),
)
assert.equal(sizeMigrations.length, 1, 'exactly one contract file size correction must exist')
const sizeSql = readFileSync(join(migrationsDir, sizeMigrations[0]), 'utf8')
assert.match(sizeSql, /where id = 'lab-stock-contracts'/i)
assert.match(sizeSql, /file_size_limit = 26214400/i)
assert.doesNotMatch(sizeSql, /lab-stock-po/i)

console.log('contract file tests passed')
