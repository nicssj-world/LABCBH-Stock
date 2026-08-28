import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(path, 'utf8')

const printPage = read('app/(protected)/requisitions/[id]/print/page.tsx')
assert.match(printPage, /params:\s*Promise</)
assert.match(printPage, /RequisitionPrint/)
assert.match(printPage, /loadPortalSignatureDataUri/)
assert.match(printPage, /requisition\.fulfilledBy/)
assert.match(printPage, /fulfilledBySignature/)

const printComponent = read('components/requisitions/RequisitionPrint.tsx')

// Identity of the document.
assert.match(printComponent, /โรงพยาบาลชลบุรี/)
assert.match(printComponent, /กลุ่มงานเทคนิคการแพทย์/)
assert.match(printComponent, /ใบเบิก/)
assert.match(printComponent, /เลขที่/)
assert.match(printComponent, /วันที่/)
assert.match(printComponent, /หน่วยงาน/)
assert.match(printComponent, /ผู้ขอเบิก/)

// Line detail, including which lots actually went out.
assert.match(printComponent, /จำนวนที่ขอ/)
assert.match(printComponent, /จำนวนที่จ่าย/)
assert.match(printComponent, /เหตุผลจ่ายไม่ครบ/)
assert.match(printComponent, /shortIssueReason/)
assert.match(printComponent, /เลขที่ล็อต/)
assert.match(printComponent, /วันหมดอายุ/)
assert.match(printComponent, /วันที่จ่าย/)

// Both signature blocks are required by the paper process. The roles live in
// the shared print module so the form and any future document agree.
assert.match(printComponent, /SIGNATURE_BLOCKS/)
assert.match(printComponent, /ลงชื่อ/)

// The issuer is identified from the fulfilment audit snapshot, not asked to
// sign the printed form by hand. The fulfilment date is repeated in that block.
assert.match(printComponent, /requisition\.fulfilledByName/)
assert.match(printComponent, /requisition\.fulfilledAt\?\.slice\(0, 10\)/)
assert.match(printComponent, /fulfilledBySignature/)
assert.match(printComponent, /ลายเซ็นต์เจ้าหน้าที่คลังผู้จ่ายของ/)
assert.match(printComponent, /ไม่พบลายเซ็นต์ใน Portal/)
assert.match(printComponent, /\(\{block\.hint\}\)/, 'signature roles use the requested parenthesized labels')
assert.match(printComponent, /print-signature__mark/, 'signature content reserves a shared row for alignment')

// The receiver's block prints the digitally captured signature once it
// exists, instead of a blank line the recipient has already signed on-screen.
assert.match(printComponent, /requisition\.signature/, 'the print view must check for a captured digital signature')
assert.match(printComponent, /requisition\.receivedByName/)
assert.match(printComponent, /print-signature__image/)

const printCss = read('app/globals.css')
assert.match(printCss, /\.print-table\s*\{[\s\S]{0,140}font-size:\s*9px/, 'the print table uses a compact font size')
assert.match(printCss, /\.print-table th,[\s\S]{0,220}white-space:\s*nowrap/, 'print table cells stay on one line')
assert.match(printCss, /@page\s*\{[^}]*size:\s*A4/i)
assert.match(printCss, /@page\s*\{[^}]*margin:\s*12mm/i)
assert.match(printCss, /@media print/i)
assert.match(
  printCss,
  /@media print[\s\S]{0,600}\.app-shell|\.bench-rail[\s\S]{0,120}display:\s*none/i,
  'chrome must be hidden when printing',
)
assert.match(printCss, /Noto Sans Thai/, 'Thai text must stay embedded in print')
assert.match(
  printCss,
  /\.print-signatures[\s\S]{0,200}break-inside:\s*avoid/i,
  'signature blocks must not be split across pages',
)
assert.match(printCss, /--print-signature-slot-height:\s*clamp\(/i, 'signature slots scale between form sizes')
assert.match(printCss, /max-inline-size:\s*min\(100%,\s*var\(--print-signature-max-inline\)\)/i, 'signatures fit the available form width')
assert.match(printCss, /max-block-size:\s*min\(100%,\s*var\(--print-signature-max-block\)\)/i, 'signatures fit the available form height')
assert.match(printCss, /object-fit:\s*contain/i, 'signatures keep their aspect ratio')
assert.match(printCss, /\.print-signature__mark[\s\S]{0,240}overflow:\s*hidden/i, 'signature ink cannot overflow its form slot')

const print = read('lib/requisitions/print.ts')
assert.match(print, /formatDocumentDate|toThaiPrintDate/)
assert.match(print, /543/, 'printed dates use the Buddhist era')
assert.match(print, /ผู้จ่ายของ/)
assert.match(print, /หัวหน้าหน่วยงานผู้รับ/)

console.log('requisition print: ok')
