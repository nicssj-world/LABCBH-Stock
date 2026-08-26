import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  filterServicePlanCandidates,
  toggleServicePlanCandidate,
  type ServicePlanResponsibleCandidate,
} from '../lib/service-procurement/responsible-picker'

const candidates: ServicePlanResponsibleCandidate[] = Array.from({ length: 10 }, (_, index) => ({
  id: `profile-${index}`,
  name: `ผู้ใช้ ${index}`,
  ephisId: `EPHIS-${index}`,
  positionTitle: index % 2 === 0 ? 'นักเทคนิคการแพทย์' : null,
}))

assert.equal(filterServicePlanCandidates(candidates, '').length, 8, 'empty search must cap results at eight')
assert.deepEqual(
  filterServicePlanCandidates(candidates, 'EPHIS-9').map((candidate) => candidate.id),
  ['profile-9'],
  'search must match E-Phis IDs',
)
assert.deepEqual(
  filterServicePlanCandidates(candidates, 'ผู้ใช้ 3').map((candidate) => candidate.id),
  ['profile-3'],
  'search must match names',
)
assert.deepEqual(toggleServicePlanCandidate(['profile-1', 'profile-2'], 'profile-1'), ['profile-2'])
assert.deepEqual(toggleServicePlanCandidate(['profile-1'], 'profile-3'), ['profile-1', 'profile-3'])
assert.deepEqual(toggleServicePlanCandidate(['profile-1', 'profile-3'], 'profile-3'), ['profile-1'])

const read = (path: string) => readFileSync(path, 'utf8')
const form = read('components/service-procurement/ServicePlanForm.tsx')
const dialog = read('components/service-procurement/ServicePlanResponsibleDialog.tsx')
const detail = read('app/(protected)/service-procurement/plans/[id]/page.tsx')
const css = read('app/globals.css')

assert.doesNotMatch(form, /ServicePlanResponsibleDialog/, 'responsible assignment must not be embedded in the service plan form')
assert.doesNotMatch(form, /service-plan-responsible-panel/, 'service plan form must not render a responsible assignment panel')
assert.doesNotMatch(form, /service-responsible-grid/, 'the unbounded all-candidates grid must be removed')
assert.doesNotMatch(css, /\.service-responsible-grid/, 'the removed all-candidates grid must not leave stale styling')
assert.match(form, /<label className="field-row form-grid__wide">\s*<span>ชื่อแผน/, 'plan name must span the full form row')
const nameIndex = form.indexOf('ชื่อแผน')
const departmentIndex = form.indexOf('หน่วยงาน')
const budgetIndex = form.indexOf('วงเงิน (บาท)')
const typeIndex = form.indexOf('ประเภท')
const fiscalYearIndex = form.indexOf('ปีงบประมาณ')
assert.ok(nameIndex < departmentIndex && departmentIndex < budgetIndex && budgetIndex < typeIndex && typeIndex < fiscalYearIndex, 'fiscal year must be the final plan detail field')
assert.match(detail, /ServicePlanResponsibleDialog/, 'plan detail must own responsible assignment')
assert.match(detail, /listServiceCommitteeCandidates/, 'plan detail must load responsible candidates for managers')
assert.match(dialog, /<dialog/, 'responsible picker must use a native dialog')
assert.match(dialog, /type="search"/, 'responsible picker must expose a searchable input')
assert.match(dialog, /setServicePlanResponsibles/, 'responsible picker must persist through the plan action')
assert.match(dialog, /planId/, 'responsible picker must identify the plan being updated')
assert.match(dialog, /บันทึกผู้รับผิดชอบ/, 'dialog must have an explicit save action')
assert.match(dialog, /ยกเลิก/, 'dialog must have an explicit cancel action')
assert.match(dialog, /aria-labelledby=/, 'dialog must expose an accessible name')
assert.match(css, /\.service-plan-form \.form-action-bar\s*\{[\s\S]*?position:\s*static/, 'service plan action bar must not occlude picker content')

console.log('service plan responsible picker: ok')
