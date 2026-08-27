import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, relative } from 'node:path'

async function main() {
  const {
    BACKUP_RETENTION_DAYS,
    backupArtifactPaths,
    decodeManifest,
    encodeManifest,
    sanitizeBackupError,
  } = await import('./backup-database-lib')

  const backupRoot = mkdtempSync(resolve(tmpdir(), 'labcbh-backup-test-'))
  const runId = '5c0a8f29-7e68-4e3c-9f6d-9e7c5b5f2a10'
  const paths = backupArtifactPaths(backupRoot, runId)

  assert.equal(BACKUP_RETENTION_DAYS, 30)
  assert.equal(paths.relativePath, `database/${runId}/database-${runId}.dump`)
  assert.equal(relative(paths.root, paths.dumpPath).replaceAll('\\', '/'), paths.relativePath)
  assert.ok(paths.runDirectory.startsWith(resolve(backupRoot)))
  assert.throws(
    () => backupArtifactPaths(backupRoot, '../outside'),
    /backup run id is invalid/,
  )

  const manifest = {
    format: 'postgresql-custom' as const,
    tool: 'pg_dump' as const,
    runnerVersion: '1.0.0',
    runId,
    projectRef: 'fslagsuorkcckvvtrmyi',
    runnerId: 'test-runner',
    triggerSource: 'manual' as const,
    createdAt: '2026-08-27T00:00:00.000Z',
    completedAt: '2026-08-27T00:00:01.000Z',
    fileName: `database-${runId}.dump`,
    relativePath: paths.relativePath,
    bytes: 1024,
    sha256: 'a'.repeat(64),
  }
  assert.deepEqual(decodeManifest(encodeManifest(manifest)), manifest)
  assert.throws(
    () => decodeManifest(encodeManifest({ ...manifest, relativePath: '../outside.dump' })),
    /backup manifest is invalid/,
  )

  const redacted = sanitizeBackupError(
    'connection failed postgresql://postgres:super-secret@db.example/postgres password=another-secret BACKUP_DATABASE_URL=postgresql://u:p@db.example/postgres',
  )
  assert.doesNotMatch(redacted, /super-secret|another-secret|u:p/)
  assert.match(redacted, /postgresql:\/\/\*\*\*:\*\*\*@redacted/)

  const runnerSource = readFileSync('scripts/backup-database.mts', 'utf8')
  assert.match(runnerSource, /--format=custom/)
  assert.match(runnerSource, /PGPASSWORD/)
  assert.match(runnerSource, /--no-password/)
  assert.match(runnerSource, /mark_lab_stock_backup_pruned/)
  assert.match(runnerSource, /process\.once\('SIGINT'/)

  console.log('database backup runner contracts: ok')
}

main().catch((cause) => {
  console.error(cause)
  process.exit(1)
})
