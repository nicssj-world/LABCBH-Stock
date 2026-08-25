import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(path, 'utf8')
for (const path of [
  'app/(protected)/service-procurement/plans/page.tsx',
  'app/(protected)/service-procurement/plans/new/page.tsx',
  'app/(protected)/service-procurement/plans/[id]/page.tsx',
  'app/(protected)/service-procurement/purchase-requests/page.tsx',
  'app/(protected)/service-procurement/purchase-requests/new/page.tsx',
  'app/(protected)/service-procurement/purchase-requests/[id]/page.tsx',
]) assert.equal(existsSync(path), true, `${path} must exist`)

const shell = read('components/ui/AppShell.tsx')
assert.match(shell, /href: '\/service-procurement', label: 'งานจ้าง'/)
assert.match(shell, /href: '\/service-procurement\/plans', label: 'แผนงานจ้าง'/)
assert.match(shell, /href: '\/service-procurement\/purchase-requests', label: 'ใบ PR \(งานจ้าง\)'/)
assert.match(shell, /โมดูลย่อยงานจ้าง/)
assert.match(shell, /bench-nav--nested/)
const plansPage = read('app/(protected)/service-procurement/plans/page.tsx')
const purchaseRequestsPage = read('app/(protected)/service-procurement/purchase-requests/page.tsx')
assert.match(plansPage, /ดูปีย้อนหลัง/)
assert.doesNotMatch(plansPage, /service-procurement-tabs/)
assert.doesNotMatch(purchaseRequestsPage, /service-procurement-tabs/)
assert.doesNotMatch(read('app/globals.css'), /\.service-procurement-tabs/)
assert.match(read('app/globals.css'), /\.bench-nav__group--service/)
assert.match(read('components/service-procurement/ServicePurchaseRequestForm.tsx'), /SELECT ITEMS/)
assert.match(read('components/service-procurement/ServicePurchaseRequestControls.tsx'), /แจ้งเตือนผ่าน LINE/)
assert.match(read('components/service-procurement/ServicePurchaseRequestHeaderEdit.tsx'), /แก้ไขข้อมูลก่อนคลังยืนยัน/)
assert.match(read('app/(protected)/out-lab/page.tsx'), /permanentRedirect\('\/service-procurement\/plans\?notice=legacy-out-lab'/)
assert.equal(existsSync('lib/out-lab/actions.ts'), false, 'legacy Out Lab library must be removed')
assert.equal(existsSync('components/out-lab/OutLabTable.tsx'), false, 'legacy Out Lab components must be removed')
assert.equal(existsSync('app/api/out-lab/[id]/file/route.ts'), false, 'legacy Out Lab API must be removed')
assert.doesNotMatch(read('app/globals.css'), /\.out-lab-missing-periods/)

console.log('service procurement ui: ok')
