import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { existsSync } from 'node:fs'
import { mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { platform, release } from 'node:os'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  BACKUP_RETENTION_MS,
  BACKUP_RUNNER_VERSION,
  backupArtifactPaths,
  decodeManifest,
  encodeManifest,
  parseProjectRefFromUrl,
  requiredEnv,
  sanitizeBackupError,
  type BackupManifest,
} from './backup-database-lib'

type BackupRun = {
  id: string
  status: 'requested' | 'running' | 'succeeded' | 'failed' | 'pruned'
  trigger_source: 'manual' | 'scheduled'
  runner_id: string | null
  completed_at?: string | null
}

type RunnerContext = {
  client: SupabaseClient
  databaseUrl: string
  backupRoot: string
  runnerId: string
  projectRef: string
}

type CommandResult = { stderr: string }

const HEARTBEAT_INTERVAL_MS = 30_000
const WATCH_INTERVAL_MS = 15_000
const SCHEDULE_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000

function loadRunnerEnv(): void {
  if (typeof process.loadEnvFile !== 'function') return
  for (const fileName of ['.env.local', '.env']) {
    const filePath = resolve(process.cwd(), fileName)
    if (existsSync(filePath)) process.loadEnvFile(filePath)
  }
}

function usage(): never {
  throw new Error('usage: npm run backup:database -- --once|--watch|--scheduled')
}

function selectedMode(): 'once' | 'watch' | 'scheduled' {
  const modes = ['--once', '--watch', '--scheduled'] as const
  const selected = modes.filter((mode) => process.argv.includes(mode))
  if (selected.length !== 1) return usage()
  if (selected[0] === '--once') return 'once'
  if (selected[0] === '--watch') return 'watch'
  return 'scheduled'
}

function createRunnerContext(): RunnerContext {
  const supabaseUrl = requiredEnv('NEXT_PUBLIC_SUPABASE_URL')
  const serviceRoleKey = requiredEnv('SUPABASE_SERVICE_ROLE_KEY')
  const databaseUrl = requiredEnv('BACKUP_DATABASE_URL')
  const expectedProjectRef = requiredEnv('BACKUP_EXPECTED_PROJECT_REF').toLowerCase()
  const projectRef = parseProjectRefFromUrl(supabaseUrl).toLowerCase()

  if (projectRef !== expectedProjectRef) {
    throw new Error(`refusing database backup: expected project ${expectedProjectRef}, received ${projectRef}`)
  }

  const parsedDatabaseUrl = new URL(databaseUrl)
  if (!['postgres:', 'postgresql:'].includes(parsedDatabaseUrl.protocol)) {
    throw new Error('BACKUP_DATABASE_URL must be a PostgreSQL connection URL')
  }

  return {
    client: createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    }),
    databaseUrl,
    backupRoot: resolve(process.env.BACKUP_ROOT?.trim() || '.backups'),
    runnerId: requiredEnv('BACKUP_RUNNER_ID'),
    projectRef,
  }
}

function runRecord(value: unknown): BackupRun {
  const row = Array.isArray(value) ? value[0] : value
  if (!row || typeof row !== 'object' || typeof (row as { id?: unknown }).id !== 'string') {
    throw new Error('backup RPC returned an invalid run')
  }
  return row as BackupRun
}

async function heartbeat(context: RunnerContext): Promise<void> {
  const { error } = await context.client.rpc('heartbeat_lab_stock_backup_runner', {
    p_runner_id: context.runnerId,
    p_project_ref: context.projectRef,
    p_version: `${BACKUP_RUNNER_VERSION} ${platform()} ${release()}`,
  })
  if (error) throw new Error(`runner heartbeat failed: ${sanitizeBackupError(error.message)}`)
}

function startHeartbeat(context: RunnerContext): () => void {
  let inFlight = false
  const send = async () => {
    if (inFlight) return
    inFlight = true
    try {
      await heartbeat(context)
    } catch (cause) {
      console.warn(`runner heartbeat warning: ${sanitizeBackupError(cause)}`)
    } finally {
      inFlight = false
    }
  }

  const timer = setInterval(() => void send(), HEARTBEAT_INTERVAL_MS)
  return () => clearInterval(timer)
}

async function claimNext(context: RunnerContext): Promise<BackupRun | null> {
  const { data, error } = await context.client.rpc('claim_lab_stock_backup', {
    p_runner_id: context.runnerId,
    p_project_ref: context.projectRef,
  })
  if (error) throw new Error(`claiming backup request failed: ${sanitizeBackupError(error.message)}`)
  if (data === null || data === undefined || (Array.isArray(data) && data.length === 0)) return null
  return runRecord(data)
}

