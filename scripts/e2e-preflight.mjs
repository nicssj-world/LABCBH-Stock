const requiredKeys = [
  'E2E_BASE_URL',
  'E2E_ADMIN_IDENTIFIER',
  'E2E_ADMIN_PASSWORD',
  'E2E_MANAGER_IDENTIFIER',
  'E2E_MANAGER_PASSWORD',
  'E2E_STOCK_IDENTIFIER',
  'E2E_STOCK_PASSWORD',
  'E2E_STOCK_ALT_IDENTIFIER',
  'E2E_STOCK_ALT_PASSWORD',
  'E2E_PR_READY_URL',
  'E2E_RECEIPT_DRAFT_URL',
  'E2E_REQUISITION_WAITING_URL',
  'E2E_LEASE_CONTRACT_URL',
]

const missing = requiredKeys.filter((key) => !process.env[key])
if (process.env.E2E_REQUIRE_FIXTURES !== '1') missing.push('E2E_REQUIRE_FIXTURES=1')
if (process.env.E2E_ALLOW_MUTATIONS !== '1') missing.push('E2E_ALLOW_MUTATIONS=1')

if (missing.length > 0) {
  console.error('E2E preflight failed. This command requires isolated fixture data and explicit mutation consent.')
  console.error(`Missing or invalid values: ${missing.join(', ')}`)
  console.error('See docs/runbooks/e2e-staging.md for the staging-only setup.')
  process.exit(1)
}

let baseUrl
try {
  baseUrl = new URL(process.env.E2E_BASE_URL)
} catch {
  console.error('E2E preflight failed: E2E_BASE_URL must be an absolute http(s) URL')
  process.exit(1)
}

if (!['http:', 'https:'].includes(baseUrl.protocol)) {
  console.error('E2E preflight failed: E2E_BASE_URL must use http or https')
  process.exit(1)
}

for (const key of ['E2E_PR_READY_URL', 'E2E_RECEIPT_DRAFT_URL', 'E2E_REQUISITION_WAITING_URL', 'E2E_LEASE_CONTRACT_URL']) {
  let fixtureUrl
  try {
    fixtureUrl = new URL(process.env[key])
  } catch {
    console.error(`E2E preflight failed: ${key} must be an absolute URL on the test server`)
    process.exit(1)
  }
  if (fixtureUrl.origin !== baseUrl.origin) {
    console.error(`E2E preflight failed: ${key} must use the same origin as E2E_BASE_URL`)
    process.exit(1)
  }
}

console.log(`E2E preflight passed for ${baseUrl.origin}; fixture-backed mutations are explicitly enabled.`)
