import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

const tablePath = 'components/service-procurement/ServicePurchaseRequestTable.tsx'
const summaryPath = 'components/service-procurement/ServicePurchaseRequestSummaryDialog.tsx'
const exportLinkPath = 'components/service-procurement/ServicePurchaseRequestInvoiceExportLink.tsx'
const invoiceSummaryPath = 'lib/service-procurement/invoice-summary.ts'
const routePath = 'app/api/service-procurement/purchase-requests/[id]/invoice-summary/route.ts'

assert.equal(existsSync(exportLinkPath), true, 'Red Cross invoice export link must exist')
assert.equal(existsSync(routePath), true, 'invoice summary PDF route must exist')

const table = readFileSync(tablePath, 'utf8')
const summary = readFileSync(summaryPath, 'utf8')
const exportLink = readFileSync(exportLinkPath, 'utf8')
const invoiceSummary = readFileSync(invoiceSummaryPath, 'utf8')
const route = readFileSync(routePath, 'utf8')

assert.doesNotMatch(table, /ServicePurchaseRequestInvoiceExportLink/, 'PR list must not show the invoice export button')
assert.doesNotMatch(summary, /ServicePurchaseRequestInvoiceExportLink/, 'compact PR summary must not show the invoice export button')
assert.doesNotMatch(invoiceSummary, /LABCBH Stock · งานจ้าง/, 'invoice summary PDF must not show the product label in the header')
assert.doesNotMatch(invoiceSummary, /LABCBH Stock · สรุปใบแจ้งหนี้/, 'invoice summary PDF must not show the product label in the footer')
assert.doesNotMatch(invoiceSummary, /const poMeta = `เลข PO/, 'invoice summary PDF must not show a centered PO label')
assert.match(invoiceSummary, /const labelWidth = COLUMNS\[3\]\.width/, 'invoice summary total label must stay in its own table columns')
assert.match(invoiceSummary, /const BODY_FONT_SIZE = 9/, 'invoice summary table body text must use the smaller print size')
assert.match(invoiceSummary, /const CREDIT_REFERENCE_FONT_SIZE = 7/, 'credit-note references must use a smaller print size')
assert.match(invoiceSummary, /const CREDIT_REFERENCE_LINE_GAP = 4/, 'credit-note references must have extra line spacing')
assert.match(invoiceSummary, /const HEADER_FONT_SIZE = 9/, 'invoice summary table headers must use the smaller print size')
assert.match(invoiceSummary, /function drawTableGrid\(/, 'invoice summary table must have one complete grid renderer')
assert.match(invoiceSummary, /drawTableGrid\(page, top, bottom/, 'invoice summary rows must render complete table lines')
assert.match(invoiceSummary, /sequence: number \| null/, 'credit-note rows must not require a sequence number')
assert.match(invoiceSummary, /row\.sequence === null \? '' : String\(row\.sequence\)/, 'credit-note sequence cells must stay blank')
assert.match(invoiceSummary, /\\nอ้างอิง \$\{row\.sourceInvoiceNumber/, 'credit-note source reference must render on the second line')
assert.match(invoiceSummary, /header: 'เลขที่ใบแจ้งหนี้', width: 142, align: 'center'/, 'invoice number column must be centered')
assert.match(invoiceSummary, /const HEADER_TITLE_FONT_SIZE = 14/, 'invoice summary title must use a smaller print size')
assert.match(invoiceSummary, /function fitHeaderTitleSize\(/, 'invoice summary title must adapt to long plan names')
assert.match(invoiceSummary, /size: titleSize/, 'invoice summary title must use the fitted size')
assert.match(invoiceSummary, /const invoiceSummaryLabel = `เลขที่ \$\{model\.invoiceSummaryNumber\}`/, 'invoice summary number must include its label')
assert.match(exportLink, /สรุปใบแจ้งหนี้/)
assert.match(exportLink, /download/)
assert.match(exportLink, /application\/pdf|PDF/)
assert.match(route, /getServicePurchaseRequest/)
assert.match(route, /request\.isRedCross/)
assert.match(route, /generateServiceInvoiceSummaryPdf/)
assert.match(route, /Content-Disposition/)

console.log('service invoice summary UI: ok')
