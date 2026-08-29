import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(path, 'utf8')
const form = read('components/service-procurement/ServicePlanForm.tsx')
const css = read('app/globals.css')

assert.ok(form.includes("className={'checkbox-row' + (isRedCross ? ' is-checked' : '')}"))
assert.ok(form.includes("className={'checkbox-row' + (requiresContract ? ' is-checked' : '') + (hasRequests ? ' is-disabled' : '')}"))
assert.ok(form.includes('<span>สภากาชาดไทย</span>'))
assert.ok(form.includes('<span>ทำสัญญา {hasRequests'))
assert.ok(!form.includes('เมื่อเปิดใช้'))
assert.ok(form.includes('unitPrice: string'))
assert.ok(form.includes('ราคาต่อหน่วย (บาท)'))
assert.ok(form.includes('service-plan-test-items-table'))
assert.ok(form.includes('<tr key={item.id}>'))
assert.ok(!form.includes('key={`${index}-${item.name}`}'))
assert.ok(form.includes('<MoneyInput required min="0.01" step="0.01"'))
assert.ok(css.includes('.service-plan-form .checkbox-row {'))
assert.ok(css.includes('.service-plan-form .checkbox-row input[type="checkbox"] {'))
assert.ok(css.includes('min-height: 44px;'))
assert.ok(css.includes('width: 18px;'))
assert.ok(css.includes('height: 18px;'))
assert.ok(css.includes('.service-plan-form .checkbox-row.is-checked {'))
assert.ok(css.includes('.service-plan-form .checkbox-row.is-disabled {'))
assert.ok(css.includes('.service-plan-form .service-plan-test-items-table :is(td, th) > input {'))
assert.ok(css.includes('width: 100%; text-align: left;'))

console.log('service plan form checkbox UI: ok')
