// STAGING ONLY: seed a started equipment lease for the budget E2E spec.
// The spec records against the budget and clears its own responsible users, so
// a fresh contract per run keeps the remaining balance predictable.
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'

const env = fs.readFileSync('.env.local', 'utf8')
const url = env.match(/NEXT_PUBLIC_SUPABASE_URL=(.*)/)[1].trim()
const key = env.match(/SUPABASE_SERVICE_ROLE_KEY=(.*)/)[1].trim()

if (!url.includes('stogulcfwsvunydmwrex')) {
  console.error('REFUSING: not the staging project ->', url)
  process.exit(1)
}

const supabase = createClient(url, key)

const year = new Date().getFullYear()
const start = `${year}-01-01`
const end = `${year}-12-31`

const { data, error } = await supabase
  .from('contracts')
  .insert({
    vendor: 'E2E Lease Vendor',
    product: 'เช่าเครื่องวิเคราะห์ E2E',
    display_name: 'เช่าเครื่องวิเคราะห์ E2E',
    contract_number: `E2E-LEASE-${Date.now()}`,
    contract_type: 'equipment_lease',
    procurement_stage: 'contract_started',
    status: 'active',
    fiscal_year: 2569,
    total: 1200000,
    start_date: start,
    end_date: end,
    contract_started_date: start,
    sent_to_procurement_date: start,
    plan_published_date: start,
    tender_announced_date: start,
    result_consideration_date: start,
    winner_announced_date: start,
    responsible_user_ids: [],
    source_metadata: { source: 'e2e_fixture' },
  })
  .select('id')
  .single()

if (error) {
  console.error('lease insert failed:', error.message)
  process.exit(1)
}

console.log(`/contracts/${data.id}`)
