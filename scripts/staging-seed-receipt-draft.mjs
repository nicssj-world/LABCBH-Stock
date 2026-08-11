// STAGING ONLY: seed a fresh draft goods receipt for the E2E receiving/dashboard specs.
// The receiving spec posts the draft, consuming it, so each run needs a new one.
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

const { data: stock } = await supabase
  .from('profiles').select('id').eq('ephis_id', '14812').single()

const { data: item, error: itemErr } = await supabase
  .from('inventory_items').select('id,name,base_unit').limit(1).single()

if (itemErr || !item) { console.error('no inventory_items in staging:', itemErr?.message); process.exit(1) }

const { data: receipt, error: rErr } = await supabase
  .from('goods_receipts')
  .insert({
    fiscal_year: 2569,
    department: 'E2E laboratory',
    received_date: new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Bangkok',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date()),
    receiver_name: 'E2E Receiver',
    received_by: stock.id,
    status: 'draft',
    created_by: stock.id,
    source_metadata: { source: 'e2e_fixture' },
  })
  .select('id').single()

if (rErr) { console.error('receipt insert failed:', rErr.message); process.exit(1) }

const { error: iErr } = await supabase.from('goods_receipt_items').insert({
  goods_receipt_id: receipt.id,
  line_number: 1,
  inventory_item_id: item.id,
  lot_number: `E2E-LOT-${Date.now()}`,
  expiry_date: '2027-12-31',
  quantity: 10,
  unit: item.base_unit ?? 'ชิ้น',
})

if (iErr) { console.error('item insert failed:', iErr.message); process.exit(1) }

console.log(`/receipts/${receipt.id}`)
