import { allowMutations, expect, fixtureUrl, loginAs, missingFixtureReason, requireFixtures, strictFixtures, test } from './support'

const requiredUrls = ['E2E_RECEIPT_DRAFT_URL']
const missing = missingFixtureReason(['manager', 'stock'], requiredUrls)

test.describe('receiving permissions and idempotent post', () => {
  test.skip(!strictFixtures && (Boolean(missing) || !allowMutations), `preview fixtures unavailable: ${missing || 'mutations disabled'}`)
  test.beforeAll(() => requireFixtures(['manager', 'stock'], requiredUrls))

  test('@smoke manager cannot post while stock posts a draft receipt once', async ({ browser }) => {
    const url = fixtureUrl('E2E_RECEIPT_DRAFT_URL')
    const managerContext = await browser.newContext()
    const manager = await managerContext.newPage()
    await loginAs(manager, 'manager')
    await manager.goto(url)
    await expect(manager.getByRole('button', { name: 'บันทึกเข้าคลัง' })).toHaveCount(0)
    await managerContext.close()

    const stockContext = await browser.newContext()
    const stock = await stockContext.newPage()
    await loginAs(stock, 'stock')
    await stock.goto(url)
    await stock.getByRole('button', { name: 'บันทึกเข้าคลัง' }).click()
    await expect(stock.getByText(/ใบรับนี้บันทึกเข้าคลังแล้ว/)).toBeVisible()
    await stock.reload()
    await expect(stock.getByRole('button', { name: 'บันทึกเข้าคลัง' })).toHaveCount(0)
    await stockContext.close()
  })
})
