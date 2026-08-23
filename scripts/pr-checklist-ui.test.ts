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
assert.match(fields, /dropzoneErrorId/, 'invalid files need a stable error description')
assert.match(fields, /aria-invalid=\{errors\.length > 0\}/, 'invalid files need an accessible invalid state')
assert.match(fields, /aria-describedby=\{errors\.length > 0 \? `\$\{dropzoneHintId\} \$\{dropzoneErrorId\}` : dropzoneHintId\}/, 'file input needs helper and error descriptions')
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
assert.match(detail, /ดาวน์โหลดทั้งหมด/, 'checklist actions should use the Thai operational vocabulary')
assert.match(detail, /className="lab-button lab-button--primary" href=\{`\/api\/purchase-requests\/\$\{requestId\}\/checklist\/download-all`\}/, 'archive download needs a high-contrast toolbar action')
assert.match(detail, /เปิดดู PDF กรรมการ/, 'committee PDF should be an open/view action')
assert.match(detail, /<Button type="button" variant="primary" onClick=\{openCommitteePdf\}>\s*เปิดดู PDF กรรมการ/, 'committee PDF preview needs a high-contrast toolbar action')
assert.doesNotMatch(detail, /ดาวน์โหลด PDF กรรมการ/, 'committee PDF must not be presented as a download action')
assert.doesNotMatch(detail, /<span>\{activeAttachments\.length\} ไฟล์ · \{checklist\.committees\.length\} รายชื่อ<\/span>/, 'the stock officer toolbar should not repeat a combined file/member count')
assert.match(detail, /<Button type="button" variant="primary" onClick=\{\(\) => openPreview\(attachment\)\}>เปิดดู<\/Button>/, 'file preview actions need high-contrast buttons')
assert.match(detail, /openCommitteePdf/, 'committee PDF should open in the existing preview dialog')
assert.match(detail, /PDF รายชื่อกรรมการ/, 'committee PDF preview needs an accessible title')
assert.match(detail, /aria-labelledby=\{previewTitleId\}/, 'preview dialog needs an accessible name')
assert.match(detail, /id=\{previewTitleId\}/, 'preview dialog title must be linked to the dialog')
assert.match(detail, /pr-checklist-detail__group-heading/, 'files and committees need visible group headings')
assert.match(detail, /เอกสารหลัก/, 'detail attachments should mirror the create-PR primary document group')
assert.match(detail, /ใบเสนอราคาจากบริษัท/, 'detail attachments should mirror the create-PR quotation group')
assert.match(detail, /primaryAttachments/, 'detail attachments should separate primary documents from quotations')
assert.match(detail, /quotationAttachments/, 'detail attachments should keep quotation slots together')
assert.match(detail, /pr-checklist-detail__files--quotation/, 'quotation files need their own responsive grid')
assert.match(detail, /attachmentKindOrder/, 'attachment details should keep primary documents before quotations')
assert.match(detail, /COMMITTEE_ORDER: PurchaseRequestCommitteeKind\[\] = \['specification', 'result', 'inspection'\]/, 'all three committee sets need a stable display order')
assert.match(detail, /aria-labelledby=\{`pr-checklist-detail-committee-\$\{kind\}-title`\}/, 'each committee set needs its own accessible heading')
assert.match(detail, /committee-pdf/)
assert.match(detail, /<dialog/)
assert.match(detail, /checklist\/\$\{preview\.id\}/)
assert.match(detail, /canDownloadCommitteePdf/)

const committeePdfRoute = read('app/api/purchase-requests/[id]/checklist/committee-pdf/route.ts')
assert.match(committeePdfRoute, /Content-Disposition.*inline/, 'committee PDF preview must render inline in the browser')

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
assert.match(styles, /\.committee-picker__control input \{[^}]*border:/, 'committee inputs need a visible border')
assert.match(styles, /\.committee-picker__control input:focus/, 'committee inputs need a visible focus state')
assert.match(styles, /\.pr-checklist__file-group \+ \.pr-checklist__file-group\s*\{[^}]*border-top:/, 'attachment kinds need a visible divider')
assert.match(styles, /\.pr-checklist__file-grid--primary\s*\{[^}]*repeat\(2,/, 'primary documents need at most two desktop columns')
assert.match(styles, /\.pr-checklist__file-grid--quotation\s*\{[^}]*repeat\(3,/, 'quotation documents need three wide-desktop columns')
assert.match(styles, /\.pr-checklist__file-state\.is-complete/, 'completed cards need written-state styling')
const mediaBlocks = (query: string) => {
  const blocks: string[] = []
  let offset = 0
  while (offset < styles.length) {
    const start = styles.indexOf(query, offset)
    if (start === -1) break
    const end = styles.indexOf('\n}', start)
    assert.notEqual(end, -1, `${query} must be closed`)
    blocks.push(styles.slice(start, end + 2))
    offset = end + 2
  }
  assert.notEqual(blocks.length, 0, `${query} must exist`)
  return blocks
}

const tabletStyles = mediaBlocks('@media (max-width: 1180px)')
assert.ok(
  tabletStyles.some((block) => /\.pr-checklist__file-grid--quotation\s*\{[^}]*repeat\(2,/.test(block)),
  'quotation grid needs a tablet breakpoint',
)

const mobileStyles = mediaBlocks('@media (max-width: 700px)')
assert.ok(
  mobileStyles.some((block) => /\.pr-checklist__file-grid, \.pr-checklist-detail__files\s*\{[^}]*grid-template-columns: 1fr;/.test(block)),
  'all attachment groups need a mobile breakpoint',
)
assert.match(styles, /\.pr-checklist-detail\s*\{[^}]*border-bottom:\s*2px solid/, 'checklist and review need a visible divider')
assert.match(styles, /\.pr-checklist-detail__group \+ \.pr-checklist-detail__group\s*\{[^}]*border-top:\s*2px solid/, 'attachment and committee groups need a visible divider')
assert.match(styles, /\.pr-checklist-detail__committees section\s*\{[^}]*border-left:\s*3px solid/, 'committee sets should use a flat accent lane instead of a nested box border')
assert.match(styles, /\.pr-checklist-detail__files article\s*\{[^}]*border: 1px solid color-mix/, 'attachment cards need a slightly stronger rectangular border')
assert.match(styles, /\.pr-checklist-detail__files--quotation\s*\{[^}]*repeat\(3,/, 'quotation files should use the same wide desktop grouping as the create-PR page')
assert.match(styles, /@media \(max-width: 800px\) \{[\s\S]*?\.pr-checklist-detail__toolbar/, 'the checklist toolbar must stack before tablet width')

console.log('purchase request checklist UI: ok')
