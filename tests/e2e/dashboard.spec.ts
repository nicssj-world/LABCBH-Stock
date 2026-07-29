import { allowMutations, expect, loginAs, missingFixtureReason, requireFixtures, strictFixtures, test } from './support'

const requiredUrls = ['E2E_RECEIPT_DRAFT_URL', 'E2E_REQUISITION_WAITING_URL']
const missing = missingFixtureReason(['admin'], requiredUrls)

test.describe('admin dashboard and settings smoke', () => {
  test.skip(!strictFixtures && (Boolean(missing) || !allowMutations), `preview fixtures unavailable: ${missing || 'mutations disabled'}`)
  test.beforeAll(() => requireFixtures(['admin'], requiredUrls))

  test('@smoke shows live watchlist and gives admin 9495 every workflow surface', async ({ page }) => {
    await loginAs(page, 'admin')
    await expect(page.getByRole('heading', { name: 'ภาพรวมบริหารสัญญา' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'รายการที่ต้องเฝ้าระวัง' })).toBeVisible()
    for (const [path, heading] of [
      ['/contracts/new', 'เพิ่มสัญญา'],
      ['/purchase-requests/new', 'สร้างใบขอซื้อ'],
      ['/receipts/new', 'สร้างใบรับเข้า'],
      ['/requisitions/new', 'สร้างใบเบิก'],
    ] as const) {
      await page.goto(path)
      await expect(page.getByRole('heading', { name: heading })).toBeVisible()
    }
    await page.goto(process.env.E2E_RECEIPT_DRAFT_URL!)
    await expect(page.getByRole('button', { name: 'บันทึกเข้าคลัง' })).toBeVisible()
    await page.goto(process.env.E2E_REQUISITION_WAITING_URL!)
    await expect(page.getByRole('heading', { name: 'เลือกล็อตเพื่อจ่ายของ' })).toBeVisible()
    await page.goto('/settings/access')
    await expect(page.getByRole('heading', { name: 'สิทธิ์การใช้งานระบบคลัง' })).toBeVisible()
  })
})
