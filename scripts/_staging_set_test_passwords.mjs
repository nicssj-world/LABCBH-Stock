// STAGING ONLY: give the four E2E fixture accounts a known dev password.
// Guarded so it can never run against the production Lab_management Project.
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'

const env = fs.readFileSync('.env.local', 'utf8')
const url = env.match(/NEXT_PUBLIC_SUPABASE_URL=(.*)/)[1].trim()
const key = env.match(/SUPABASE_SERVICE_ROLE_KEY=(.*)/)[1].trim()

if (!url.includes('stogulcfwsvunydmwrex')) {
  console.error('REFUSING: not the staging project ->', url)
  process.exit(1)
}

const password = '123456'
const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })

const { data: list, error: listErr } = await supabase.auth.admin.listUsers()
if (listErr) { console.error(listErr.message); process.exit(1) }

for (const ephis of ['9495', '99001', '14812', '11050']) {
  const user = list.users.find((u) => u.email === `${ephis}@cbh.go.th`)
  if (!user) { console.log(`  ${ephis}: NOT FOUND`); continue }
  const { error } = await supabase.auth.admin.updateUserById(user.id, { password })
  console.log(`  ${ephis}: ${error ? 'ERROR ' + error.message : 'ok'}`)
}
