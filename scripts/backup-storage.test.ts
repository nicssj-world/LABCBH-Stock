import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { resolve, sep } from 'node:path'

async function main() {
  const modulePath = resolve('scripts/backup-storage-lib.ts')
  assert.ok(existsSync(modulePath), 'backup storage path guard must exist')

  const {
    assertBackupDestination,
    parseSupabaseProjectRef,
    storageObjectDestination,
  } = await import('./backup-storage-lib')

  const backupRoot = resolve('.backups', 'test-cutover')
  const destination = storageObjectDestination(
    backupRoot,
    'documents',
    '../../private/สัญญาเลขที่ 1.pdf',
  )

  assert.ok(
    destination.startsWith(`${backupRoot}${sep}`),
    'encoded object destination must stay inside the requested backup root',
  )
  assert.doesNotMatch(destination, /\.\.[\\/]/, 'encoded destination must not retain traversal')
  assert.notEqual(
    destination,
    storageObjectDestination(backupRoot, 'documents', '../private/สัญญาเลขที่ 1.pdf'),
    'different object keys must not collapse to the same local path',
  )

  assert.equal(
    parseSupabaseProjectRef('https://fslagsuorkcckvvtrmyi.supabase.co'),
    'fslagsuorkcckvvtrmyi',
  )
  assert.throws(
    () => parseSupabaseProjectRef('https://example.com'),
    /Supabase project URL/,
  )

  assert.doesNotThrow(() =>
    assertBackupDestination(resolve('.backups'), resolve('.backups', '20260801-000000', 'storage')),
  )
  assert.throws(
    () => assertBackupDestination(resolve('.backups'), resolve('outside-storage')),
    /inside \.backups/,
  )
  assert.throws(
    () => assertBackupDestination(resolve('.backups'), resolve('.backups')),
    /inside \.backups/,
  )

  console.log('backup storage path guards: ok')
}

main().catch((cause) => {
  console.error(cause)
  process.exit(1)
})
