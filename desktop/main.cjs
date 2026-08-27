const fs = require('node:fs')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')
const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  safeStorage,
  shell,
} = require('electron')
const {
  BackupEngine,
  sanitizeBackupError,
  parseProjectRefFromUrl,
} = require('./backup-engine.cjs')
const {
  PROFILE_DEFINITIONS,
  defaultProfile,
  isConfigured,
  normalizeProfileId,
} = require('./profile-config.cjs')

const SETTINGS_VERSION = 2
const LEGACY_SETTINGS_VERSION = 1
const DEFAULT_TIME = '02:00'
const DEFAULT_DAY = 1
const TASK_PREFIX = 'LABCBH Database Backup'
const LEGACY_TASK_NAME = TASK_PREFIX

let mainWindow = null
let cachedSettings = undefined
let runningPromise = null
let scheduledRunPromise = null
const scheduledProfiles = new Set()

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json')
}

function logPath() {
  return path.join(app.getPath('userData'), 'logs', 'backup.log')
}

function defaultBackupRoot() {
  return path.join(app.getPath('documents'), 'LABCBH Backups')
}

function defaultRunnerId() {
  const host = os.hostname().replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 70) || 'computer'
  return `LABCBH-${host}`
}

function taskName(profileId) {
  return `${TASK_PREFIX} - ${normalizeProfileId(profileId)}`
}

function normaliseSchedule(value) {
  const source = value && typeof value === 'object' ? value : {}
  const day = Number(source.day ?? DEFAULT_DAY)
  const time = typeof source.time === 'string' ? source.time.trim() : DEFAULT_TIME
  if (!Number.isInteger(day) || day < 1 || day > 28) {
    throw new Error('วันสำรองต้องอยู่ระหว่างวันที่ 1 ถึง 28')
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    throw new Error('เวลาสำรองต้องอยู่ในรูปแบบ HH:MM')
  }
  return { enabled: source.enabled === true, day, time }
}

function decodeSecret(value) {
  if (typeof value !== 'string' || !value.startsWith('dpapi:')) {
    throw new Error('รูปแบบค่าที่เข้ารหัสไม่ถูกต้อง')
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Windows protected storage ยังไม่พร้อมใช้งาน กรุณาลองเปิดแอปใหม่')
  }
  try {
    return safeStorage.decryptString(Buffer.from(value.slice('dpapi:'.length), 'base64'))
  } catch {
    throw new Error('อ่านค่าความลับไม่ได้ กรุณาตั้งค่าการเชื่อมต่อใหม่')
  }
}

function encodeSecret(value) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('ไม่สามารถเปิดใช้ Windows protected storage ได้ จึงยังไม่บันทึกค่าความลับ')
  }
  return `dpapi:${safeStorage.encryptString(value).toString('base64')}`
}

function validateBackupRoot(value) {
  const root = path.resolve(value || defaultBackupRoot())
  if (path.parse(root).root === root) throw new Error('กรุณาเลือกโฟลเดอร์ย่อยสำหรับเก็บไฟล์สำรอง')
  return root
}

function validateDatabaseUrl(value) {
  const normalized = String(value || '').trim()
  let parsed
  try {
    parsed = new URL(normalized)
  } catch {
    throw new Error('PostgreSQL connection string ไม่ถูกต้อง')
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname) {
    throw new Error('PostgreSQL connection string ต้องเริ่มด้วย postgresql://')
  }
  if (!parsed.username || !parsed.password) {
    throw new Error('PostgreSQL connection string ต้องมี username และ password')
  }
  return normalized
}

function validateProjectDatabaseUrl(value, expectedProjectRef) {
  const normalized = validateDatabaseUrl(value)
  const parsed = new URL(normalized)
  const directHost = /^db\.([a-z0-9]+)\.supabase\.co$/i.exec(parsed.hostname)
  if (directHost && directHost[1].toLowerCase() !== expectedProjectRef.toLowerCase()) {
    throw new Error(`database URL เป็นของ project ${directHost[1]} ไม่ใช่ ${expectedProjectRef}`)
  }
  return normalized
}

function validateRunnerId(value) {
  const runnerId = String(value || '').trim()
  if (!runnerId || runnerId.length > 128 || !/^[\p{L}\p{N}._ -]+$/u.test(runnerId)) {
    throw new Error('ชื่อ runner ใช้ได้เฉพาะตัวอักษร ตัวเลข ช่องว่าง จุด ขีด และขีดล่าง')
  }
  return runnerId
}

