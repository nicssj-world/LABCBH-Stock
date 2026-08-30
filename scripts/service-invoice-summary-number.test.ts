import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { normalizeInvoiceSummaryNumber } from '../lib/service-procurement/invoice-summary-number'

const migrationPath = 'supabase/migrations/20260829192920_service_invoice_summary_numbering.sql'
const migration = readFileSync(migrationPath, 'utf8')
const numberModulePath = 'lib/service-procurement/invoice-summary-number.ts'
const numberModule = existsSync(numberModulePath) ? readFileSync(numberModulePath, 'utf8') : ''
const exportLink = readFileSync('components/service-procurement/ServicePurchaseRequestInvoiceExportLink.tsx', 'utf8')
const route = readFileSync('app/api/service-procurement/purchase-requests/[id]/invoice-summary/route.ts', 'utf8')
const invoiceSummary = readFileSync('lib/service-procurement/invoice-summary.ts', 'utf8')

assert.match(migration, /create table if not exists public\.service_purchase_request_invoice_numbers/i, 'invoice summary numbers must be persisted')
assert.match(migration, /unique \(fiscal_year, sequence_number\)/i, 'invoice summary numbers must be unique within a fiscal year')
assert.match(migration, /unique \(purchase_request_id\)/i, 'each PO must keep one invoice summary number')
assert.match(migration, /create or replace function public\.get_service_invoice_summary_number\(/i, 'the export dialog needs an authoritative next-number RPC')
assert.match(migration, /create or replace function public\.claim_service_invoice_summary_number\(/i, 'export must claim the number atomically')
assert.match(migration, /pg_advisory_xact_lock/i, 'number claims must be serialized per fiscal year')
assert.match(migration, /เลขสรุปใบแจ้งหนี้นี้ถูกใช้แล้ว/i, 'duplicate numbers must have a clear database error')

assert.match(numberModule, /normalizeInvoiceSummaryNumber\(/, 'number input must share a canonical formatter')
assert.match(numberModule, /padStart\(2, '0'\)/, 'invoice summary numbers must use at least two digits')
assert.match(exportLink, /'use client'/, 'invoice export must open an interactive dialog')
assert.match(exportLink, /mode=number/, 'export dialog must load the current suggestion')
assert.match(exportLink, /method: 'POST'/, 'export dialog must submit the chosen number')
assert.match(exportLink, /requestedNumber/, 'export dialog must distinguish a manual number from the default suggestion')
assert.match(route, /export async function POST/, 'invoice summary route must claim a number before generating PDF')
assert.match(route, /claim_service_invoice_summary_number/, 'invoice summary route must use the atomic claim RPC')
assert.match(route, /X-Service-Invoice-Summary-Number/, 'the route must return the canonical number to the dialog')
assert.match(invoiceSummary, /invoiceSummaryNumber: string/, 'the PDF model must receive the assigned summary number')
assert.match(invoiceSummary, /model\.invoiceSummaryNumber/, 'the assigned summary number must render in the top-right corner')
assert.equal(normalizeInvoiceSummaryNumber('1/2569', 2569), '01/2569')
assert.equal(normalizeInvoiceSummaryNumber('1/2570', 2570), '01/2570')
assert.equal(normalizeInvoiceSummaryNumber('01/2568', 2569), null)
assert.equal(normalizeInvoiceSummaryNumber('00/2569', 2569), null)

console.log('service invoice summary numbering: ok')
