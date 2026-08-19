import {
  allowMutations,
  expect,
  fixtureUrl,
  loginAs,
  missingFixtureReason,
  requireFixtures,
  strictFixtures,
  test,
} from './support'

const requiredUrls = ['E2E_LEASE_CONTRACT_URL']
const missing = missingFixtureReason(['admin', 'stock'], requiredUrls)
const remoteMutationTimeout = 15_000

test.describe('equipment lease budget', () => {
  test.skip(
    !strictFixtures && (Boolean(missing) || !allowMutations),
    `preview fixtures unavailable: ${missing || 'mutations disabled'}`,
  )
  test.beforeAll(() => requireFixtures(['admin', 'stock'], requiredUrls))

  test('@smoke a responsible non-editor records against the lease budget and cannot overspend', async ({
    browser,
  }) => {
    test.setTimeout(90_000)
    const url = fixtureUrl('E2E_LEASE_CONTRACT_URL')

    // A stock officer holds no contract-editor role. Until an editor names them
    // on this contract they must not be able to record against it, which is the
    // distinction the whole permission design rests on.
    const stockContext = await browser.newContext()
    const stock = await stockContext.newPage()
    await loginAs(stock, 'stock')
    await stock.goto(url)
    await expect(stock.getByRole('heading', { name: 'งบประมาณตามสัญญาเช่า' })).toBeVisible()
    await expect(stock.getByRole('button', { name: 'บันทึกค่าใช้จ่าย' })).toHaveCount(0)

    // An admin names them, which must leave an audit trail.
    const adminContext = await browser.newContext()
    const admin = await adminContext.newPage()
    await loginAs(admin, 'admin')
    await admin.goto(url)
    await admin.getByRole('button', { name: 'กำหนดผู้รับผิดชอบ' }).click()
    // Must be the same identity the stock fixture logs in as, or the grant
    // lands on someone else and the next assertion fails for the wrong reason.
    const stockIdentifier = process.env.E2E_STOCK_IDENTIFIER ?? ''
    await admin.getByLabel('ค้นหาผู้รับผิดชอบ').fill(stockIdentifier)
    await admin.getByRole('checkbox').first().check()
    await admin.getByRole('button', { name: 'บันทึกผู้รับผิดชอบ' }).click()
    // Saving closes the dialog after the RPC commits. The refreshed contract
    // page is the user-visible completion state.
    await expect(admin.getByRole('dialog')).toBeHidden({ timeout: remoteMutationTimeout })

    // Now the same non-editor can record.
    await stock.reload()
    await stock.getByRole('button', { name: /บันทึกค่าใช้จ่าย/ }).first().click()
    const amountField = stock.getByLabel('จำนวนเงิน (บาท)')
    await expect(amountField).toBeVisible()
    await amountField.fill('1000')
    await stock.getByRole('button', { name: 'บันทึกค่าใช้จ่าย', exact: true }).click()
    await expect(stock.getByText('1,000.00').first()).toBeVisible()

    // The ceiling is enforced by the database, not the form, so an amount past
    // the remaining balance comes back with the balance the database saw.
    await stock.getByRole('button', { name: /บันทึกค่าใช้จ่าย/ }).first().click()
    await amountField.fill('99999999')
    await expect(stock.getByText(/จำนวนเงินเกินงบคงเหลือ|จำนวนเงินเกินมูลค่าคงเหลือ/)).toBeVisible()

    // Revoking the assignment takes the ability away again.
    await admin.reload()
    await admin.getByRole('button', { name: 'กำหนดผู้รับผิดชอบ' }).click()
    await admin.getByRole('button', { name: 'นำออก' }).first().click()
    await admin.getByRole('button', { name: 'บันทึกผู้รับผิดชอบ' }).click()
    await expect(admin.getByRole('dialog')).toBeHidden({ timeout: remoteMutationTimeout })

    await stock.reload()
    await expect(stock.getByRole('button', { name: 'บันทึกค่าใช้จ่าย' })).toHaveCount(0)

    await Promise.all([stockContext.close(), adminContext.close()])
  })

  test('@smoke a lease shows no line items and a supply contract shows no budget panel', async ({
    page,
  }) => {
    await loginAs(page, 'admin')

    await page.goto(fixtureUrl('E2E_LEASE_CONTRACT_URL'))
    await expect(page.getByRole('heading', { name: 'งบประมาณตามสัญญาเช่า' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'รายการน้ำยาในสัญญา' })).toHaveCount(0)

    // The create form must not offer line items for the default type either.
    await page.goto('/contracts/new')
    await expect(page.getByText('สัญญาเช่าเครื่องตัดงบเป็นรายเดือน')).toBeVisible()
    await expect(page.getByLabel('รหัสน้ำยา (LS)')).toHaveCount(0)
    await page.getByLabel('ประเภทสัญญา').selectOption('e_bidding')
    await expect(page.getByLabel('รหัสน้ำยา (LS)')).toBeVisible()
  })
})
