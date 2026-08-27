const crypto = require('node:crypto')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')

const BACKUP_RETENTION_DAYS = 30
const BACKUP_RETENTION_MS = BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000
const BACKUP_RUNNER_VERSION = '1.0.0-desktop'
const SCHEDULE_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function required(value, message) {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!normalized) throw new Error(message)
  return normalized
}

function parseProjectRefFromUrl(value) {
  const match = /^https:\/\/([a-z0-9]+)\.supabase\.co\/?$/i.exec(required(value, 'กรุณาระบุ Supabase project URL'))
  if (!match) throw new Error('Supabase project URL ต้องอยู่ในรูปแบบ https://ชื่อโปรเจกต์.supabase.co')
  return match[1].toLowerCase()
}

function sanitizeBackupError(value, secrets = []) {
  let source = value instanceof Error ? value.message : String(value)
  for (const secret of secrets) {
    if (secret) source = source.split(secret).join('***')
  }
  return source
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, 'postgresql://***:***@redacted')
    .replace(/(password|passwd|secret|token|api[_-]?key)\s*[=:]\s*[^\s,;]+/gi, '$1=***')
    .replace(/(SUPABASE_SERVICE_ROLE_KEY|BACKUP_DATABASE_URL)\s*=\s*[^\s]+/gi, '$1=***')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 2000) || 'ไม่สามารถสำรองฐานข้อมูลได้'
}

function assertRunId(runId) {
  if (!UUID_PATTERN.test(runId)) throw new Error('backup run id is invalid')
  return runId
}

function assertInside(root, destination) {
  const relativeTarget = path.relative(path.resolve(root), path.resolve(destination))
  if (
    !relativeTarget ||
    relativeTarget === '..' ||
    relativeTarget.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeTarget)
  ) {
    throw new Error('backup artifact must stay inside BACKUP_ROOT')
  }
}

function artifactPaths(backupRoot, runId) {
  const safeRunId = assertRunId(runId)
  const root = path.resolve(backupRoot)
  const databaseRoot = path.resolve(root, 'database')
  const runDirectory = path.resolve(databaseRoot, safeRunId)
  const fileName = `database-${safeRunId}.dump`
  const dumpPath = path.resolve(runDirectory, fileName)
  const partialDumpPath = path.resolve(runDirectory, `${fileName}.partial`)
  const manifestPath = path.resolve(runDirectory, 'manifest.json')

  assertInside(root, databaseRoot)
  assertInside(root, runDirectory)
  assertInside(root, dumpPath)
  assertInside(root, partialDumpPath)
  assertInside(root, manifestPath)

  return {
    root,
    databaseRoot,
    runDirectory,
    dumpPath,
    partialDumpPath,
    manifestPath,
    relativePath: path.relative(root, dumpPath).split(path.sep).join('/'),
  }
}

function validateSha256(value) {
  const normalized = String(value || '').trim().toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(normalized)) throw new Error('backup checksum is invalid')
  return normalized
}

function decodeManifest(value) {
  const parsed = JSON.parse(value)
  if (
    parsed.format !== 'postgresql-custom' ||
    parsed.tool !== 'pg_dump' ||
    typeof parsed.runId !== 'string' ||
    !UUID_PATTERN.test(parsed.runId) ||
    typeof parsed.relativePath !== 'string' ||
    parsed.relativePath.includes('..') ||
    typeof parsed.completedAt !== 'string' ||
    typeof parsed.bytes !== 'number' ||
    !Number.isSafeInteger(parsed.bytes) ||
    parsed.bytes < 1 ||
    typeof parsed.sha256 !== 'string'
  ) {
    throw new Error('backup manifest is invalid')
  }

  return {
    format: parsed.format,
    tool: parsed.tool,
    runnerVersion: typeof parsed.runnerVersion === 'string' ? parsed.runnerVersion : 'unknown',
    runId: parsed.runId,
    profileId: typeof parsed.profileId === 'string' ? parsed.profileId : 'stock',
    profileLabel: typeof parsed.profileLabel === 'string' ? parsed.profileLabel : 'LABCBH Stock',
    projectRef: typeof parsed.projectRef === 'string' ? parsed.projectRef : 'unknown',
    runnerId: typeof parsed.runnerId === 'string' ? parsed.runnerId : 'unknown',
    triggerSource: parsed.triggerSource === 'scheduled' ? 'scheduled' : 'manual',
    createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : parsed.completedAt,
    completedAt: parsed.completedAt,
    fileName: typeof parsed.fileName === 'string' ? parsed.fileName : 'database.dump',
    relativePath: parsed.relativePath,
    bytes: parsed.bytes,
    sha256: validateSha256(parsed.sha256),
  }
}

