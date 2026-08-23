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
assert.match(fields, /เอกสารหลัก/, 'primary attachments need a visible group heading')
assert.match(fields, /ใบเสนอราคาจากบริษัท/, 'quotation attachments need a visible group heading')
assert.match(fields, /primaryAttachments/, 'attachments must be grouped by document kind')
assert.match(fields, /quotationAttachments/, 'quotation slots must stay together')
assert.match(fields, /บริษัทที่ \$\{item\.requirement\.slot\}/, 'quotation order needs an explicit company label')
assert.match(fields, /แนบแล้ว \{completeAttachmentCount\}\/\{policy\.attachments\.length\} ไฟล์/, 'overall file count must show progress')
assert.doesNotMatch(fields, /complete \? '✓' : requirement\.slot/, 'slot numbers must not be rendered as ambiguous card markers')

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
assert.match(styles, /\.committee-picker__control input \{[\s\S]*?border:/, 'committee inputs need a visible border')
assert.match(styles, /\.committee-picker__control input:focus/, 'committee inputs need a visible focus state')

console.log('purchase request checklist UI: ok')
