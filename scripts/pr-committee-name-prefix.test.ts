import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(path, 'utf8')

async function main() {
  assert.ok(existsSync('lib/profiles/name.ts'), 'shared profile name formatter must exist')
  const { formatProfileName } = await import('../lib/profiles/name')
  assert.equal(formatProfileName('สมหญิง ใจดี', 'นาง'), 'นางสมหญิง ใจดี')
  assert.equal(formatProfileName('สมชาย ใจดี', null), 'สมชาย ใจดี')

  const formOptions = read('lib/pr/form-options.ts')
  assert.match(formOptions, /select\('id, name, name_prefix, ephis_id, position_title'\)/)
  assert.match(formOptions, /namePrefix: profile\.name\?\.trim\(\) \? profile\.name_prefix\?\.trim\(\) \|\| null : null/)

  const checklistQueries = read('lib/pr/checklist-queries.ts')
  assert.match(checklistQueries, /profile:profiles!purchase_request_committees_profile_id_fkey\(name, name_prefix, position_title, status, deleted_at\)/)
  assert.match(checklistQueries, /namePrefix: profile\?\.name_prefix\?\.trim\(\) \|\| null/)

  const contractQueries = read('lib/contracts/committee-queries.ts')
  assert.match(contractQueries, /profile:profiles!contract_committees_profile_id_fkey\(name, name_prefix, position_title\)/)
  assert.match(contractQueries, /namePrefix: profile\?\.name_prefix\?\.trim\(\) \|\| null/)

  const checklistFields = read('components/pr/PurchaseRequestChecklistFields.tsx')
  assert.match(checklistFields, /formatProfileName\(candidate\.name, candidate\.namePrefix\)/)
  const checklistPanel = read('components/pr/PurchaseRequestChecklistPanel.tsx')
  assert.match(checklistPanel, /formatProfileName\(member\.name, member\.namePrefix\)/)
  const contractRoster = read('components/contracts/ContractCommitteeRoster.tsx')
  assert.match(contractRoster, /formatProfileName\(member\.name, member\.namePrefix\)/)

  const pdf = read('lib/pr/committee-pdf.ts')
  assert.match(pdf, /formatProfileName\(member\.name, member\.namePrefix\)/)
  const pdfServer = read('lib/pr/committee-pdf-server.ts')
  assert.match(pdfServer, /namePrefix: member\.namePrefix/)

  const migration = read('supabase/migrations/20260824150000_profile_name_prefix_for_committee.sql')
  assert.match(migration, /add column if not exists name_prefix text/i)
  console.log('purchase request committee name prefix: all assertions passed')
}

void main()
