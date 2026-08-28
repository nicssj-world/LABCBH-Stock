import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { drawnSignatureInputSchema } from '../lib/requisitions/schema'

// The browser sends only a PNG data URI from the canvas. The server action
// normalizes it before it reaches the shared private Portal bucket.
const validSignature = `data:image/png;base64,${'A'.repeat(100)}`

assert.equal(drawnSignatureInputSchema.safeParse({ signature: validSignature }).success, true)
assert.equal(
  drawnSignatureInputSchema.safeParse({ signature: 'not-a-data-uri' }).success,
  false,
  'the signature must be a PNG data URI',
)
assert.equal(
  drawnSignatureInputSchema.safeParse({ signature: `data:image/png;base64,${'A'.repeat(2_800_001)}` }).success,
  false,
  'an oversized browser payload is rejected',
)

const migrationsDir = join(process.cwd(), 'supabase', 'migrations')
const migrationName = readdirSync(migrationsDir).find((name) =>
  name.endsWith('_requisition_partial_issue_receipt.sql'),
)
assert.ok(migrationName, 'the requisition receipt migration must exist')
const sql = readFileSync(join(migrationsDir, migrationName), 'utf8')
const liveMigrationName = readdirSync(migrationsDir).find((name) =>
  name.endsWith('_requisition_live_receipt_signature.sql'),
)
assert.ok(liveMigrationName, 'the live receipt signature migration must exist')
const liveSql = readFileSync(join(migrationsDir, liveMigrationName), 'utf8')

for (const column of ['received_by', 'received_by_name', 'signature', 'signed_at']) {
  assert.match(sql, new RegExp(`\\b${column}\\b`, 'i'))
}
assert.match(sql, /add column if not exists received_by uuid/i)
for (const column of ['signature_url', 'signature_updated_at', 'signature_updated_by']) {
  assert.match(sql, new RegExp(`add column if not exists ${column}`, 'i'), `shared profiles must store ${column}`)
}
assert.match(sql, /values \('signatures', 'signatures', false\)/i, 'the shared signatures bucket must remain private')
assert.match(sql, /allowed_mime_types\s*=\s*array\['image\/png'\]/i, 'drawn signatures must be PNG-only in Storage')
assert.match(sql, /status in \('waiting', 'fulfilled', 'received', 'cancelled'\)/i)
assert.match(sql, /requisitions_receipt_check/i)
assert.match(sql, /status = 'received'/i)
assert.match(sql, /status = 'fulfilled'/i)
assert.match(sql, /where requisition\.status = 'fulfilled'/i)
assert.match(sql, /signed_at is not null/i)
assert.match(sql, /signature is not null/i)
assert.match(sql, /nullif\(btrim\(received_by_name\), ''\) is not null/i)
assert.match(sql, /revoke execute on function public\.sign_requisition_receipt\(uuid, uuid, text, text\) from service_role/i)
assert.match(liveSql, /drop function if exists public\.receive_requisition\(uuid, uuid, text, text\)/i)
assert.match(liveSql, /signature = null/i)
assert.match(liveSql, /signature_source.*portal_live/i)
assert.ok(
  sql.indexOf('drop constraint if exists requisitions_fulfilled_audit_check')
    < sql.indexOf('update public.requisitions as requisition'),
  'the received-aware audit constraint must be installed before historical status backfill',
)
assert.ok(
  sql.indexOf('add constraint requisitions_fulfilled_audit_check')
    < sql.indexOf('update public.requisitions as requisition'),
  'the received-aware audit constraint must be active before historical status backfill',
)

const saveFunction = sql.match(
  /create or replace function public\.save_profile_signature[\s\S]*?\$function\$;/i,
)?.[0]
assert.ok(saveFunction, 'save_profile_signature must exist')
assert.match(saveFunction, /security invoker/i)
assert.match(saveFunction, /set search_path = ''/i)
assert.match(saveFunction, /p_signature_path/i)
assert.match(saveFunction, /profile\.signature_url/i)
assert.match(saveFunction, /for update/i)
assert.match(saveFunction, /requisition\.receipt_signature_drawn/i)
assert.match(saveFunction, /signature_url = v_signature_path/i)

const receiveFunction = liveSql.match(
  /create or replace function public\.receive_requisition[\s\S]*?\$function\$;/i,
)?.[0]
assert.ok(receiveFunction, 'receive_requisition must exist')
assert.match(receiveFunction, /security invoker/i)
assert.match(receiveFunction, /set search_path = ''/i)
assert.match(receiveFunction, /p_requisition_id/i)
assert.match(receiveFunction, /p_actor_id/i)
assert.match(receiveFunction, /p_received_by_name/i)
assert.doesNotMatch(receiveFunction, /p_signature/i)
assert.match(receiveFunction, /for update/i)
assert.match(receiveFunction, /status <> 'fulfilled'/i)
assert.match(receiveFunction, /already been received/i)
assert.match(receiveFunction, /assert_requisition_manager/i)
assert.match(receiveFunction, /status = 'received'/i)
assert.match(receiveFunction, /received_by = p_actor_id/i)
assert.match(receiveFunction, /requisition\.receipt_confirmed/i)
assert.ok(
  receiveFunction.indexOf('for update') < receiveFunction.indexOf("status <> 'fulfilled'"),
  'receipt status must be re-read under the row lock',
)

