import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(path, 'utf8')
const page = read('app/(protected)/annual-plans/page.tsx')
const grid = read('components/annual-plans/AnnualPlanGrid.tsx')
const dropzone = read('components/annual-plans/AnnualPlanUploadDropzone.tsx')
const dialog = read('components/annual-plans/AnnualPlanPreviewDialog.tsx')
const css = read('app/globals.css')

assert.match(page, /แผนประจำปี/)
assert.match(page, /retainedFiscalYears|listAnnualPlanSlots/)
assert.match(grid, /AnnualPlanCard/)
assert.match(dropzone, /application\/pdf/)
assert.match(dropzone, /onDragEnter|onDrop/)
assert.match(dropzone, /type="file"/)
assert.match(dropzone, /role="alert"|aria-live/)
assert.match(dropzone, /fetch\(\s*['"]\/api\/annual-plans\/upload['"]\s*,/)
assert.doesNotMatch(dropzone, /import\s+\{\s*uploadAnnualPlan\s*\}/, 'binary uploads must use the JSON route handler')
assert.match(dropzone, /response\.ok/)
assert.match(dropzone, /response\.json\(\)/)
assert.match(dialog, /iframe/)
assert.match(dialog, /ดาวน์โหลด/)
assert.match(dialog, /onCancel/)
assert.match(css, /annual-plan/)

console.log('annual plan UI: ok')
