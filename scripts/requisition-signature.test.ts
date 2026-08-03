import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { signRequisitionInputSchema } from '../lib/requisitions/schema'

// A fulfilled requisition can now be digitally signed for receipt: a typed
// name, a canvas signature captured as a PNG data URI, and the timestamp.

const validSignature = `data:image/png;base64,${'A'.repeat(100)}`

assert.equal(
  signRequisitionInputSchema.safeParse({ receivedByName: 'สมชาย ใจดี', signature: validSignature }).success,
  true,
)
assert.equal(
  signRequisitionInputSchema.safeParse({ receivedByName: '', signature: validSignature }).success,
  false,
  'a blank receiver name is rejected',
)
assert.equal(
  signRequisitionInputSchema.safeParse({ receivedByName: '   ', signature: validSignature }).success,
  false,
  'a whitespace-only receiver name is rejected',
)
assert.equal(
  signRequisitionInputSchema.safeParse({ receivedByName: 'สมชาย ใจดี', signature: 'not-a-data-uri' }).success,
  false,
  'the signature must be a PNG data URI',
)
assert.equal(
  signRequisitionInputSchema.safeParse({
    receivedByName: 'สมชาย ใจดี',
    signature: `data:image/png;base64,${'A'.repeat(600_000)}`,
  }).success,
  false,
  'an oversized signature is rejected',
)

// The migration itself: new columns, the signed check constraint, and the RPC.
const migrationsDir = join(process.cwd(), 'supabase', 'migrations')
const migrationNames = readdirSync(migrationsDir).filter((name) =>
  name.endsWith('_requisition_signature.sql'),
)
assert.equal(migrationNames.length, 1, 'exactly one requisition signature migration must exist')

const sql = readFileSync(join(migrationsDir, migrationNames[0]), 'utf8')

for (const column of ['received_by_name', 'signature', 'signed_at']) {
  assert.match(sql, new RegExp(`add column if not exists ${column}`, 'i'))
}
assert.match(sql, /add constraint requisitions_signed_check/i)
assert.match(
  sql,
  /\(signed_at is not null\) = \(signature is not null\)/i,
)
assert.match(
  sql,
  /\(signed_at is not null\) = \(received_by_name is not null\)/i,
)

const signFunction = sql.match(
  /create or replace function public\.sign_requisition_receipt[\s\S]*?\$function\$;/i,
)?.[0]
assert.ok(signFunction, 'sign_requisition_receipt must exist')
assert.match(signFunction, /security invoker/i)
assert.match(signFunction, /set search_path = ''/i)
assert.match(signFunction, /assert_stock_officer_actor/i)
assert.match(signFunction, /for update/i)
assert.match(signFunction, /status <> 'fulfilled'/i)
assert.match(signFunction, /signed_at is not null/i)
assert.match(signFunction, /already been signed for/i)
assert.match(signFunction, /data:image\/png;base64,/i, 'the RPC must re-check the signature shape server-side too')
assert.ok(
  signFunction.indexOf('for update') < signFunction.indexOf("status <> 'fulfilled'"),
  'status must be re-read under the lock, not before it — a race would let two signatures both pass',
)

for (const role of ['public', 'anon', 'authenticated']) {
  assert.match(
    sql,
    new RegExp(`revoke execute on function public\\.sign_requisition_receipt[\\s\\S]*?from ${role}`, 'i'),
  )
}
assert.match(
  sql,
  /grant execute on function public\.sign_requisition_receipt[\s\S]*?to service_role/i,
)

console.log(`requisition signature: ok (${migrationNames[0]})`)
