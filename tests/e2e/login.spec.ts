import { expect, test } from './support'

test('password visibility control reveals and hides the value without clearing it', async ({ page }) => {
  test.skip(
    !process.env.E2E_BASE_URL && process.env.E2E_RUN_LOCAL_SERVER !== '1',
    'login UI test requires a running application',
  )
  await page.goto('/login')

  const password = page.getByLabel('รหัสผ่าน', { exact: true })
  const reveal = page.getByRole('button', { name: 'แสดงรหัสผ่าน' })

  await password.fill('secret-value')
  await expect(password).toHaveAttribute('type', 'password')
  await expect(reveal).toHaveAttribute('aria-pressed', 'false')

  await reveal.click()
  await expect(password).toHaveAttribute('type', 'text')
  await expect(password).toHaveValue('secret-value')
  await expect(page.getByRole('button', { name: 'ซ่อนรหัสผ่าน' })).toHaveAttribute('aria-pressed', 'true')

  await page.getByRole('button', { name: 'ซ่อนรหัสผ่าน' }).click()
  await expect(password).toHaveAttribute('type', 'password')
  await expect(password).toHaveValue('secret-value')
})