async function hasActiveRequest(context: RunnerContext): Promise<boolean> {
  const { data, error } = await context.client
    .from('lab_stock_backup_runs')
    .select('id')
    .eq('project_ref', context.projectRef)
    .in('status', ['requested', 'running'])
    .limit(1)

  if (error) throw new Error(`checking backup queue failed: ${sanitizeBackupError(error.message)}`)
  return (data?.length ?? 0) > 0
}

async function lastSuccessfulAt(context: RunnerContext): Promise<string | null> {
  const { data, error } = await context.client
    .from('lab_stock_backup_runs')
    .select('completed_at')
    .eq('project_ref', context.projectRef)
    .in('status', ['succeeded', 'pruned'])
    .not('completed_at', 'is', null)
    .order('completed_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(`checking backup schedule failed: ${sanitizeBackupError(error.message)}`)
  return (data as { completed_at?: string | null } | null)?.completed_at ?? null
}

async function latestSuccessfulId(context: RunnerContext): Promise<string | null> {
  const { data, error } = await context.client
    .from('lab_stock_backup_runs')
    .select('id')
    .eq('project_ref', context.projectRef)
    .eq('status', 'succeeded')
    .order('completed_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(`reading latest backup failed: ${sanitizeBackupError(error.message)}`)
  return (data as { id?: string } | null)?.id ?? null
}

async function enqueueScheduledIfDue(context: RunnerContext): Promise<void> {
  if (await hasActiveRequest(context)) return

  const lastCompletedAt = await lastSuccessfulAt(context)
  if (lastCompletedAt) {
    const completedAt = new Date(lastCompletedAt).getTime()
    if (Number.isFinite(completedAt) && Date.now() - completedAt < SCHEDULE_INTERVAL_MS) {
      console.log(`scheduled backup skipped: last success was ${lastCompletedAt}`)
      return
    }
  }

  const { data, error } = await context.client.rpc('enqueue_lab_stock_backup', {
    p_project_ref: context.projectRef,
  })
  if (error) throw new Error(`queueing scheduled backup failed: ${sanitizeBackupError(error.message)}`)
  const queued = runRecord(data)
  console.log(`scheduled backup queued: run=${queued.id}`)
}

function pgDumpCommand(databaseUrl: string, outputPath: string) {
  const parsed = new URL(databaseUrl)
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\/+/, '') || 'postgres')
  const username = decodeURIComponent(parsed.username || 'postgres')
  const password = decodeURIComponent(parsed.password)
  const sslMode = parsed.searchParams.get('sslmode') || 'require'

  return {
    command: process.env.PG_DUMP_PATH?.trim() || 'pg_dump',
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
    env: {
      ...process.env,
      ...(password ? { PGPASSWORD: password } : {}),
      PGSSLMODE: sslMode,
    },
  }
}

function executePgDump(databaseUrl: string, outputPath: string): Promise<CommandResult> {
  const { command, args, env } = pgDumpCommand(databaseUrl, outputPath)

  return new Promise((resolveCommand, reject) => {
    const child = spawn(command, args, { env, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
    let stderr = ''

    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString()
    })
    child.on('error', (cause) => reject(new Error(`pg_dump could not start: ${sanitizeBackupError(cause)}`)))
    child.on('close', (code, signal) => {
      if (code === 0) {
        resolveCommand({ stderr })
        return
      }
      const suffix = signal ? ` (signal ${signal})` : ''
      reject(new Error(`pg_dump exited with code ${code ?? 'unknown'}${suffix}: ${sanitizeBackupError(stderr)}`))
    })
  })
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  const stream = createReadStream(filePath)
  for await (const chunk of stream) hash.update(chunk)
  return hash.digest('hex')
}

