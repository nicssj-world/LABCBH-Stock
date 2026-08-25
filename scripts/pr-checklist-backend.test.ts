import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')
const packageJson = JSON.parse(read('package.json')) as { dependencies?: Record<string, string> }

for (const dependency of [
  '@aws-sdk/client-s3',
  '@aws-sdk/s3-request-presigner',
  '@pdf-lib/fontkit',
  'font-th-sarabun-new',
  'pdf-lib',
  'archiver',
]) {
  assert.ok(packageJson.dependencies?.[dependency], `${dependency} must be a production dependency`)
}

const r2Client = read('lib/r2/client.ts')
assert.match(r2Client, /region:\s*['"]auto['"]/, 'R2 must use the auto region')
assert.match(r2Client, /R2_ACCOUNT_ID/)
assert.match(r2Client, /R2_BUCKET_NAME/)

const presignRoute = read('app/api/purchase-requests/checklist/presign/route.ts')
assert.match(read('lib/pr/checklist-schema.ts'), /PR_MAX_ATTACHMENT_SIZE_BYTES/)
assert.match(presignRoute, /PutObjectCommand/)
assert.match(presignRoute, /IfNoneMatch:\s*['"]\*['"]/, 'a signed upload must not be reusable to overwrite its object')
assert.match(presignRoute, /register_purchase_request_checklist_upload/)
assert.match(presignRoute, /expiresIn:\s*300/)

const actions = read('lib/pr/actions.ts')
assert.match(actions, /create_purchase_request_with_checklist/)
assert.match(actions, /update_purchase_request_with_checklist/)
assert.match(actions, /confirm_purchase_request_with_committees/)
const managerGuardRepair = read('supabase/migrations/20260825120000_restore_purchase_request_manager_guard.sql')
assert.match(managerGuardRepair, /create or replace function public\.assert_purchase_request_manager\(/)
assert.match(managerGuardRepair, /grant execute on function public\.assert_purchase_request_manager\(uuid, uuid\) to service_role/)
const checklistServer = read('lib/pr/checklist-server.ts')
assert.match(checklistServer, /HeadObjectCommand/, 'the server must verify every R2 upload before the final RPC')
assert.match(checklistServer, /validatePurchaseRequestChecklistObject/)

const previewRoute = read('app/api/purchase-requests/[id]/checklist/[attachmentId]/route.ts')
assert.match(previewRoute, /getPurchaseRequestChecklistAttachment/)
assert.match(read('lib/pr/checklist-queries.ts'), /getPurchaseRequestChecklistAccess/)
assert.match(previewRoute, /GetObjectCommand/)
assert.match(previewRoute, /ResponseContentDisposition/)

const zipRoute = read('app/api/purchase-requests/[id]/checklist/download-all/route.ts')
assert.match(zipRoute, /assertPurchaseRequestChecklistStockAccess/)
assert.match(zipRoute, /archiver/)
assert.match(zipRoute, /generatePurchaseRequestCommitteePdf/)

const cleanup = read('lib/pr/checklist-cleanup.ts')
assert.match(cleanup, /DeleteObjectCommand/)
assert.match(cleanup, /isPurchaseRequestChecklistStorageKey/)
assert.match(cleanup, /mark_purchase_request_checklist_objects_deleted/)
const cleanupAction = read('lib/pr/checklist-actions.ts')
assert.match(cleanupAction, /assertContractEditor\(actor\)/, 'winner cleanup must authorize before touching R2')
assert.match(cleanupAction, /assertPurchaseRequestManager\(actor, request\.requesterId\)/, 'PR cleanup must authorize before touching R2')

const contractActions = read('lib/contracts/actions.ts')
assert.match(contractActions, /winner_announced/)
assert.match(contractActions, /cleanupPurchaseRequestChecklistForContract/)

console.log('purchase request checklist backend: ok')
