// READ-ONLY preflight for the lot identity migration. It deliberately needs
// the expected Supabase project ref so a copied env file cannot be queried by
// accident. It never updates inventory_lots or stock_movements.
import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const envFile = process.env.LOT_PREFLIGHT_ENV_FILE ?? '.env.local'
const expectedRef = process.env.LOT_PREFLIGHT_EXPECTED_REF
if (!expectedRef) {
  console.error('LOT_PREFLIGHT_EXPECTED_REF is required; provide the expected isolated project ref.')
  process.exit(1)
}

const env = fs.readFileSync(envFile, 'utf8')
const url = env.match(/^NEXT_PUBLIC_SUPABASE_URL=(.*)$/m)?.[1]?.trim()
const key = env.match(/^SUPABASE_SERVICE_ROLE_KEY=(.*)$/m)?.[1]?.trim()
if (!url || !key) {
  console.error(`Missing Supabase URL or service role key in ${envFile}`)
  process.exit(1)
}
if (!url.includes(expectedRef)) {
  console.error(`REFUSING: ${envFile} is not the expected project -> ${url}`)
  process.exit(1)
}

const supabase = createClient(url, key)
const { data, error } = await supabase
  .from('inventory_lots')
  .select('id,inventory_item_id,lot_number')

if (error) {
  console.error(`lot preflight read failed: ${error.message}`)
  process.exit(1)
}

const groups = new Map()
for (const row of data ?? []) {
  const normalizedKey = `${row.inventory_item_id}:${String(row.lot_number ?? '').trim().toUpperCase()}`
  const current = groups.get(normalizedKey) ?? []
  current.push(row)
  groups.set(normalizedKey, current)
}

const duplicates = [...groups.entries()].filter(([, rows]) => rows.length > 1)
console.log(`target: ${url}`)
console.log(`inventory_lots rows: ${(data ?? []).length}`)
console.log(`normalized duplicate groups: ${duplicates.length}`)

if (duplicates.length > 0) {
  for (const [normalizedKey, rows] of duplicates) {
    console.error(`  ${normalizedKey}: ${rows.map((row) => `${row.id} (${row.lot_number})`).join(', ')}`)
  }
  console.error('REFUSING: reconcile duplicate lots and their stock_movements before applying the migration.')
  process.exit(2)
}

console.log('lot normalization preflight: pass (read-only)')
