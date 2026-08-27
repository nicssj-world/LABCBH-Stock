import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(path, 'utf8')
const viewer = read('components/ui/PdfDocumentViewer.tsx')
const documentPreview = read('components/ui/DocumentPreview.tsx')
const styles = read('app/globals.css')
const previewComponents = [
  read('components/annual-plans/AnnualPlanPreviewDialog.tsx'),
  read('components/contracts/ContractFileCard.tsx'),
  read('components/contracts/ContractSummaryDialog.tsx'),
  read('components/pr/PurchaseRequestChecklistPanel.tsx'),
  read('components/pr/PurchaseRequestPoFileOpenButton.tsx'),
]

assert.match(viewer, /pdfjs-dist\/legacy\/build\/pdf\.mjs/)
assert.match(viewer, /pdf\.worker\.min\.mjs/)
assert.match(viewer, /document\.numPages/)
assert.match(viewer, /pageNumber <= pageCount/)
assert.match(viewer, /role="region"/)
assert.match(viewer, /ลองใหม่/)
assert.match(documentPreview, /PdfDocumentViewer/)
assert.match(documentPreview, /document-preview--image/)
for (const source of previewComponents) {
  assert.doesNotMatch(source, /<iframe/, 'document previews must not depend on native iframe PDF viewers')
}
assert.match(styles, /\.pdf-document-viewer__viewport[^}]*overflow: auto/)
assert.match(styles, /touch-action: pan-y/)
assert.match(styles, /env\(safe-area-inset-bottom\)/)

for (const route of [
  'app/api/contracts/[id]/file/view/route.ts',
  'app/api/annual-plans/[id]/file/route.ts',
  'app/api/annual-plans/versions/[id]/file/route.ts',
  'app/api/purchase-requests/[id]/checklist/[attachmentId]/route.ts',
  'app/api/purchase-requests/[id]/po-file/view/route.ts',
]) {
  const source = read(route)
  assert.match(source, /Content-Disposition/)
  assert.match(source, /inline;/)
  assert.match(source, /new Response/)
}

console.log('PDF preview UI: ok')
