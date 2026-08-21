import { allowMutations, expect, loginAs, missingFixtureReason, requireFixtures, strictFixtures, test } from './support'

const missing = missingFixtureReason(['manager', 'stock', 'stock_alt'])

test.describe('requisition FIFO fulfillment and A4 evidence', () => {
  test.skip(!strictFixtures && (Boolean(missing) || !allowMutations), `preview fixtures unavailable: ${missing || 'mutations disabled'}`)
  test.beforeAll(() => requireFixtures(['manager', 'stock', 'stock_alt']))

  test('@smoke manager creates a request and concurrent stock fulfillment cannot double-issue', async ({ browser }) => {
    test.setTimeout(90_000)
    const managerContext = await browser.newContext()
    const manager = await managerContext.newPage()
    await loginAs(manager, 'manager')
    await manager.goto('/requisitions/new')
    await expect(manager.getByRole('heading', { name: 'สร้างใบเบิก' })).toBeVisible()
    const itemSelect = manager.getByLabel('เลือกน้ำยาจากรายการ')
    // The department is derived from the signed-in fixture profile. Pick the
    // first eligible stocked item instead of overriding that department.
    const stockedOption = itemSelect.locator('option[value]:not([value=""])').first()
    const stockedValue = await stockedOption.getAttribute('value')
    expect(stockedValue).toBeTruthy()
    await itemSelect.selectOption(stockedValue!)
    await manager.getByRole('button', { name: 'ส่งใบเบิก' }).click()
    await expect(manager).toHaveURL(/\/requisitions\/[0-9a-f-]{36}$/)
    const url = new URL(manager.url()).pathname
    await managerContext.close()

    const [contextA, contextB] = await Promise.all([browser.newContext(), browser.newContext()])
    const [stockA, stockB] = await Promise.all([contextA.newPage(), contextB.newPage()])
    await Promise.all([loginAs(stockA, 'stock'), loginAs(stockB, 'stock_alt')])
    await Promise.all([stockA.goto(url), stockB.goto(url)])
    await expect(stockA.getByRole('heading', { name: 'เลือกล็อตเพื่อจ่ายของ' })).toBeVisible()
    await expect(stockA.getByText(/ล็อตเรียงตามลำดับที่ควรจ่ายก่อน/)).toBeVisible()
    await Promise.all([
      stockA.locator('input[type="checkbox"]:not(:disabled)').first().check(),
      stockB.locator('input[type="checkbox"]:not(:disabled)').first().check(),
    ])
    const results = await Promise.allSettled([
      stockA.getByRole('button', { name: 'ยืนยันการจ่ายของ' }).click(),
      stockB.getByRole('button', { name: 'ยืนยันการจ่ายของ' }).click(),
    ])
    expect(results).toHaveLength(2)

    const waitForSettlement = async (page: typeof stockA) => {
      await expect.poll(async () => {
        const fulfilled = await page.getByText(/จ่ายของเมื่อ/).count()
        const rejected = await page.locator('.form-error[role="alert"]').count()
        return fulfilled + rejected
      }, { timeout: 30_000 }).toBeGreaterThan(0)
    }
    await Promise.all([waitForSettlement(stockA), waitForSettlement(stockB)])
    await Promise.all([stockA.reload(), stockB.reload()])
    await expect(stockA.getByText(/จ่ายของเมื่อ/)).toBeVisible()
    await expect(stockB.getByText(/จ่ายของเมื่อ/)).toBeVisible()

    await stockA.goto(`${url}/print`)
    await stockA.emulateMedia({ media: 'print' })
    await expect(stockA.getByRole('heading', { name: 'ใบเบิกน้ำยาและวัสดุวิทยาศาสตร์' })).toBeVisible()
    await expect(stockA.locator('.print-signatures')).toBeVisible()
    await expect(stockA.locator('.print-route__toolbar')).toBeHidden()
    await Promise.all([contextA.close(), contextB.close()])
  })
})