function validateStoredRunnerId(value) {
  try {
    return validateRunnerId(value)
  } catch {
    return defaultRunnerId()
  }
}

function validatePgDumpPath(value) {
  const pgDumpPath = String(value || '').trim()
  if (!pgDumpPath) return ''
  const resolved = path.resolve(pgDumpPath)
  if (process.platform === 'win32' && path.basename(resolved).toLowerCase() !== 'pg_dump.exe') {
    throw new Error('กรุณาเลือกไฟล์ชื่อ pg_dump.exe')
  }
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    throw new Error('ไม่พบไฟล์ pg_dump.exe ตาม path ที่เลือก')
  }
  return resolved
}

function createDefaultSettings() {
  const baseRoot = defaultBackupRoot()
  return {
    version: SETTINGS_VERSION,
    runnerId: defaultRunnerId(),
    profiles: PROFILE_DEFINITIONS.map((profile) => defaultProfile(profile.id, baseRoot)),
  }
}

function profileFor(settings, value) {
  const profileId = normalizeProfileId(value)
  const profile = settings?.profiles?.find((candidate) => candidate.id === profileId)
  if (!profile) throw new Error(`ไม่พบโปรไฟล์ backup: ${profileId}`)
  return profile
}

function hydrateProfile(raw, fallback) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const profile = {
    ...fallback,
    supabaseUrl: String(source.supabaseUrl || fallback.supabaseUrl).trim().replace(/\/$/, ''),
    expectedProjectRef: String(source.expectedProjectRef || fallback.expectedProjectRef).trim().toLowerCase(),
    backupRoot: path.resolve(String(source.backupRoot || fallback.backupRoot)),
    pgDumpPath: String(source.pgDumpPath || fallback.pgDumpPath || '').trim(),
    schedule: normaliseSchedule(source.schedule || fallback.schedule),
    serviceRoleKey: '',
    databaseUrl: '',
    encryptedServiceRoleKey: source.secrets?.serviceRoleKey || null,
    encryptedDatabaseUrl: source.secrets?.databaseUrl || null,
  }
  if (profile.encryptedServiceRoleKey) profile.serviceRoleKey = decodeSecret(profile.encryptedServiceRoleKey)
  if (profile.encryptedDatabaseUrl) profile.databaseUrl = decodeSecret(profile.encryptedDatabaseUrl)
  return profile
}

async function readStoredSettings() {
  if (cachedSettings !== undefined) return cachedSettings
  let raw
  try {
    raw = JSON.parse(await fsp.readFile(settingsPath(), 'utf8'))
  } catch (cause) {
    if (cause?.code === 'ENOENT') {
      cachedSettings = null
      return cachedSettings
    }
    throw new Error('อ่านไฟล์การตั้งค่าไม่ได้')
  }

  if (!raw || ![LEGACY_SETTINGS_VERSION, SETTINGS_VERSION].includes(raw.version)) {
    throw new Error('ไฟล์การตั้งค่าไม่ถูกต้อง กรุณาตั้งค่าใหม่')
  }

  const defaults = createDefaultSettings()
  if (raw.version === LEGACY_SETTINGS_VERSION) {
    const legacyStock = hydrateProfile({
      ...raw,
      secrets: raw.secrets,
      backupRoot: raw.backupRoot || defaults.profiles[0].backupRoot,
    }, defaults.profiles[0])
    defaults.profiles[0] = legacyStock
    defaults.runnerId = validateStoredRunnerId(raw.runnerId)
    cachedSettings = defaults
    return cachedSettings
  }

  defaults.runnerId = validateStoredRunnerId(raw.runnerId)
  const rawProfiles = Array.isArray(raw.profiles) ? raw.profiles : []
  defaults.profiles = defaults.profiles.map((fallback) => {
    const stored = rawProfiles.find((candidate) => candidate?.id === fallback.id)
    return hydrateProfile(stored, fallback)
  })
  cachedSettings = defaults
  return cachedSettings
}

