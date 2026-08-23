import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseEnvFile } from './env-file-lib'

const env = parseEnvFile(readFileSync('.env.local', 'utf8'))
const url = env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY

assert.ok(url, 'staging Supabase URL is required')
assert.ok(serviceRoleKey, 'staging service-role key is required')
assert.match(url, /stogulcfwsvunydmwrex\.supabase\.co/i, 'this check must target LABCBH Stock Staging')

const querySource = readFileSync('lib/pr/queries.ts', 'utf8')
const requestSelect = querySource.match(/const REQUEST_SELECT = `([\s\S]*?)`/)?.[1]
assert.ok(requestSelect, 'the PR query must expose REQUEST_SELECT for staging verification')
const verifiedRequestSelect = requestSelect

// Keep the live check focused on the fields introduced by recent migrations;
// the full list query is checked below as a second contract.
const select = [
  'id',
  'checklist_policy_version',
  'checklist_completed_at',
  'checklist_upload_session_id',
  'outside_stock_received_by',
  'requester:profiles!purchase_requests_requester_id_fkey(name)',
  'outside_stock_receiver:profiles!purchase_requests_outside_stock_received_by_fkey(name)',
].join(',')

async function main() {
  const response = await fetch(
    `${url}/rest/v1/purchase_requests?select=${encodeURIComponent(select)}&limit=1`,
    {
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
    },
  )
  const body = await response.text()

  assert.equal(
    response.ok,
    true,
    `staging must expose the purchase_requests -> profiles relationships required by the PR list (${response.status}): ${body}`,
  )

  const rows = JSON.parse(body) as Array<Record<string, unknown>>
  assert.ok(rows.length > 0, 'staging PR schema verification needs at least one purchase request')
  for (const field of [
    'checklist_policy_version',
    'checklist_completed_at',
    'checklist_upload_session_id',
    'outside_stock_received_by',
  ]) {
    assert.ok(Object.hasOwn(rows[0], field), `staging PR rows must expose ${field}`)
  }

  const fullSelectResponse = await fetch(
    `${url}/rest/v1/purchase_requests?select=${encodeURIComponent(verifiedRequestSelect)}&limit=1`,
    {
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
    },
  )
  assert.equal(fullSelectResponse.ok, true, await fullSelectResponse.text())

  console.log('staging-pr-relationship.test.ts: ok')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
