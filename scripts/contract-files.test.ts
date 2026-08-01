import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { CONTRACT_FILE_BUCKET, contractFilePath, isContractFilePathAllowed } from '../lib/contracts/files'

assert.equal(CONTRACT_FILE_BUCKET, 'lab-stock-contracts')

// Paths are namespaced per contract so one contract cannot overwrite another's.
const path = contractFilePath(19, 'สัญญา 150/69.pdf')
assert.ok(path.startsWith('contracts/19/'), path)
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
// An upsert needs UPDATE as well as INSERT, or replacing a document fails once
// the object exists.
assert.match(sql, /for update/i)
// Writing is limited to contract editors; reading follows the contract record.
assert.match(sql, /membership\.role in \('admin', 'head'\)/i)

// The guard must name the real problem rather than blaming the contract type.
assert.match(sql, /requires a contract_id/i)
assert.match(sql, /does not exist/i)

console.log('contract file tests passed')