async function writeSettings(next) {
  await fsp.mkdir(app.getPath('userData'), { recursive: true })
  const record = {
    version: SETTINGS_VERSION,
    runnerId: next.runnerId,
    profiles: next.profiles.map((profile) => ({
      id: profile.id,
      supabaseUrl: profile.supabaseUrl,
      expectedProjectRef: profile.expectedProjectRef,
      backupRoot: profile.backupRoot,
      pgDumpPath: profile.pgDumpPath,
      schedule: profile.schedule,
      secrets: {
        serviceRoleKey: profile.encryptedServiceRoleKey,
        databaseUrl: profile.encryptedDatabaseUrl,
      },
    })),
  }
  const temporaryPath = `${settingsPath()}.${process.pid}.tmp`
  try {
    await fsp.writeFile(temporaryPath, `${JSON.stringify(record, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    await fsp.rename(temporaryPath, settingsPath())
  } catch (cause) {
    await fsp.rm(temporaryPath, { force: true }).catch(() => {})
    throw cause
  }
  cachedSettings = {
    version: SETTINGS_VERSION,
    runnerId: next.runnerId,
    profiles: next.profiles.map((profile) => ({ ...profile })),
  }
  return cachedSettings
}

function secretValues() {
  return (cachedSettings?.profiles || [])
    .flatMap((profile) => [profile.serviceRoleKey, profile.databaseUrl])
    .filter(Boolean)
}

function publicError(cause) {
  return sanitizeBackupError(cause, secretValues())
}

function publicSchedule(schedule, taskInstalled) {
  return {
    enabled: schedule?.enabled === true,
    day: schedule?.day || DEFAULT_DAY,
    time: schedule?.time || DEFAULT_TIME,
    taskInstalled: Boolean(taskInstalled),
  }
}

async function detectPgDumpPath(settings) {
  if (settings?.pgDumpPath && path.basename(settings.pgDumpPath).toLowerCase() === 'pg_dump.exe' && fs.existsSync(settings.pgDumpPath)) return settings.pgDumpPath
  const bundled = process.resourcesPath
    ? path.join(process.resourcesPath, 'postgresql', process.platform === 'win32' ? 'pg_dump.exe' : 'pg_dump')
    : ''
  if (bundled && fs.existsSync(bundled)) return bundled
  return null
}

function publicProfile(profile, taskInstalled = false, pgDumpAvailable = false) {
  return {
    id: profile.id,
    label: profile.label,
    shortLabel: profile.shortLabel,
    description: profile.description,
    supabaseUrl: profile.supabaseUrl,
    expectedProjectRef: profile.expectedProjectRef,
    backupRoot: profile.backupRoot,
    pgDumpPath: profile.pgDumpPath,
    configured: isConfigured(profile),
    hasServiceRoleKey: Boolean(profile.serviceRoleKey),
    hasDatabaseUrl: Boolean(profile.databaseUrl),
    pgDumpAvailable,
    schedule: publicSchedule(profile.schedule, taskInstalled),
  }
}

async function getPublicSettings() {
  let settings
  try {
    settings = await readStoredSettings()
  } catch (cause) {
    const defaults = createDefaultSettings()
    return {
      configured: false,
      error: publicError(cause),
      runnerId: defaults.runnerId,
      defaultRunnerId: defaults.runnerId,
      profiles: defaults.profiles.map((profile) => publicProfile(profile)),
    }
  }
  if (!settings) {
    const defaults = createDefaultSettings()
    return {
      configured: false,
      runnerId: defaults.runnerId,
      defaultRunnerId: defaults.runnerId,
      profiles: defaults.profiles.map((profile) => publicProfile(profile)),
    }
  }

  const profiles = await Promise.all(settings.profiles.map(async (profile) => publicProfile(
    profile,
    await scheduledTaskExists(profile.id),
    Boolean(await detectPgDumpPath(profile)),
  )))
  return {
    configured: profiles.some((profile) => profile.configured),
    runnerId: settings.runnerId,
    defaultRunnerId: defaultRunnerId(),
    profiles,
  }
}

async function saveSettings(input) {
  const existing = (await readStoredSettings()) || createDefaultSettings()
  const profileId = normalizeProfileId(input?.profileId)
  const current = profileFor(existing, profileId)
  const supabaseUrl = String(input?.supabaseUrl || current.supabaseUrl).trim().replace(/\/$/, '')
  const projectRef = parseProjectRefFromUrl(supabaseUrl)
  const serviceRoleKey = String(input?.serviceRoleKey || '').trim() || current.serviceRoleKey || ''
  const databaseUrl = String(input?.databaseUrl || '').trim() || current.databaseUrl || ''
  if (!serviceRoleKey) throw new Error('กรุณาระบุ service role key ของโปรเจคนี้')
  if (serviceRoleKey.length < 20) throw new Error('service role key สั้นเกินไป กรุณาตรวจสอบค่าที่คัดลอกมา')
  if (!databaseUrl) throw new Error('กรุณาระบุ PostgreSQL connection string ของโปรเจคนี้')

  const nextProfile = {
    ...current,
    supabaseUrl,
    expectedProjectRef: projectRef,
    backupRoot: validateBackupRoot(input?.backupRoot || current.backupRoot),
    pgDumpPath: validatePgDumpPath(input?.pgDumpPath),
    serviceRoleKey,
    databaseUrl: validateProjectDatabaseUrl(databaseUrl, projectRef),
    encryptedServiceRoleKey: String(input?.serviceRoleKey || '').trim() ? encodeSecret(serviceRoleKey) : current.encryptedServiceRoleKey,
    encryptedDatabaseUrl: String(input?.databaseUrl || '').trim() ? encodeSecret(databaseUrl) : current.encryptedDatabaseUrl,
  }
  if (!nextProfile.encryptedServiceRoleKey || !nextProfile.encryptedDatabaseUrl) {
    throw new Error('ไม่พบค่าความลับที่เข้ารหัส กรุณาระบุ key และ connection string ใหม่')
  }
  const runnerId = validateRunnerId(input?.runnerId || existing.runnerId || defaultRunnerId())
  const next = {
    ...existing,
    runnerId,
    profiles: existing.profiles.map((profile) => profile.id === profileId ? nextProfile : profile),
  }
  await writeSettings(next)
  await appendLog('info', 'บันทึกการตั้งค่าโปรเจคแล้ว', new Date().toISOString(), profileId)
  return getPublicSettings()
}

async function runWindowsCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk.toString() })
    child.stderr.on('data', (chunk) => { stderr += chunk.toString() })
    child.on('error', reject)
    child.on('close', (code, signal) => resolve({ code, signal, stdout, stderr }))
  })
}

async function taskExistsByName(name) {
  if (process.platform !== 'win32') return false
  try {
    const result = await runWindowsCommand('schtasks.exe', ['/Query', '/TN', name, '/FO', 'LIST', '/NH'])
    return result.code === 0
  } catch {
    return false
  }
}

async function scheduledTaskExists(profileId) {
  return taskExistsByName(taskName(profileId))
}

async function installScheduledTask(profileId, schedule) {
  if (process.platform !== 'win32') throw new Error('การตั้งเวลาอัตโนมัติรองรับเฉพาะ Windows')
  if (!app.isPackaged) throw new Error('โปรดใช้ไฟล์ติดตั้ง .exe ก่อนเปิดการสำรองอัตโนมัติ')
  const command = `"${process.execPath}" --scheduled --profile ${normalizeProfileId(profileId)}`
  const result = await runWindowsCommand('schtasks.exe', [
    '/Create',
    '/TN',
    taskName(profileId),
    '/TR',
    command,
    '/SC',
    'MONTHLY',
    '/D',
    String(schedule.day),
    '/ST',
    schedule.time,
    '/F',
  ])
  if (result.code !== 0) {
    throw new Error(`Windows Task Scheduler ไม่สามารถสร้างงานได้: ${sanitizeBackupError(result.stderr)}`)
  }
}

async function removeTaskByName(name) {
  if (!(await taskExistsByName(name))) return
  const result = await runWindowsCommand('schtasks.exe', ['/Delete', '/TN', name, '/F'])
  if (result.code !== 0) throw new Error(`ไม่สามารถปิดการสำรองอัตโนมัติได้: ${sanitizeBackupError(result.stderr)}`)
}

async function removeScheduledTask(profileId) {
  await removeTaskByName(taskName(profileId))
  if (normalizeProfileId(profileId) === 'stock') await removeTaskByName(LEGACY_TASK_NAME)
}

async function setSchedule(input) {
  const settings = await readStoredSettings()
  if (!settings) throw new Error('กรุณาบันทึกการตั้งค่าการเชื่อมต่อก่อน')
  const profileId = normalizeProfileId(input?.profileId)
  const profile = profileFor(settings, profileId)
  if (!isConfigured(profile)) throw new Error('โปรดตั้งค่าการเชื่อมต่อของโปรเจคนี้ให้ครบก่อน')
  const schedule = normaliseSchedule(input)
  if (schedule.enabled) {
    if (profileId === 'stock') await removeTaskByName(LEGACY_TASK_NAME).catch(() => {})
    await installScheduledTask(profileId, schedule)
  } else {
    await removeScheduledTask(profileId)
  }
  const next = {
    ...settings,
    profiles: settings.profiles.map((candidate) => candidate.id === profileId
      ? { ...candidate, schedule }
      : candidate),
  }
  await writeSettings(next)
  await appendLog('info', schedule.enabled
    ? `เปิดสำรองอัตโนมัติ วันที่ ${schedule.day} เวลา ${schedule.time}`
    : 'ปิดสำรองอัตโนมัติแล้ว', new Date().toISOString(), profileId)
  return getPublicSettings()
}

function createEngine(profile) {
  return new BackupEngine({
    ...profile,
    runnerId: cachedSettings.runnerId,
    profileId: profile.id,
    profileLabel: profile.label,
  }, (entry) => {
    void appendLog(entry.level, entry.message, entry.at, profile.id)
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('backup:log', { ...entry, profileId: profile.id })
  })
}

async function appendLog(level, message, at = new Date().toISOString(), profileId = null) {
  const scope = profileId ? `[${normalizeProfileId(profileId)}] ` : ''
  const safeMessage = sanitizeBackupError(message, secretValues())
  const line = `${at} [${String(level || 'info').toUpperCase()}] ${scope}${safeMessage}`
  await fsp.mkdir(path.dirname(logPath()), { recursive: true })
  await fsp.appendFile(logPath(), `${line}\n`, 'utf8')
  return line
}

async function getLogs(profileId) {
  try {
    const value = await fsp.readFile(logPath(), 'utf8')
    const lines = value.split(/\r?\n/).filter(Boolean)
    const normalizedProfileId = profileId ? normalizeProfileId(profileId) : null
    const selected = normalizedProfileId
      ? lines.filter((line) => line.includes(`[${normalizedProfileId}] `) || (normalizedProfileId === 'stock' && !/\[(stock|portal)\] /.test(line)))
      : lines
    return selected.slice(-80).map((line) => line.replace(/^(\S+\s+\[[A-Z]+\])\s+\[(stock|portal)\]\s+/, '$1 '))
  } catch (cause) {
    if (cause?.code === 'ENOENT') return []
    throw new Error('อ่าน log ไม่ได้')
  }
}

async function getStatus(profileId = 'stock') {
  const settings = await readStoredSettings()
  if (!settings) return { configured: false, profileId: normalizeProfileId(profileId), logs: await getLogs(profileId) }
  const profile = profileFor(settings, profileId)
  const profileSummary = publicProfile(profile, await scheduledTaskExists(profile.id), Boolean(await detectPgDumpPath(profile)))
  if (!isConfigured(profile)) {
    return {
      configured: false,
      profileId: profile.id,
      profile: profileSummary,
      runnerId: settings.runnerId,
      logs: await getLogs(profile.id),
    }
  }
  const engine = createEngine(profile)
  const local = await engine.readLocalStatus()
  return {
    configured: true,
    profileId: profile.id,
    profile: profileSummary,
    latestLocal: local.latest,
    localCount: local.count,
    pgDumpAvailable: Boolean(await engine.resolvePgDumpPath()),
    pgDumpPath: profile.pgDumpPath,
    backupRoot: profile.backupRoot,
    runnerId: settings.runnerId,
    schedule: profileSummary.schedule,
    logs: await getLogs(profile.id),
  }
}

async function testConnection(profileId = 'stock') {
  const settings = await readStoredSettings()
  if (!settings) throw new Error('กรุณาบันทึกการตั้งค่าก่อนตรวจสอบการเชื่อมต่อ')
  const profile = profileFor(settings, profileId)
  if (!isConfigured(profile)) throw new Error('โปรดตั้งค่าการเชื่อมต่อของโปรเจคนี้ให้ครบก่อน')
  const engine = createEngine(profile)
  const result = await engine.testConnection()
  await appendLog('success', `เชื่อมต่อ Supabase สำเร็จ · project ${result.projectRef}`, new Date().toISOString(), profile.id)
  return result
}

async function runBackup(triggerSource = 'manual', profileId = 'stock') {
  const normalizedProfileId = normalizeProfileId(profileId)
  if (runningPromise) throw new Error('มีการสำรองข้อมูลกำลังทำงานอยู่ กรุณารอให้เสร็จก่อน')
  runningPromise = (async () => {
    const settings = await readStoredSettings()
    if (!settings) throw new Error('กรุณาตั้งค่าการเชื่อมต่อก่อนเริ่มสำรอง')
    const profile = profileFor(settings, normalizedProfileId)
    if (!isConfigured(profile)) throw new Error(`ยังไม่ได้ตั้งค่า ${profile.label}`)
    await appendLog('info', triggerSource === 'scheduled' ? 'เริ่มงานสำรองตามกำหนดเวลา' : 'เริ่มงานสำรองจากปุ่มผู้ใช้', new Date().toISOString(), profile.id)
    const engine = createEngine(profile)
    const result = await engine.runOnce(triggerSource)
    if (result.status === 'failed') await appendLog('error', result.error || 'การสำรองล้มเหลว', new Date().toISOString(), profile.id)
    else if (result.status === 'skipped') await appendLog('info', result.reason || 'ข้ามรอบสำรองนี้', new Date().toISOString(), profile.id)
    else if (result.status === 'waiting') await appendLog('warning', result.reason || 'งานถูกรอให้ runner อื่นทำงาน', new Date().toISOString(), profile.id)
    return result
  })()
  try {
    return await runningPromise
  } finally {
    runningPromise = null
  }
}

function profileArgument(args = process.argv) {
  const index = args.indexOf('--profile')
  return normalizeProfileId(index >= 0 ? args[index + 1] : 'stock')
}

async function runScheduledAndQuit(profileId) {
  scheduledProfiles.add(normalizeProfileId(profileId))
  if (scheduledRunPromise) return scheduledRunPromise
  scheduledRunPromise = (async () => {
    let failed = false
    try {
      while (scheduledProfiles.size > 0) {
        const nextProfileId = scheduledProfiles.values().next().value
        scheduledProfiles.delete(nextProfileId)
        try {
          const result = await runBackup('scheduled', nextProfileId)
          if (result.status === 'failed') failed = true
        } catch (cause) {
          failed = true
          await appendLog('error', publicError(cause), new Date().toISOString(), nextProfileId)
        }
      }
      process.exitCode = failed ? 1 : 0
    } finally {
      app.quit()
    }
  })()
  return scheduledRunPromise
}

async function pickDirectory() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'เลือกโฟลเดอร์เก็บไฟล์สำรอง',
    properties: ['openDirectory', 'createDirectory'],
  })
  return result.canceled ? null : result.filePaths[0] || null
}

async function pickPgDump() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'เลือกไฟล์ pg_dump.exe',
    properties: ['openFile'],
    filters: [{ name: 'PostgreSQL dump tool', extensions: ['exe'] }],
  })
  return result.canceled ? null : result.filePaths[0] || null
}

async function openBackupFolder(profileId = 'stock') {
  const settings = await readStoredSettings()
  if (!settings) throw new Error('ยังไม่ได้ตั้งค่าการสำรอง')
  const profile = profileFor(settings, profileId)
  await fsp.mkdir(profile.backupRoot, { recursive: true })
  const error = await shell.openPath(profile.backupRoot)
  if (error) throw new Error(`เปิดโฟลเดอร์ไม่สำเร็จ: ${error}`)
  return true
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 420,
    minHeight: 620,
    backgroundColor: '#eef3f6',
    autoHideMenuBar: true,
    title: 'LABCBH Backup',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault())
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'))
  mainWindow.on('closed', () => { mainWindow = null })
}

function registerIpc() {
  ipcMain.handle('settings:get', () => getPublicSettings())
  ipcMain.handle('settings:save', (_event, input) => saveSettings(input))
  ipcMain.handle('settings:schedule', (_event, input) => setSchedule(input))
  ipcMain.handle('connection:test', (_event, profileId) => testConnection(profileId))
  ipcMain.handle('backup:status', (_event, profileId) => getStatus(profileId))
  ipcMain.handle('backup:run', (_event, profileId) => runBackup('manual', profileId))
  ipcMain.handle('backup:logs', (_event, profileId) => getLogs(profileId))
  ipcMain.handle('backup:open-folder', (_event, profileId) => openBackupFolder(profileId))
  ipcMain.handle('dialog:directory', () => pickDirectory())
  ipcMain.handle('dialog:pgdump', () => pickPgDump())
}

const scheduledArgument = process.argv.includes('--scheduled')
const scheduledProfileId = profileArgument(process.argv)
const singleInstance = app.requestSingleInstanceLock()
if (!singleInstance) {
  app.quit()
} else {
  app.on('second-instance', (_event, commandLine) => {
    if (commandLine.includes('--scheduled')) void runScheduledAndQuit(profileArgument(commandLine))
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
  app.whenReady().then(async () => {
    registerIpc()
    if (scheduledArgument) {
      await runScheduledAndQuit(scheduledProfileId)
      return
    }
    createWindow()
  })
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}

module.exports = {
  normaliseSchedule,
  validateBackupRoot,
  validateDatabaseUrl,
  validateProjectDatabaseUrl,
  validateRunnerId,
  taskName,
}
