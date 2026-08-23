import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseEnvFile } from './env-file-lib'

const env = parseEnvFile(readFileSync('.env.local', 'utf8'))
const url = env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY

assert.ok(url, 'staging Supabase URL is required')
assert.ok(serviceRoleKey, 'staging service-role key is required')
assert.match(url, /stogulcfwsvunydmwrex\.supabase\.co/i, 'this check must target LABCBH Stock Staging')

async function main() {
  const select = [
    'id',
    'requester:profiles!purchase_requests_requester_id_fkey(name)',
    'outside_stock_received_by',
    'outside_stock_receiver:profiles!purchase_requests_outside_stock_received_by_fkey(name)',
  ].join(',')
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

  console.log('staging-pr-relationship.test.ts: ok')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
