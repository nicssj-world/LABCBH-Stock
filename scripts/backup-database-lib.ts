import { isAbsolute, relative, resolve, sep } from 'node:path'

export const BACKUP_RETENTION_DAYS = 30
export const BACKUP_RETENTION_MS = BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000
export const BACKUP_RUNNER_VERSION = '1.0.0'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export interface BackupArtifactPaths {
  root: string
  databaseRoot: string
  runDirectory: string
  dumpPath: string
  partialDumpPath: string
  manifestPath: string
  relativePath: string
}

export interface BackupManifest {
  format: 'postgresql-custom'
  tool: 'pg_dump'
  runnerVersion: string
  runId: string
  projectRef: string
  runnerId: string
  triggerSource: 'manual' | 'scheduled'
  createdAt: string
  completedAt: string
  fileName: string
  relativePath: string
  bytes: number
  sha256: string
}

export function assertRunId(runId: string): string {
  if (!UUID_PATTERN.test(runId)) throw new Error('backup run id is invalid')
  return runId
}

function assertInside(root: string, destination: string) {
  const relativeTarget = relative(resolve(root), resolve(destination))
  if (
    !relativeTarget ||
    relativeTarget === '..' ||
    relativeTarget.startsWith(`..${sep}`) ||
    isAbsolute(relativeTarget)
  ) {
    throw new Error('backup artifact must stay inside BACKUP_ROOT')
  }
}

export function backupArtifactPaths(backupRoot: string, runId: string): BackupArtifactPaths {
  const safeRunId = assertRunId(runId)
  const root = resolve(backupRoot)
  const databaseRoot = resolve(root, 'database')
  const runDirectory = resolve(databaseRoot, safeRunId)
  const fileName = `database-${safeRunId}.dump`
  const dumpPath = resolve(runDirectory, fileName)
  const partialDumpPath = resolve(runDirectory, `${fileName}.partial`)
  const manifestPath = resolve(runDirectory, 'manifest.json')

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
    relativePath: relative(root, dumpPath).split(sep).join('/'),
  }
}

export function parseProjectRefFromUrl(value: string): string {
  const match = /^https:\/\/([a-z0-9]+)\.supabase\.co\/?$/i.exec(value.trim())
  if (!match) throw new Error('expected a Supabase project URL')
  return match[1]
}

export function requiredEnv(name: string, value = process.env[name]): string {
  const normalized = value?.trim()
  if (!normalized) throw new Error(`missing ${name}`)
  return normalized
}

/** Keep command output useful without allowing connection credentials into logs. */
export function sanitizeBackupError(value: unknown): string {
  const source = value instanceof Error ? value.message : String(value)
  return source
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, 'postgresql://***:***@redacted')
    .replace(/(password|passwd|secret|token|api[_-]?key)\s*[=:]\s*[^\s,;]+/gi, '$1=***')
    .replace(/(SUPABASE_SERVICE_ROLE_KEY|BACKUP_DATABASE_URL)\s*=\s*[^\s]+/gi, '$1=***')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 2000) || 'backup failed'
}

export function validateSha256(value: string): string {
  const normalized = value.trim().toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(normalized)) throw new Error('backup checksum is invalid')
  return normalized
}

export function encodeManifest(manifest: BackupManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`
}

export function decodeManifest(value: string): BackupManifest {
  const parsed = JSON.parse(value) as Partial<BackupManifest>
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
