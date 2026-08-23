import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')

const fields = read('components/pr/PurchaseRequestChecklistFields.tsx')
assert.match(fields, /derivePurchaseRequestChecklist/)
assert.match(fields, /20 MB/)
assert.match(fields, /overallProgress|overall progress/i, 'uploads need an overall progress indicator')
assert.match(fields, /role="combobox"/, 'committee members must use a searchable combobox')
assert.match(fields, /positionTitle/, 'positions must be shown from personnel')
assert.match(fields, /validateCommitteeAssignments/)
assert.match(fields, /aria-live="polite"/)
assert.match(fields, /pr-checklist__dropzone/, 'attachments need a visible drag-and-drop target')
assert.match(fields, /onDrop=\{\(event\) => handleFileDrop/, 'dropzone must pass dropped files through the existing callback')
assert.match(fields, /aria-describedby=\{dropzoneHintId\}/, 'file input needs persistent helper text')

const form = read('components/pr/PurchaseRequestForm.tsx')
assert.match(form, /PurchaseRequestChecklistFields/)
assert.match(form, /checklistComplete/)
assert.match(form, /uploadChecklistFiles/)
assert.match(form, /ส่งใบ PR/)

const detail = read('components/pr/PurchaseRequestChecklistPanel.tsx')
assert.match(detail, /Download all/)
assert.match(detail, /committee-pdf/)
assert.match(detail, /<dialog/)
assert.match(detail, /checklist\/\$\{preview\.id\}/)
assert.match(detail, /canDownloadCommitteePdf/)

const detailPage = read('app/(protected)/purchase-requests/[id]/page.tsx')
assert.match(detailPage, /getPurchaseRequestChecklist/)
assert.match(detailPage, /PurchaseRequestChecklistPanel/)

const contractRoster = read('components/contracts/ContractCommitteeRoster.tsx')
assert.match(contractRoster, /setContractCommittees/)
assert.match(contractRoster, /PR_COMMITTEE_KIND_LABELS/)
assert.match(contractRoster, /positionTitle/)

const styles = read('app/globals.css')
assert.match(styles, /\.pr-checklist/)
assert.match(styles, /\.committee-picker/)
assert.match(styles, /\.pr-checklist__dropzone\.is-dragging/, 'dragging state needs a clear visual treatment')
assert.match(styles, /\.committee-picker__control input \{[^}]*border:/s, 'committee inputs need a visible border')
assert.match(styles, /\.committee-picker__control input:focus/, 'committee inputs need a visible focus state')

console.log('purchase request checklist UI: ok')