function encodeManifest(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`
}

function runRecord(value) {
  const row = Array.isArray(value) ? value[0] : value
  if (!row || typeof row !== 'object' || typeof row.id !== 'string') {
    throw new Error('backup RPC returned an invalid run')
  }
  return row
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const stream = fs.createReadStream(filePath)
    stream.on('error', reject)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

async function validateCustomDump(filePath) {
  const handle = await fsp.open(filePath, 'r')
  try {
    const header = Buffer.alloc(5)
    const { bytesRead } = await handle.read(header, 0, header.length, 0)
    if (bytesRead !== header.length || header.toString('ascii') !== 'PGDMP') {
      throw new Error('pg_dump output is not a PostgreSQL custom-format archive')
    }
  } finally {
    await handle.close()
  }
}

function execFile(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...options,
      windowsHide: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk.toString() })
    child.stderr.on('data', (chunk) => { stderr += chunk.toString() })
    child.on('error', reject)
    child.on('close', (code, signal) => resolve({ code, signal, stdout, stderr }))
  })
}

async function findOnPath() {
  const command = process.platform === 'win32' ? 'where.exe' : 'which'
  try {
    const result = await execFile(command, [process.platform === 'win32' ? 'pg_dump.exe' : 'pg_dump'])
    if (result.code === 0) {
      const first = result.stdout.split(/\r?\n/).map((value) => value.trim()).find(Boolean)
      if (first && fs.existsSync(first)) return first
    }
  } catch {
    // The setup screen will explain how to choose pg_dump.exe.
  }
  return null
}

class BackupEngine {
  constructor(config, onLog = () => {}) {
    this.config = {
      ...config,
      supabaseUrl: required(config.supabaseUrl, 'กรุณาระบุ Supabase project URL'),
      serviceRoleKey: required(config.serviceRoleKey, 'กรุณาระบุ service role key'),
      databaseUrl: required(config.databaseUrl, 'กรุณาระบุ PostgreSQL connection string'),
      backupRoot: path.resolve(required(config.backupRoot, 'กรุณาระบุโฟลเดอร์สำรองข้อมูล')),
      runnerId: required(config.runnerId, 'กรุณาระบุชื่อเครื่อง runner'),
      expectedProjectRef: required(config.expectedProjectRef, 'ไม่พบ project reference'),
    }
    this.projectRef = parseProjectRefFromUrl(this.config.supabaseUrl)
    this.profileId = typeof this.config.profileId === 'string' ? this.config.profileId : 'stock'
    this.profileLabel = typeof this.config.profileLabel === 'string' ? this.config.profileLabel : 'LABCBH Stock'
    if (this.projectRef !== this.config.expectedProjectRef.toLowerCase()) {
      throw new Error(`ไม่ยอมสำรอง: project reference ไม่ตรงกัน (${this.config.expectedProjectRef} / ${this.projectRef})`)
    }
    const parsedDatabaseUrl = new URL(this.config.databaseUrl)
    if (!['postgres:', 'postgresql:'].includes(parsedDatabaseUrl.protocol)) {
      throw new Error('PostgreSQL connection string ไม่ถูกต้อง')
    }
    this.secrets = [
      this.config.serviceRoleKey,
      this.config.databaseUrl,
      parsedDatabaseUrl.password ? decodeURIComponent(parsedDatabaseUrl.password) : '',
    ].filter(Boolean)
    this.onLog = onLog
  }

  log(level, message, details) {
    this.onLog({
      level,
      message: sanitizeBackupError(details ? `${message}: ${details}` : message, this.secrets),
      at: new Date().toISOString(),
    })
  }

  async request(url, options = {}) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 20_000)
    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          apikey: this.config.serviceRoleKey,
          Authorization: `Bearer ${this.config.serviceRoleKey}`,
          'Content-Type': 'application/json',
          ...(options.headers || {}),
        },
      })
      const text = await response.text()
      if (!response.ok) {
        throw new Error(`Supabase request failed (${response.status}): ${sanitizeBackupError(text, this.secrets)}`)
      }
      if (!text.trim()) return null
      try {
        return JSON.parse(text)
      } catch {
        throw new Error('Supabase returned an invalid response')
      }
    } catch (cause) {
      if (cause?.name === 'AbortError') throw new Error('Supabase connection timed out')
      throw new Error(sanitizeBackupError(cause, this.secrets))
    } finally {
      clearTimeout(timer)
    }
  }

  async rpc(name, params) {
    return this.request(`${this.config.supabaseUrl}/rest/v1/rpc/${name}`, {
      method: 'POST',
      body: JSON.stringify(params),
      headers: { Prefer: 'return=representation' },
    })
  }

  async getRuns(query) {
    const url = new URL(`${this.config.supabaseUrl}/rest/v1/lab_stock_backup_runs`)
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value)
    return this.request(url.toString(), { method: 'GET' })
  }

  async heartbeat() {
    await this.rpc('heartbeat_lab_stock_backup_runner', {
      p_runner_id: this.config.runnerId,
      p_project_ref: this.projectRef,
      p_version: `${BACKUP_RUNNER_VERSION} ${os.platform()} ${os.release()}`,
    })
  }

  startHeartbeat() {
    let inFlight = false
    const send = async () => {
      if (inFlight) return
      inFlight = true
      try {
        await this.heartbeat()
      } catch (cause) {
        this.log('warning', 'ส่งสถานะ runner ไม่สำเร็จ', cause)
      } finally {
        inFlight = false
      }
    }
    const timer = setInterval(() => void send(), 30_000)
    return () => clearInterval(timer)
  }

  async claimNext() {
    const data = await this.rpc('claim_lab_stock_backup', {
      p_runner_id: this.config.runnerId,
      p_project_ref: this.projectRef,
    })
    if (data === null || data === undefined || (Array.isArray(data) && data.length === 0)) return null
    return runRecord(data)
  }

  async requestManual() {
    const data = await this.rpc('request_lab_stock_backup_from_runner', {
      p_project_ref: this.projectRef,
    })
    return runRecord(data)
  }

  async enqueueScheduled() {
    const data = await this.rpc('enqueue_lab_stock_backup', {
      p_project_ref: this.projectRef,
    })
    return runRecord(data)
  }

  async hasActiveRequest() {
    const rows = await this.getRuns({
      select: 'id',
      project_ref: `eq.${this.projectRef}`,
      status: 'in.(requested,running)',
      limit: '1',
    })
    return Array.isArray(rows) && rows.length > 0
  }

  async lastSuccessfulAt() {
    const rows = await this.getRuns({
      select: 'completed_at',
      project_ref: `eq.${this.projectRef}`,
      status: 'in.(succeeded,pruned)',
      completed_at: 'not.is.null',
      order: 'completed_at.desc.nullslast',
      limit: '1',
    })
    return rows?.[0]?.completed_at || null
  }

  async latestSuccessfulId() {
    const rows = await this.getRuns({
      select: 'id',
      project_ref: `eq.${this.projectRef}`,
      status: 'eq.succeeded',
      order: 'completed_at.desc.nullslast',
      limit: '1',
    })
    return rows?.[0]?.id || null
  }

  async resolvePgDumpPath() {
    const candidates = [
      this.config.pgDumpPath,
      process.resourcesPath ? path.join(process.resourcesPath, 'postgresql', process.platform === 'win32' ? 'pg_dump.exe' : 'pg_dump') : '',
      process.env.PG_DUMP_PATH,
    ].filter(Boolean)
    for (const candidate of candidates) {
      const resolved = path.resolve(candidate)
      if (fs.existsSync(resolved)) return resolved
    }
    return findOnPath()
  }

  databaseCommand(outputPath, pgDumpPath) {
    const parsed = new URL(this.config.databaseUrl)
    const databaseName = decodeURIComponent(parsed.pathname.replace(/^\/+/, '') || 'postgres')
    const username = decodeURIComponent(parsed.username || 'postgres')
    const password = decodeURIComponent(parsed.password || '')
    const sslMode = parsed.searchParams.get('sslmode') || 'require'
    const env = { ...process.env, PGSSLMODE: sslMode }
    delete env.SUPABASE_SERVICE_ROLE_KEY
    delete env.BACKUP_DATABASE_URL
    if (password) env.PGPASSWORD = password

    return {
      command: pgDumpPath,
      args: [
        '--format=custom',
        '--compress=6',
        '--no-owner',
        '--no-privileges',
        '--no-password',
        '--file',
        outputPath,
        '--host',
        parsed.hostname,
        '--port',
        parsed.port || '5432',
        '--username',
        username,
        '--dbname',
        databaseName,
      ],
      env,
    }
  }

  executePgDump(outputPath, pgDumpPath) {
    const { command, args, env } = this.databaseCommand(outputPath, pgDumpPath)
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        env,
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'pipe'],
      })
      let stderr = ''
      child.stderr.on('data', (chunk) => { stderr += chunk.toString() })
      child.on('error', (cause) => reject(new Error(`pg_dump ไม่สามารถเริ่มทำงานได้: ${sanitizeBackupError(cause, this.secrets)}`)))
      child.on('close', (code, signal) => {
        if (code === 0) {
          resolve({ stderr })
          return
        }
        const suffix = signal ? ` (${signal})` : ''
        reject(new Error(`pg_dump จบการทำงานด้วยรหัส ${code ?? 'ไม่ทราบ'}${suffix}: ${sanitizeBackupError(stderr, this.secrets)}`))
      })
    })
  }

  async reportFailure(run, cause) {
    const message = sanitizeBackupError(cause, this.secrets)
    try {
      await this.rpc('fail_lab_stock_backup', {
        p_run_id: run.id,
        p_runner_id: this.config.runnerId,
        p_error_code: 'RUNNER_FAILURE',
        p_error_message: message,
        p_metadata: { runnerVersion: BACKUP_RUNNER_VERSION, client: 'desktop' },
      })
    } catch (reportError) {
      this.log('error', 'บันทึกความล้มเหลวลงระบบไม่สำเร็จ', reportError)
    }
    this.log('error', `สำรองไม่สำเร็จ · run ${run.id}`, message)
    return message
  }

  async processClaimedRun(run) {
    const paths = artifactPaths(this.config.backupRoot, run.id)
    let completionReported = false
    try {
      await fsp.mkdir(paths.databaseRoot, { recursive: true })
      await fsp.mkdir(paths.runDirectory, { recursive: false })
      const pgDumpPath = await this.resolvePgDumpPath()
      if (!pgDumpPath) throw new Error('ไม่พบ pg_dump.exe กรุณาเลือกไฟล์ pg_dump.exe ในการตั้งค่า')

      this.log('info', 'กำลังสร้างไฟล์สำรองฐานข้อมูล')
      await this.executePgDump(paths.partialDumpPath, pgDumpPath)
      const fileInfo = await fsp.stat(paths.partialDumpPath)
      if (!fileInfo.isFile() || fileInfo.size < 1) throw new Error('pg_dump สร้างไฟล์ว่าง')
      await validateCustomDump(paths.partialDumpPath)

      await fsp.rename(paths.partialDumpPath, paths.dumpPath)
      const bytes = fileInfo.size
      const sha256 = await sha256File(paths.dumpPath)
      const completedAt = new Date().toISOString()
      const manifest = {
        format: 'postgresql-custom',
        tool: 'pg_dump',
        runnerVersion: BACKUP_RUNNER_VERSION,
        runId: run.id,
        profileId: this.profileId,
        profileLabel: this.profileLabel,
        projectRef: this.projectRef,
        runnerId: this.config.runnerId,
        triggerSource: run.trigger_source,
        createdAt: new Date().toISOString(),
        completedAt,
        fileName: path.basename(paths.dumpPath),
        relativePath: paths.relativePath,
        bytes,
        sha256,
      }
      await fsp.writeFile(paths.manifestPath, encodeManifest(manifest), { flag: 'wx' })
      await this.rpc('complete_lab_stock_backup', {
        p_run_id: run.id,
        p_runner_id: this.config.runnerId,
        p_file_name: path.basename(paths.dumpPath),
        p_relative_path: paths.relativePath,
        p_bytes: bytes,
        p_sha256: sha256,
        p_metadata: {
          format: manifest.format,
          tool: manifest.tool,
          runnerVersion: manifest.runnerVersion,
          manifestFile: 'manifest.json',
          client: 'desktop',
        },
      })
      completionReported = true
      this.log('success', `สำรองสำเร็จ · ${bytes} bytes · run ${run.id}`)
      return { status: 'succeeded', runId: run.id, bytes, sha256, manifest }
    } catch (cause) {
      if (!completionReported) {
        await fsp.rm(paths.runDirectory, { recursive: true, force: true }).catch((cleanupError) => {
          this.log('warning', 'ล้างไฟล์สำรองที่ค้างไม่สำเร็จ', cleanupError)
        })
        await this.reportFailure(run, cause)
      }
      return { status: 'failed', runId: run.id, error: sanitizeBackupError(cause, this.secrets) }
    }
  }

  async pruneOldArtifacts() {
    const protectedRunId = await this.latestSuccessfulId()
    const cutoff = Date.now() - BACKUP_RETENTION_MS
    let entries
    try {
      entries = await fsp.readdir(path.resolve(this.config.backupRoot, 'database'), { withFileTypes: true })
    } catch (cause) {
      if (cause?.code === 'ENOENT') return
      throw cause
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || !UUID_PATTERN.test(entry.name)) continue
      let manifest
      let paths
      try {
        paths = artifactPaths(this.config.backupRoot, entry.name)
        manifest = decodeManifest(await fsp.readFile(paths.manifestPath, 'utf8'))
      } catch {
        continue
      }
      if (manifest.runId !== entry.name || manifest.runId === protectedRunId) continue
      const completedAt = new Date(manifest.completedAt).getTime()
      if (!Number.isFinite(completedAt) || completedAt >= cutoff || manifest.relativePath !== paths.relativePath) continue

      await fsp.rm(paths.runDirectory, { recursive: true, force: false })
      try {
        await this.rpc('mark_lab_stock_backup_pruned', {
          p_run_id: entry.name,
          p_relative_path: paths.relativePath,
        })
        this.log('info', `ล้างไฟล์สำรองเก่าแล้ว · run ${entry.name}`)
      } catch (cause) {
        this.log('warning', 'ล้างไฟล์สำเร็จแล้วแต่บันทึกสถานะในระบบไม่สำเร็จ', cause)
      }
    }
  }

  async testConnection() {
    const pgDumpPath = await this.resolvePgDumpPath()
    await this.heartbeat()
    await this.getRuns({ select: 'id', project_ref: `eq.${this.projectRef}`, limit: '1' })
    return { projectRef: this.projectRef, pgDumpPath, pgDumpAvailable: Boolean(pgDumpPath) }
  }

  async runOnce(triggerSource = 'manual') {
    const stopHeartbeat = this.startHeartbeat()
    try {
      await this.heartbeat()
      const pgDumpPath = await this.resolvePgDumpPath()
      if (!pgDumpPath) throw new Error('ไม่พบ pg_dump.exe กรุณาเลือกไฟล์ pg_dump.exe ในการตั้งค่า')

      let requestedRun = null
      if (triggerSource === 'scheduled') {
        if (await this.hasActiveRequest()) return { status: 'skipped', reason: 'มีงานสำรองที่กำลังรอหรือทำงานอยู่' }
        const lastCompletedAt = await this.lastSuccessfulAt()
        if (lastCompletedAt) {
          const completedAt = new Date(lastCompletedAt).getTime()
          if (Number.isFinite(completedAt) && Date.now() - completedAt < SCHEDULE_INTERVAL_MS) {
            return { status: 'skipped', reason: `สำรองล่าสุดเมื่อ ${lastCompletedAt}` }
          }
        }
        requestedRun = await this.enqueueScheduled()
      } else {
        requestedRun = await this.requestManual()
      }

      this.log('info', `รับคำขอสำรองแล้ว · run ${requestedRun.id}`)
      const claimedRun = await this.claimNext()
      if (!claimedRun) {
        return { status: 'waiting', runId: requestedRun.id, reason: 'มี runner อื่นกำลังทำงานอยู่' }
      }
      const result = await this.processClaimedRun(claimedRun)
      try {
        await this.pruneOldArtifacts()
      } catch (cause) {
        this.log('warning', 'สำรองสำเร็จแล้ว แต่ล้างไฟล์เก่าไม่สำเร็จ', cause)
      }
      return result
    } finally {
      stopHeartbeat()
    }
  }

  async readLocalStatus() {
    const databaseRoot = path.resolve(this.config.backupRoot, 'database')
    let entries
    try {
      entries = await fsp.readdir(databaseRoot, { withFileTypes: true })
    } catch (cause) {
      if (cause?.code === 'ENOENT') return { latest: null, count: 0 }
      throw cause
    }
    const manifests = []
    for (const entry of entries) {
      if (!entry.isDirectory() || !UUID_PATTERN.test(entry.name)) continue
      try {
        const paths = artifactPaths(this.config.backupRoot, entry.name)
        const manifest = decodeManifest(await fsp.readFile(paths.manifestPath, 'utf8'))
        manifests.push({
          ...manifest,
          artifactExists: fs.existsSync(paths.dumpPath),
        })
      } catch {
        // Ignore incomplete or manually edited directories in the local status view.
      }
    }
    manifests.sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime())
    return { latest: manifests[0] || null, count: manifests.length }
  }
}

module.exports = {
  BACKUP_RETENTION_DAYS,
  BACKUP_RUNNER_VERSION,
  BackupEngine,
  decodeManifest,
  artifactPaths,
  parseProjectRefFromUrl,
  sanitizeBackupError,
}
