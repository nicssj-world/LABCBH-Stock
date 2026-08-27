import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron } from 'playwright'

const userData = mkdtempSync(path.join(os.tmpdir(), 'labcbh-backup-desktop-'))
const packagedExecutable = process.env.BACKUP_DESKTOP_EXECUTABLE
const electronPath = packagedExecutable || (await import('electron')).default
const electronEnv = { ...process.env }
delete electronEnv.ELECTRON_RUN_AS_NODE
const app = await electron.launch({
  executablePath: electronPath,
  args: packagedExecutable ? [`--user-data-dir=${userData}`] : [path.resolve('desktop/main.cjs'), `--user-data-dir=${userData}`],
  env: electronEnv,
})

try {
  const page = await app.firstWindow()
  await page.waitForSelector('#setup-view:not([hidden])')
  assert.equal(await page.title(), 'LABCBH Backup')
  assert.equal(await page.locator('#dashboard-view').getAttribute('hidden'), '')
  assert.equal(await page.locator('#setup-title').textContent(), 'เลือกโปรเจคที่จะตั้งค่า')
  assert.equal(await page.locator('#setup-profile-picker [data-profile-id="stock"]').count(), 1)
  assert.equal(await page.locator('#setup-profile-picker [data-profile-id="portal"]').count(), 1)
  await page.locator('#supabase-url').fill('not-a-supabase-url')
  await page.locator('#setup-next').click()
  assert.equal(await page.locator('#supabase-url').getAttribute('aria-invalid'), 'true')
  assert.notEqual(await page.locator('#supabase-url-error').textContent(), '')

  await page.setViewportSize({ width: 1280, height: 900 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true)
  const screenshotDir = process.env.BACKUP_DESKTOP_SCREENSHOT_DIR
  if (screenshotDir) {
    await page.screenshot({ path: path.join(screenshotDir, 'desktop-setup.png'), fullPage: true })
  }
  await page.setViewportSize({ width: 420, height: 800 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true)
  assert.equal(await page.locator('#setup-next').evaluate((button) => button.getAttribute('aria-busy')), null)

  if (screenshotDir) {
    await page.screenshot({ path: path.join(screenshotDir, 'mobile-setup.png'), fullPage: true })
  }

  const serviceRoleKey = 'service-role-test-secret-1234567890'
  const databaseUrl = 'postgresql://backup-user:db-password@db.example.com:5432/postgres?sslmode=require'
  const saved = await page.evaluate(async ({ serviceRoleKey: key, databaseUrl: connectionString, backupRoot }) => {
    return window.backupDesktop.saveSettings({
      profileId: 'stock',
      supabaseUrl: 'https://stogulcfwsvunydmwrex.supabase.co',
      serviceRoleKey: key,
      databaseUrl: connectionString,
      backupRoot,
      pgDumpPath: '',
      runnerId: 'desktop-smoke',
    })
  }, { serviceRoleKey, databaseUrl, backupRoot: path.join(userData, 'backups') })
  assert.equal(saved.configured, true)
  assert.equal(saved.profiles.filter((profile) => profile.configured).length, 1)
  const portalRoleKey = 'portal-service-role-test-secret-1234567890'
  const portalDatabaseUrl = 'postgresql://portal-user:portal-db-password@db.fslagsuorkcckvvtrmyi.supabase.co:5432/postgres?sslmode=require'
  const savedBoth = await page.evaluate(async ({ serviceRoleKey: key, databaseUrl: connectionString, backupRoot }) => {
    return window.backupDesktop.saveSettings({
      profileId: 'portal',
      supabaseUrl: 'https://fslagsuorkcckvvtrmyi.supabase.co',
      serviceRoleKey: key,
      databaseUrl: connectionString,
      backupRoot,
      pgDumpPath: '',
      runnerId: 'desktop-smoke',
    })
  }, { serviceRoleKey: portalRoleKey, databaseUrl: portalDatabaseUrl, backupRoot: path.join(userData, 'portal-backups') })
  assert.equal(savedBoth.profiles.filter((profile) => profile.configured).length, 2)
  const publicSettings = await page.evaluate(() => window.backupDesktop.getSettings())
  assert.equal('serviceRoleKey' in publicSettings, false)
  assert.equal('databaseUrl' in publicSettings, false)
  const storedSettings = readFileSync(path.join(userData, 'settings.json'), 'utf8')
  assert.equal(storedSettings.includes(serviceRoleKey), false)
  assert.equal(storedSettings.includes(databaseUrl), false)
  assert.equal(storedSettings.includes(portalRoleKey), false)
  assert.equal(storedSettings.includes(portalDatabaseUrl), false)
  assert.match(storedSettings, /dpapi:/)
  console.log('backup desktop smoke test passed')
} finally {
  await app.close()
  rmSync(userData, { recursive: true, force: true })
}
