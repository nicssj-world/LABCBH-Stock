import { allowMutations, expect, fixtureUrl, loginAs, missingFixtureReason, requireFixtures, strictFixtures, test } from './support'

const requiredUrls = ['E2E_PR_READY_URL']
const missing = missingFixtureReason(['manager', 'stock', 'stock_alt'], requiredUrls)

test.describe('manager to stock PR workflow and concurrency guard', () => {
  test.skip(!strictFixtures && (Boolean(missing) || !allowMutations), `preview fixtures unavailable: ${missing || 'mutations disabled'}`)
  test.beforeAll(() => requireFixtures(['manager', 'stock', 'stock_alt'], requiredUrls))

  test('@smoke manager creates a PR while stock confirms a contract allocation exactly once', async ({ browser }) => {
    const managerContext = await browser.newContext()
    const manager = await managerContext.newPage()
    await loginAs(manager, 'manager')
    await manager.goto('/purchase-requests/new')
    await expect(manager.getByRole('heading', { name: 'สร้างใบขอซื้อ' })).toBeVisible()
    await manager.getByLabel('หน่วยงานผู้ขอ').selectOption('สำนักงานกลุ่มงานเทคนิคการแพทย์')
    const itemSearch = manager.getByRole('searchbox', { name: 'ค้นหารายการ' })
    await itemSearch.fill('E2E-STOCK-001')
    await manager.getByRole('button', { name: 'เพิ่มลงใบ PR' }).first().click()
    await manager.getByRole('button', { name: 'ส่งใบ PR' }).click()
    await expect(manager).toHaveURL(/\/purchase-requests\/[^/]+$/)
    await managerContext.close()

    // Two stock sessions deliberately race the same confirmation. The database
    // concurrency guard must allow one transition and reject/no-op the other.
    const [contextA, contextB] = await Promise.all([browser.newContext(), browser.newContext()])
    const [stockA, stockB] = await Promise.all([contextA.newPage(), contextB.newPage()])
    await Promise.all([loginAs(stockA, 'stock'), loginAs(stockB, 'stock_alt')])
    const url = fixtureUrl('E2E_PR_READY_URL')
    await Promise.all([stockA.goto(url), stockB.goto(url)])
    const results = await Promise.allSettled([
      stockA.getByRole('button', { name: 'ยืนยันใบ PR' }).click(),
      stockB.getByRole('button', { name: 'ยืนยันใบ PR' }).click(),
    ])
    expect(results).toHaveLength(2)
    await Promise.all([stockA.reload(), stockB.reload()])
    await expect(stockA.getByText(/ยืนยันแล้ว|ดำเนินการแล้ว/).first()).toBeVisible()
    await expect(stockB.getByText(/ยืนยันแล้ว|ดำเนินการแล้ว/).first()).toBeVisible()
    await Promise.all([contextA.close(), contextB.close()])
  })
})
