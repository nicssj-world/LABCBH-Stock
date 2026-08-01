import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

async function main() {
  const modulePath = resolve('scripts/filter-pg-dump-lib.ts')
  assert.ok(existsSync(modulePath), 'streaming PostgreSQL dump filter must exist')

  const { createPgDumpLineFilter } = await import('./filter-pg-dump-lib')
  const filter = createPgDumpLineFilter(new Set(['auth', 'storage']))
  const input = [
    'SET statement_timeout = 0;',
    'COPY "auth"."users" ("id") FROM stdin;',
    'private-auth-row',
    '\\.',
    'COPY "public"."contracts" ("id") FROM stdin;',
    '16',
    '\\.',
    `SELECT pg_catalog.setval('"auth"."audit_log_entries_id_seq"', 1, false);`,
    `SELECT pg_catalog.setval('"public"."contracts_id_seq"', 16, true);`,
  ]
  const output = input.map((line) => filter(line)).filter((line) => line !== null)

  assert.deepEqual(output, [
    'SET statement_timeout = 0;',
    'COPY "public"."contracts" ("id") FROM stdin;',
    '16',
    '\\.',
    `SELECT pg_catalog.setval('"public"."contracts_id_seq"', 16, true);`,
  ])
  console.log('streaming PostgreSQL dump filter: ok')
}

main().catch((cause) => {
  console.error(cause)
  process.exit(1)
})
