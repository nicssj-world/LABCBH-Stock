import { Buffer } from 'node:buffer'
import { isAbsolute, relative, resolve, sep } from 'node:path'

function encodedSegment(value: string) {
  if (!value) return '_empty'
  return Buffer.from(value, 'utf8').toString('base64url')
}

export function assertBackupDestination(backupsRoot: string, destination: string) {
  const root = resolve(backupsRoot)
  const target = resolve(destination)
  const relativeTarget = relative(root, target)

  if (
    !relativeTarget ||
    relativeTarget === '..' ||
    relativeTarget.startsWith(`..${sep}`) ||
    isAbsolute(relativeTarget)
  ) {
    throw new Error('backup destination must be inside .backups')
  }
}

export function storageObjectDestination(
  backupRoot: string,
  bucket: string,
  objectName: string,
) {
  if (!bucket) throw new Error('storage bucket is required')
  if (!objectName) throw new Error('storage object name is required')

  const destination = resolve(
    backupRoot,
    'objects',
    encodedSegment(bucket),
    ...objectName.split('/').map(encodedSegment),
  )
  assertBackupDestination(backupRoot, destination)
  return destination
}

export function parseSupabaseProjectRef(url: string) {
  const match = /^https:\/\/([a-z0-9]+)\.supabase\.co\/?$/i.exec(url.trim())
  if (!match) throw new Error('expected a Supabase project URL')
  return match[1]
}
