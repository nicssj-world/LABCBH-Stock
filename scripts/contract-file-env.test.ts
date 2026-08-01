import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

async function main() {
  const modulePath = resolve('scripts/env-file-lib.ts')
  assert.ok(existsSync(modulePath), 'shared env-file parser must exist')

  const { parseEnvFile } = await import('./env-file-lib')
  const parsed = parseEnvFile([
    '# ignored',
    'R2_ACCOUNT_ID=plain-account',
    'R2_ACCESS_KEY_ID = "quoted=access"',
    "R2_SECRET_ACCESS_KEY='quoted-secret'",
    'export R2_BUCKET_NAME=portal-files',
    '',
  ].join('\r\n'))

  assert.equal(parsed.R2_ACCOUNT_ID, 'plain-account')
  assert.equal(parsed.R2_ACCESS_KEY_ID, 'quoted=access')
  assert.equal(parsed.R2_SECRET_ACCESS_KEY, 'quoted-secret')
  assert.equal(parsed.R2_BUCKET_NAME, 'portal-files')
  assert.equal(parsed['# ignored'], undefined)
}

main()
  .then(() => console.log('contract file env loading: ok'))
  .catch((cause) => {
    console.error(cause)
    process.exitCode = 1
  })