async function validateCustomDump(filePath: string): Promise<void> {
  const handle = await open(filePath, 'r')
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

async function reportFailure(context: RunnerContext, run: BackupRun, cause: unknown): Promise<void> {
  const errorMessage = sanitizeBackupError(cause)
  const { error } = await context.client.rpc('fail_lab_stock_backup', {
    p_run_id: run.id,
    p_runner_id: context.runnerId,
    p_error_code: 'RUNNER_FAILURE',
    p_error_message: errorMessage,
    p_metadata: { runnerVersion: BACKUP_RUNNER_VERSION },
  })
  if (error) {
    console.error(`could not record backup failure: ${sanitizeBackupError(error.message)}`)
  }
  console.error(`backup failed: run=${run.id} ${errorMessage}`)
}

async function processClaimedRun(context: RunnerContext, run: BackupRun): Promise<boolean> {
  const paths = backupArtifactPaths(context.backupRoot, run.id)
  let completionReported = false

  try {
    await mkdir(paths.databaseRoot, { recursive: true })
    await mkdir(paths.runDirectory, { recursive: false })

    await executePgDump(context.databaseUrl, paths.partialDumpPath)
    const fileInfo = await stat(paths.partialDumpPath)
    if (!fileInfo.isFile() || fileInfo.size < 1) throw new Error('pg_dump produced an empty backup')
    await validateCustomDump(paths.partialDumpPath)

    await rename(paths.partialDumpPath, paths.dumpPath)
    const bytes = fileInfo.size
    const sha256 = await sha256File(paths.dumpPath)
    const completedAt = new Date().toISOString()
    const fileName = paths.dumpPath.slice(dirname(paths.dumpPath).length + 1)
    const manifest: BackupManifest = {
      format: 'postgresql-custom',
      tool: 'pg_dump',
      runnerVersion: BACKUP_RUNNER_VERSION,
      runId: run.id,
      projectRef: context.projectRef,
      runnerId: context.runnerId,
      triggerSource: run.trigger_source,
      createdAt: new Date().toISOString(),
      completedAt,
      fileName,
      relativePath: paths.relativePath,
      bytes,
      sha256,
    }

    await writeFile(paths.manifestPath, encodeManifest(manifest), { flag: 'wx' })

    const { error } = await context.client.rpc('complete_lab_stock_backup', {
      p_run_id: run.id,
      p_runner_id: context.runnerId,
      p_file_name: fileName,
      p_relative_path: paths.relativePath,
      p_bytes: bytes,
      p_sha256: sha256,
      p_metadata: {
        format: manifest.format,
        tool: manifest.tool,
        runnerVersion: manifest.runnerVersion,
        manifestFile: 'manifest.json',
      },
    })
    if (error) throw new Error(`recording backup completion failed: ${sanitizeBackupError(error.message)}`)

    completionReported = true
    console.log(`backup complete: run=${run.id} bytes=${bytes} sha256=${sha256}`)
    return true
  } catch (cause) {
    if (!completionReported) {
      await rm(paths.runDirectory, { recursive: true, force: true })
      await reportFailure(context, run, cause)
    }
    return false
  }
}

async function pruneOldArtifacts(context: RunnerContext): Promise<void> {
  const protectedRunId = await latestSuccessfulId(context)
  const cutoff = Date.now() - BACKUP_RETENTION_MS
  let entries

  try {
    entries = await readdir(resolve(context.backupRoot, 'database'), { withFileTypes: true })
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return
    throw cause
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue

    const runId = entry.name
    let manifest: BackupManifest
    let paths: ReturnType<typeof backupArtifactPaths>
    try {
      paths = backupArtifactPaths(context.backupRoot, runId)
      manifest = decodeManifest(await readFile(paths.manifestPath, 'utf8'))
    } catch {
      continue
    }

    if (manifest.runId !== runId || manifest.runId === protectedRunId) continue
    const completedAt = new Date(manifest.completedAt).getTime()
    if (!Number.isFinite(completedAt) || completedAt >= cutoff) continue
    if (manifest.relativePath !== paths.relativePath) continue

    await rm(paths.runDirectory, { recursive: true, force: false })
    const { error } = await context.client.rpc('mark_lab_stock_backup_pruned', {
      p_run_id: runId,
      p_relative_path: paths.relativePath,
    })
    if (error) console.warn(`backup file pruned but audit update failed: ${sanitizeBackupError(error.message)}`)
    else console.log(`backup artifact pruned: run=${runId}`)
  }
}

async function processNext(context: RunnerContext): Promise<boolean> {
  const run = await claimNext(context)
  if (!run) return false
  return processClaimedRun(context, run)
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))
}

async function main(): Promise<void> {
  loadRunnerEnv()
  const mode = selectedMode()
  const context = createRunnerContext()
  await heartbeat(context)
  const stopHeartbeat = startHeartbeat(context)
  let stopping = false
  const stop = () => { stopping = true }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)

  try {
    if (mode === 'scheduled') await enqueueScheduledIfDue(context)

    if (mode === 'watch') {
      console.log(`backup runner watching: project=${context.projectRef} runner=${context.runnerId}`)
      while (!stopping) {
        const processed = await processNext(context)
        await pruneOldArtifacts(context)
        if (!processed) await delay(WATCH_INTERVAL_MS)
      }
      return
    }

    const processed = await processNext(context)
    if (!processed) console.log('backup queue is empty')
    await pruneOldArtifacts(context)
  } finally {
    stopHeartbeat()
    process.removeListener('SIGINT', stop)
    process.removeListener('SIGTERM', stop)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((cause) => {
    console.error(sanitizeBackupError(cause))
    process.exitCode = 1
  })
}
