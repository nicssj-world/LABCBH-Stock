import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const migrationsDir = join(process.cwd(), 'supabase', 'migrations')
const names = readdirSync(migrationsDir)
  .filter((name) => name.includes('partial_receiving'))
  .sort()

const expected = [
  '20260821160000_partial_receiving_compatibility.sql',
  '20260821163000_partial_receiving_acknowledgement.sql',
  '20260821164000_partial_receiving_trigger_scope.sql',
  '20260821170000_partial_receiving_backfill.sql',
  '20260821180000_partial_receiving_short_close.sql',
]

assert.deepEqual(names, expected, 'partial receiving migrations must remain a complete ordered rollout')

const read = (name: string) => readFileSync(join(migrationsDir, name), 'utf8')
const compatibility = read(expected[0])
const acknowledgement = read(expected[1])
const triggerScope = read(expected[2])
const backfill = read(expected[3])
const shortClose = read(expected[4])

assert.match(compatibility, /create unique index if not exists goods_receipts_one_draft_purchase_request_key/i)
assert.match(compatibility, /drop index if exists public\.goods_receipts_po_number_key/i)
assert.match(acknowledgement, /status in \('completed', 'partially_received', 'received', 'reversed'\)/i)
assert.match(triggerScope, /before insert or update of purchase_request_id, inventory_item_id, contract_item_id/i)
assert.match(backfill, /posted goods receipt history exceeds its purchase request/i)
assert.match(backfill, /set received_quantity = coalesce/i)
assert.match(shortClose, /closed_short_by/i)
assert.match(shortClose, /close_purchase_request_remaining/i)
assert.match(shortClose, /nullif\(btrim\(coalesce\(closed_short_reason/i)

const runbook = readFileSync(join(process.cwd(), 'docs', 'runbooks', 'partial-receiving-rollout.md'), 'utf8')
assert.match(runbook, /Do not paste a migration into the SQL editor/i)
assert.match(runbook, /migration history/i)
assert.match(runbook, /cache_mismatches/i)

console.log('partial receiving rollout contract: ok')
