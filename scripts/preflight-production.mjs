// READ-ONLY preflight against the production Lab_management Project.
// Performs no writes. Answers: would the tracked migrations succeed, and what
// is the blast radius for the legacy portal's contract module?
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'

const envFile = process.env.PREFLIGHT_ENV_FILE ?? '.env.production-backup.local'
const env = fs.readFileSync(envFile, 'utf8')
const url = env.match(/NEXT_PUBLIC_SUPABASE_URL=(.*)/)[1].trim()
const key = env.match(/SUPABASE_SERVICE_ROLE_KEY=(.*)/)[1].trim()
console.log('target:', url)

const supabase = createClient(url, key)

const { data: contracts, error } = await supabase
  .from('contracts')
  .select('id,contract_number,vendor,status,start_date')
if (error) { console.error('read failed:', error.message); process.exit(1) }

console.log('\n=== migration-1 abort conditions ===')
console.log('contracts total:', contracts.length)

const seen = new Map()
const dupes = []
const blank = []
for (const c of contracts) {
  const n = (c.contract_number ?? '').trim()
  if (!n) { blank.push(c.id); continue }
  const norm = n.toLowerCase()
  if (seen.has(norm)) dupes.push(`${seen.get(norm)} vs ${c.id} -> "${n}"`)
  else seen.set(norm, c.id)
}
console.log('duplicate contract_number:', dupes.length ? dupes : 'NONE (migration will not abort)')
console.log('blank/null contract_number:', blank.length, blank.length ? `(ids ${blank.join(',')})` : '')

const nullStart = contracts.filter((c) => !c.start_date).map((c) => c.id)
console.log('NULL start_date (fiscal_year stays null):', nullStart.length, nullStart.length ? `(ids ${nullStart.join(',')})` : '')

const statusCounts = {}
for (const c of contracts) statusCounts[c.status ?? 'NULL'] = (statusCounts[c.status ?? 'NULL'] ?? 0) + 1
console.log('status distribution:', statusCounts)

console.log('\n=== membership seeding (ephis 9495 / 14812 / 11050) ===')
const { data: seeds } = await supabase
  .from('profiles').select('name,ephis_id,role,status,deleted_at')
  .in('ephis_id', ['9495', '14812', '11050'])
if (!seeds?.length) console.log('NONE FOUND -> nobody would get lab_stock access')
else for (const p of seeds) console.log(`  ${p.ephis_id}  ${p.role}  status=${p.status}  deleted=${p.deleted_at ? 'YES' : 'no'}  ${p.name}`)

console.log('\n=== blast radius ===')
const { count: usage } = await supabase.from('contract_usage').select('*', { count: 'exact', head: true })
console.log('contract_usage rows that the portal module owns:', usage)
const { count: active } = await supabase.from('profiles').select('*', { count: 'exact', head: true })
  .eq('status', 'active').is('deleted_at', null)
console.log('active profiles:', active)
const { error: memErr } = await supabase.from('lab_stock_memberships').select('id').limit(1)
console.log('lab_stock_memberships already present?', memErr ? `no (${memErr.code})` : 'YES - migrations partially applied')
