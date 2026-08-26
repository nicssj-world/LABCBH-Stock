import { allowMutations, expect, loginAs, missingFixtureReason, requireFixtures, strictFixtures, test } from './support'

const missing = missingFixtureReason(['manager'])

test.describe('manager contract workflow', () => {
  test.skip(!strictFixtures && (Boolean(missing) || !allowMutations), `preview fixtures unavailable: ${missing || 'mutations disabled'}`)
  test.beforeAll(() => requireFixtures(['manager']))

  test('@smoke creates a contract and requires เลขที่สัญญา only at contract_started', async ({ page }) => {
    test.setTimeout(90_000)
    await loginAs(page, 'manager')
    const activeBefore = Number((await page.locator('.executive-strip__card').filter({ hasText: 'สัญญาใช้งานอยู่' }).locator('strong').textContent())?.replace(/\D/g, '') ?? 0)
    await page.goto('/contracts/new')
    await page.locator('#contract-duration-years').selectOption('1')

    const token = Date.now().toString()
    // The form defaults to equipment_lease, which is billed monthly in baht and
    // carries no line items. This case exercises the line-item path, so it picks
    // a supply type first.
    await page.getByLabel('ประเภทสัญญา').selectOption('e_bidding')
    await page.getByLabel('ชื่อสัญญา').fill(`E2E contract ${token}`)
    await page.getByLabel('คู่สัญญา / บริษัท').fill('E2E isolated fixture')
    await page.getByLabel('รหัสน้ำยา (LS)').fill(`E2E-${token}`)
    await page.getByLabel('ชื่อน้ำยา').fill('E2E reagent')
    await page.getByLabel('จำนวนในสัญญา').fill('10')
    await page.getByLabel('หน่วย', { exact: true }).fill('กล่อง')
    await page.getByLabel('ราคาต่อหน่วย').fill('100')
    await page.getByRole('button', { name: 'บันทึกสัญญา' }).click()
    await expect(page).toHaveURL(/\/contracts\/\d+$/)

    for (let stage = 0; stage < 5; stage += 1) {
      await page.getByRole('button', { name: /ไปขั้น/ }).click()
      const contractNumber = page.getByLabel('เลขที่สัญญา')
      if (stage === 4) {
        await expect(contractNumber).toBeVisible()
        await contractNumber.fill(`E2E-${token}`)
      } else {
        await expect(contractNumber).toHaveCount(0)
      }
      await page.getByRole('button', { name: 'ยืนยันขั้นตอนใหม่' }).click()
      if (stage < 4) {
        await expect(page.getByRole('button', { name: /ไปขั้น/ })).toBeVisible()
      }
    }

    await expect(page.getByRole('heading', { name: 'ดำเนินการขั้นถัดไป' })).toHaveCount(0)
    await expect(page.getByText(`E2E-${token}`, { exact: true }).first()).toBeVisible()
    await page.goto('/dashboard')
    const activeAfter = Number((await page.locator('.executive-strip__card').filter({ hasText: 'สัญญาใช้งานอยู่' }).locator('strong').textContent())?.replace(/\D/g, '') ?? 0)
    expect(activeAfter).toBe(activeBefore + 1)
    await expect(page.getByRole('heading', { name: 'รายการตามสัญญาคงเหลือต่ำ' })).toBeVisible()
  })
})
