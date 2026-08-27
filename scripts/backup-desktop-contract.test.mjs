import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  BackupEngine,
  artifactPaths,
  decodeManifest,
  parseProjectRefFromUrl,
  sanitizeBackupError,
} from '../desktop/backup-engine.cjs'
import {
  PROFILE_DEFINITIONS,
  defaultProfile,
  normalizeProfileId,
} from '../desktop/profile-config.cjs'

const runId = '11111111-1111-4111-8111-111111111111'
const root = mkdtempSync(path.join(os.tmpdir(), 'labcbh-backup-contract-'))

try {
  const paths = artifactPaths(root, runId)
  assert.equal(paths.relativePath, `database/${runId}/database-${runId}.dump`)
  assert.throws(() => artifactPaths(root, '../outside'), /invalid/)
  assert.equal(parseProjectRefFromUrl('https://stogulcfwsvunydmwrex.supabase.co/'), 'stogulcfwsvunydmwrex')
  assert.throws(() => parseProjectRefFromUrl('https://example.com'), /Supabase project URL/)
  assert.deepEqual(PROFILE_DEFINITIONS.map((profile) => profile.id), ['stock', 'portal'])
  assert.equal(normalizeProfileId('PORTAL'), 'portal')
  assert.equal(defaultProfile('portal', root).expectedProjectRef, 'fslagsuorkcckvvtrmyi')

  const manifest = decodeManifest(JSON.stringify({
    format: 'postgresql-custom',
    tool: 'pg_dump',
    runnerVersion: 'test',
    runId,
    projectRef: 'stogulcfwsvunydmwrex',
    runnerId: 'test-runner',
    triggerSource: 'manual',
    createdAt: '2026-08-27T00:00:00.000Z',
    completedAt: '2026-08-27T00:00:01.000Z',
    fileName: path.basename(paths.dumpPath),
    relativePath: paths.relativePath,
    bytes: 5,
    sha256: 'a'.repeat(64),
  }))
  assert.equal(manifest.bytes, 5)
  assert.equal(manifest.sha256, 'a'.repeat(64))

  const secret = 'service-role-secret-value-1234567890'
  const safeError = sanitizeBackupError(`failed postgresql://postgres:super-secret@db.example.com:5432/postgres key=${secret}`, [secret])
  assert.equal(safeError.includes(secret), false)
  assert.equal(safeError.includes('super-secret'), false)
  assert.match(safeError, /redacted|\*\*\*/) 

  const pgDump = path.join(root, 'pg_dump.exe')
  writeFileSync(pgDump, 'test')
  const engine = new BackupEngine({
    supabaseUrl: 'https://stogulcfwsvunydmwrex.supabase.co',
    serviceRoleKey: secret,
    databaseUrl: 'postgresql://backup-user:db-password@db.example.com:5432/postgres?sslmode=require',
    backupRoot: root,
    runnerId: 'desktop-test',
    expectedProjectRef: 'stogulcfwsvunydmwrex',
    pgDumpPath: pgDump,
  })
  const command = engine.databaseCommand(paths.partialDumpPath, pgDump)
  assert.equal(command.args.includes('--no-password'), true)
  assert.equal(command.args.includes(paths.partialDumpPath), true)
  assert.equal(command.env.PGPASSWORD, 'db-password')

  const completeCalls = []
  engine.resolvePgDumpPath = async () => pgDump
  engine.executePgDump = async (outputPath) => writeFileSync(outputPath, Buffer.from('PGDMP\u0000test-archive'))
  engine.rpc = async (name, params) => {
    completeCalls.push({ name, params })
    return {}
  }
  const completed = await engine.processClaimedRun({ id: runId, trigger_source: 'manual' })
  assert.equal(completed.status, 'succeeded')
  assert.equal(existsSync(paths.dumpPath), true)
  assert.equal(existsSync(paths.partialDumpPath), false)
  assert.equal(JSON.parse(readFileSync(paths.manifestPath, 'utf8')).sha256, completed.sha256)
  assert.equal(completeCalls.some((call) => call.name === 'complete_lab_stock_backup'), true)

  const failedRunId = '22222222-2222-4222-8222-222222222222'
  const failedPaths = artifactPaths(root, failedRunId)
  const failedCalls = []
  const failedEngine = new BackupEngine({
    supabaseUrl: 'https://stogulcfwsvunydmwrex.supabase.co',
    serviceRoleKey: secret,
    databaseUrl: 'postgresql://backup-user:db-password@db.example.com:5432/postgres?sslmode=require',
    backupRoot: root,
    runnerId: 'desktop-test',
    expectedProjectRef: 'stogulcfwsvunydmwrex',
    pgDumpPath: pgDump,
  })
  failedEngine.resolvePgDumpPath = async () => pgDump
  failedEngine.executePgDump = async (outputPath) => {
    writeFileSync(outputPath, Buffer.from('PGDMP\u0000partial'))
    throw new Error('failed postgresql://backup-user:db-password@db.example.com/postgres')
  }
  failedEngine.rpc = async (name, params) => {
    failedCalls.push({ name, params })
    return {}
  }
  const failed = await failedEngine.processClaimedRun({ id: failedRunId, trigger_source: 'manual' })
  assert.equal(failed.status, 'failed')
  assert.equal(existsSync(failedPaths.runDirectory), false)
  assert.equal(failed.error.includes('db-password'), false)
  assert.equal(failedCalls.some((call) => call.name === 'fail_lab_stock_backup'), true)

  const main = readFileSync(path.resolve('desktop/main.cjs'), 'utf8')
  const engineSource = readFileSync(path.resolve('desktop/backup-engine.cjs'), 'utf8')
  const preload = readFileSync(path.resolve('desktop/preload.cjs'), 'utf8')
  const html = readFileSync(path.resolve('desktop/renderer/index.html'), 'utf8')
  const css = readFileSync(path.resolve('desktop/renderer/styles.css'), 'utf8')
  assert.match(main, /safeStorage/)
  assert.match(main, /contextIsolation: true/)
  assert.match(main, /nodeIntegration: false/)
  assert.match(main, /SETTINGS_VERSION = 2/)
  assert.match(main, /--profile/)
  assert.match(main, /TASK_PREFIX = 'LABCBH Database Backup'/)
  assert.match(main, /function taskName\(profileId\)/)
  assert.match(main, /if \(profileId === 'stock'\) await removeTaskByName\(LEGACY_TASK_NAME\)/)
  assert.match(engineSource, /request_lab_stock_backup_from_runner/)
  assert.match(preload, /contextBridge\.exposeInMainWorld/)
  assert.equal(/gradient|backdrop-filter/i.test(css), false)
  assert.equal(/<script[^>]+src=["']https?:/i.test(html), false)
  assert.match(html, /aria-live/)
  console.log('backup desktop contract test passed')
} finally {
  rmSync(root, { recursive: true, force: true })
}
