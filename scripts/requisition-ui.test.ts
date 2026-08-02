import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(path, 'utf8')

const newPage = read('app/(protected)/requisitions/new/page.tsx')
const listPage = read('app/(protected)/requisitions/page.tsx')
assert.match(listPage, /searchParams:\s*Promise</, 'the requisition list reads URL filters on the server')
assert.match(listPage, /หน่วยงาน/, 'requesters can filter requisitions by department')
assert.match(listPage, /AutoFilterBench/, 'requisition filters must update the list immediately')
assert.doesNotMatch(listPage, /แสดงผล/, 'requisition filters must not require an apply button')
assert.match(newPage, /RequisitionForm/)
assert.match(newPage, /DEPARTMENTS/)
assert.match(newPage, /departments=\{DEPARTMENTS\}/)

const form = read('components/requisitions/RequisitionForm.tsx')
assert.match(form, /departments: readonly string\[\]/)
assert.match(form, /<select required value=\{department\}/)
assert.match(form, /\{departments\.map\(\(department\)/)
assert.doesNotMatch(form, /<input type="text" required value=\{department\}/)
assert.match(form, /CatalogItemCombobox/, 'requisition items must be searchable by typing')
const catalogCombobox = read('components/ui/CatalogItemCombobox.tsx')
assert.match(catalogCombobox, /พิมพ์รหัส LS หรือชื่อรายการ/, 'requisition item search must provide a hint')

const queries = read('lib/requisitions/queries.ts')
assert.match(queries, /department\?: string/, 'requisition queries accept a department filter')
assert.match(queries, /filters\.department/, 'requisition queries apply the department filter')

console.log('requisition UI: ok')
