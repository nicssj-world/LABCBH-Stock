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
assert.match(shell, /const \[serviceProcurementOpen, setServiceProcurementOpen\]/, 'งานจ้างต้องมี state สำหรับยุบและขยายเมนูย่อย')
assert.match(shell, /className="bench-nav__accordion-trigger"/, 'หัวข้องานจ้างต้องเป็นปุ่ม accordion')
assert.match(shell, /aria-expanded=\{serviceProcurementOpen\}/, 'ปุ่มงานจ้างต้องประกาศสถานะเปิดให้ assistive technology')
assert.match(shell, /aria-controls="service-procurement-subnav"/, 'ปุ่มงานจ้างต้องเชื่อมกับรายการเมนูย่อย')
assert.match(shell, /setServiceProcurementOpen\(\(open\) => !open\)/, 'ปุ่มงานจ้างต้องสลับสถานะเมนูย่อยได้')
assert.match(shell, /bench-nav__accordion-chevron/, 'หัวข้องานจ้างต้องมี chevron แสดงสถานะ')
assert.match(shell, /bench-nav--nested/)
const plansPage = read('app/(protected)/service-procurement/plans/page.tsx')
const purchaseRequestsPage = read('app/(protected)/service-procurement/purchase-requests/page.tsx')
assert.match(plansPage, /AutoFilterBench/)
assert.match(purchaseRequestsPage, /AutoFilterBench/)
assert.match(plansPage, /showClear=\{false\}/)
assert.match(purchaseRequestsPage, /showClear=\{false\}/)
assert.doesNotMatch(plansPage, /กรองรายการ|ดูปีย้อนหลัง/)
assert.doesNotMatch(purchaseRequestsPage, /กรองรายการ|ดูปีย้อนหลัง/)
assert.doesNotMatch(plansPage, /service-procurement-tabs/)
assert.doesNotMatch(purchaseRequestsPage, /service-procurement-tabs/)
assert.doesNotMatch(read('app/globals.css'), /\.service-procurement-tabs/)
assert.match(read('app/globals.css'), /\.bench-nav__group--service/)
assert.match(read('app/globals.css'), /\.bench-nav__group--service:not\(\.is-open\) \.bench-nav--nested/, 'เมนูย่อยต้องถูกซ่อนเมื่อ accordion ปิด')
assert.match(read('app/globals.css'), /\.bench-nav__group--service\.is-open \.bench-nav__accordion-chevron/, 'chevron ต้องเปลี่ยนทิศเมื่อ accordion เปิด')
assert.match(read('components/ui/AutoFilterBench.tsx'), /onChange=\{handleSelectChange\}/)
assert.match(read('components/service-procurement/ServicePurchaseRequestForm.tsx'), /SELECT ITEMS/)
assert.match(read('components/service-procurement/ServicePurchaseRequestControls.tsx'), /แจ้งเตือนผ่าน LINE/)
assert.match(read('components/service-procurement/ServicePurchaseRequestHeaderEdit.tsx'), /แก้ไขข้อมูลก่อนคลังยืนยัน/)
assert.match(read('app/(protected)/out-lab/page.tsx'), /permanentRedirect\('\/service-procurement\/plans\?notice=legacy-out-lab'/)
assert.equal(existsSync('lib/out-lab/actions.ts'), false, 'legacy Out Lab library must be removed')
assert.equal(existsSync('components/out-lab/OutLabTable.tsx'), false, 'legacy Out Lab components must be removed')
assert.equal(existsSync('app/api/out-lab/[id]/file/route.ts'), false, 'legacy Out Lab API must be removed')
assert.doesNotMatch(read('app/globals.css'), /\.out-lab-missing-periods/)

console.log('service procurement ui: ok')
