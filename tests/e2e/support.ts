import { expect, test, type Page } from '@playwright/test'

export { expect, test }

export type FixtureRole = 'admin' | 'manager' | 'stock' | 'stock_alt'

export interface FixtureCredentials {
  identifier: string
  password: string
}

export const strictFixtures = Boolean(process.env.CI) || process.env.E2E_REQUIRE_FIXTURES === '1'
export const allowMutations = process.env.E2E_ALLOW_MUTATIONS === '1'

export function fixtureCredentials(role: FixtureRole): FixtureCredentials | null {
  const prefix = role === 'stock_alt' ? 'E2E_STOCK_ALT' : `E2E_${role.toUpperCase()}`
  const identifier = process.env[`${prefix}_IDENTIFIER`]
  const password = process.env[`${prefix}_PASSWORD`]
  return identifier && password ? { identifier, password } : null
}

export function missingFixtureReason(roles: FixtureRole[], urls: string[] = []) {
  const missingRoles = roles.filter((role) => !fixtureCredentials(role)).map((role) => `${role} credentials`)
  const missingUrls = urls.filter((key) => !process.env[key])
  return [...missingRoles, ...missingUrls].join(', ')
}

export function requireFixtures(roles: FixtureRole[], urls: string[] = []) {
  const missing = missingFixtureReason(roles, urls)
  if (missing) throw new Error(`Missing required E2E fixtures: ${missing}`)
  if (!allowMutations) throw new Error('E2E_ALLOW_MUTATIONS=1 is required for isolated preview/staging workflow tests')
}

export async function loginAs(page: Page, role: FixtureRole) {
  const credentials = fixtureCredentials(role)
  if (!credentials) throw new Error(`Missing ${role} fixture credentials`)

  await page.goto('/login')
  await page.getByLabel('รหัส E-Phis').fill(credentials.identifier)
  await page.getByLabel('รหัสผ่าน', { exact: true }).fill(credentials.password)
  await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click()
  await expect(page).toHaveURL(/\/dashboard$/)
}

export function fixtureUrl(key: string) {
  const url = process.env[key]
  if (!url) throw new Error(`Missing ${key}`)
  return url
}