for (const [fn, functionSql] of [
  ['save_profile_signature', sql],
  ['receive_requisition', liveSql],
] as const) {
  for (const role of ['public', 'anon', 'authenticated']) {
    assert.match(
      functionSql,
      new RegExp(`revoke execute on function public\\.${fn}[\\s\\S]*?from ${role}`, 'i'),
    )
  }
  assert.match(functionSql, new RegExp(`grant execute on function public\\.${fn}[\\s\\S]*?to service_role`, 'i'))
}

const actions = readFileSync(join(process.cwd(), 'lib', 'requisitions', 'actions.ts'), 'utf8')
assert.match(actions, /export async function saveDrawnSignature/)
assert.match(actions, /export async function receiveRequisition/)
assert.match(actions, /getPortalSupabaseAdmin/)
assert.match(actions, /resolvePortalSignatureProfile/)
assert.match(actions, /portalAdmin\.storage[\s\S]*?upload/)
assert.match(actions, /portalAdmin\.rpc\('save_profile_signature'/)
assert.match(actions, /profileSignaturePath\(portalProfile\.id\)/)
assert.match(actions, /p_actor_id: portalProfile\.id/)
assert.match(actions, /supabaseAdmin\.rpc\('receive_requisition'/)
assert.match(actions, /loadPortalSignatureDataUri/)
assert.match(actions, /PORTAL_PROFILE_PATH/)
assert.doesNotMatch(actions, /p_signature:\s*signature/)
assert.doesNotMatch(actions, /supabaseAdmin\.storage/, 'Portal signatures must not be stored in the Stock client')
assert.doesNotMatch(actions, /signRequisitionReceipt|sign_requisition_receipt/)

const signatureHelper = readFileSync(join(process.cwd(), 'lib', 'requisitions', 'signature.ts'), 'utf8')
assert.match(signatureHelper, /PortalSignatureIdentity/)
assert.match(signatureHelper, /resolvePortalSignatureProfile/)
assert.match(signatureHelper, /ephis_id/)
assert.match(signatureHelper, /getPortalSupabaseAdmin/)
assert.match(signatureHelper, /downloadSignature\(getPortalSupabaseAdmin\(\), profile\.signatureUrl\)/)

const portalAdmin = readFileSync(join(process.cwd(), 'lib', 'supabase', 'portal-admin.ts'), 'utf8')
assert.match(portalAdmin, /server-only/)
assert.match(portalAdmin, /LAB_MANAGEMENT_PORTAL_SUPABASE_URL/)
assert.match(portalAdmin, /LAB_MANAGEMENT_PORTAL_SUPABASE_SERVICE_ROLE_KEY/)
assert.match(portalAdmin, /createClient/)

const envExample = readFileSync(join(process.cwd(), '.env.example'), 'utf8')
assert.match(envExample, /LAB_MANAGEMENT_PORTAL_SUPABASE_URL/)
assert.match(envExample, /LAB_MANAGEMENT_PORTAL_SUPABASE_SERVICE_ROLE_KEY/)

const dialog = readFileSync(
  join(process.cwd(), 'components', 'requisitions', 'RequisitionReceiptDialog.tsx'),
  'utf8',
)
assert.match(dialog, /<dialog\b/)
assert.match(dialog, /useDeferredDialog/)
assert.match(dialog, /SignaturePad/)
assert.match(dialog, /isReplacingSignature/)
assert.match(dialog, /startSignatureReplacement/)
assert.match(dialog, /signature-replacement-actions/)
assert.match(dialog, /บันทึกลายเซ็นต์/)
assert.match(dialog, /ยืนยันตรวจรับของ/)
assert.match(dialog, /\/staff\/profile/)
assert.doesNotMatch(dialog, /type=["']file["']/i, 'the receipt popup must not offer a file input')

const pad = readFileSync(join(process.cwd(), 'components', 'requisitions', 'SignaturePad.tsx'), 'utf8')
assert.match(pad, /onPointerDown/)
assert.match(pad, /onPointerMove/)
assert.match(pad, /onPointerUp/)
assert.match(pad, /toDataURL\('image\/png'\)/)
assert.match(pad, /hasSignatureRef/)

console.log(`requisition signature: ok (${migrationName})`)
