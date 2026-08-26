import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(path, 'utf8')

const printPage = read('app/(protected)/purchase-requests/[id]/print/page.tsx')
assert.match(printPage, /params:\s*Promise</)
assert.match(printPage, /PurchaseRequestPrint/)
assert.match(printPage, /getPurchaseRequest/)
assert.match(printPage, /requireActor/)

const detailPage = read('app/(protected)/purchase-requests/[id]/page.tsx')
assert.match(detailPage, /purchase-requests\/\$\{request\.id\}\/print/)
assert.match(detailPage, /พิมพ์ใบ PR/)

const printComponent = read('components/pr/PurchaseRequestPrint.tsx')

// The printed form keeps the requisition's paper identity while making the
// purchase decision and source identifiers visible to the approver.
assert.match(printComponent, /โรงพยาบาลชลบุรี/)
assert.match(printComponent, /ใบขอซื้อ \(PR\)/)
assert.match(printComponent, /เลขที่ PR/)
assert.match(printComponent, /วันที่ขอซื้อ/)
assert.match(printComponent, /หน่วยงานผู้ขอ/)
assert.match(printComponent, /PURCHASE_PURPOSE_LABELS/)
assert.match(printComponent, /PURCHASE_METHOD_LABELS/)
assert.match(printComponent, /request\.methodDetails/)
assert.match(
  printComponent,
  /case 'annual_plan':[\s\S]*add\('ลำดับในแผนจัดซื้อ'[\s\S]*facts\.push\(methodFact\)/,
  'annual-plan purpose and plan sequence stay in the first reference row',
)

// Line-level values needed for an auditable request-to-order handoff.
assert.match(printComponent, /รหัสพัสดุ \(LS\)/)
assert.match(printComponent, /อัตราใช้<\s*br\s*\/?>\s*เฉลี่ย\/เดือน/) // average monthly usage
assert.match(printComponent, /จำนวนที่ขอ/)
assert.match(printComponent, /ราคาต่อหน่วย/)
assert.match(printComponent, /จำนวนเงิน/)
assert.match(printComponent, /pr-print-table/)
assert.match(printComponent, /formatQuantity/)
assert.match(printComponent, /formatBaht/)

// The warehouse verification block prints the captured officer/date when the
// PR has been acknowledged, and keeps a clear paper placeholder otherwise.
assert.match(printComponent, /request\.acknowledgedByName/)
assert.match(printComponent, /request\.acknowledgedAt/)
assert.match(printComponent, /print-signature__name/)
assert.match(printComponent, /เจ้าหน้าที่คลัง/)
assert.match(printComponent, /printDateOrPlaceholder/)

const printCss = read('app/globals.css')
assert.match(printCss, /@page\s*\{[^}]*size:\s*A4/i)
assert.match(printCss, /@media print/i)
assert.match(printCss, /\.pr-print-reference/)
assert.match(printCss, /\.pr-print-table\s*\{[^}]*table-layout:\s*fixed/i)
assert.match(printCss, /\.pr-print-table-wrap\s*\{[^}]*overflow:\s*visible/i)
assert.doesNotMatch(printCss, /\.pr-print-table-wrap\s*\{[^}]*overflow-x:\s*auto/i)
assert.match(printCss, /\.pr-print-table__col--total\s*\{\s*width:\s*14%/i)
assert.match(printCss, /\.pr-print-signatures\s*\{[^}]*margin-top:/i)

console.log('purchase-request print: ok')
