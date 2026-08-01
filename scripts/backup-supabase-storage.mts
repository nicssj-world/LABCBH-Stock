import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  assertBackupDestination,
  parseSupabaseProjectRef,
  storageObjectDestination,
} from './backup-storage-lib'

type StorageObjectEvidence = {
  bucket: string
  objectName: string
  localPath: string
  bytes: number
  sha256: string
  updatedAt: string | null
}

function argument(name: string) {
  const index = process.argv.indexOf(name)
  const value = index >= 0 ? process.argv[index + 1]?.trim() : undefined
  if (!value || value.startsWith('--')) throw new Error(`missing ${name}`)
  return value
}

function readEnvValue(contents: string, name: string) {
  const line = contents
    .split(/\r?\n/)
    .find((candidate) => candidate.startsWith(`${name}=`))
  const value = line?.slice(name.length + 1).trim()
  if (!value) throw new Error(`missing ${name} in environment file`)
  return value
}

async function listDirectory(
  client: SupabaseClient,
  bucket: string,
  prefix: string,
): Promise<Array<{ name: string; id: string | null; metadata: Record<string, unknown> | null; updated_at: string | null }>> {
  const entries = []
  const limit = 100

  for (let offset = 0; ; offset += limit) {
    const { data, error } = await client.storage.from(bucket).list(prefix, {
      limit,
      offset,
      sortBy: { column: 'name', order: 'asc' },
    })
    if (error) throw new Error(`cannot list Storage bucket ${bucket}: ${error.message}`)
    entries.push(...data)
    if (data.length < limit) break
  }

  return entries
}

async function downloadDirectory(
  client: SupabaseClient,
  backupRoot: string,
  bucket: string,
  prefix: string,
  evidence: StorageObjectEvidence[],
) {
  const entries = await listDirectory(client, bucket, prefix)

  for (const entry of entries) {
    const objectName = prefix ? `${prefix}/${entry.name}` : entry.name
    if (!entry.id) {
      await downloadDirectory(client, backupRoot, bucket, objectName, evidence)
      continue
    }

    const { data, error } = await client.storage.from(bucket).download(objectName)
    if (error) throw new Error(`cannot download Storage object from ${bucket}: ${error.message}`)

    const bytes = Buffer.from(await data.arrayBuffer())
    const expectedSize = Number(entry.metadata?.size)
    if (Number.isFinite(expectedSize) && bytes.length !== expectedSize) {
      throw new Error(`Storage object size mismatch in bucket ${bucket}`)
    }

    const destination = storageObjectDestination(backupRoot, bucket, objectName)
    await mkdir(dirname(destination), { recursive: true })
    await writeFile(destination, bytes, { flag: 'wx' })
    evidence.push({
      bucket,
      objectName,
      localPath: relative(backupRoot, destination),
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      updatedAt: entry.updated_at,
    })
  }
}

async function main() {
  const envFile = resolve(argument('--env'))
  const backupRoot = resolve(argument('--out'))
  const expectedRef = argument('--expected-ref')
  assertBackupDestination(resolve('.backups'), backupRoot)

  const inventoryPath = resolve(backupRoot, 'inventory.json')
  if (existsSync(inventoryPath)) throw new Error('Storage backup inventory already exists')

  const env = await readFile(envFile, 'utf8')
  const url = readEnvValue(env, 'NEXT_PUBLIC_SUPABASE_URL')
  const serviceRole = readEnvValue(env, 'SUPABASE_SERVICE_ROLE_KEY')
  const actualRef = parseSupabaseProjectRef(url)
  if (actualRef !== expectedRef) {
    throw new Error(`refusing Storage backup: expected project ${expectedRef}, received ${actualRef}`)
  }

  await mkdir(backupRoot, { recursive: true })
  const client = createClient(url, serviceRole, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data: buckets, error } = await client.storage.listBuckets()
  if (error) throw new Error(`cannot list Storage buckets: ${error.message}`)

  const evidence: StorageObjectEvidence[] = []
  for (const bucket of [...buckets].sort((left, right) => left.id.localeCompare(right.id))) {
    await downloadDirectory(client, backupRoot, bucket.id, '', evidence)
  }

  evidence.sort((left, right) =>
    `${left.bucket}/${left.objectName}`.localeCompare(`${right.bucket}/${right.objectName}`),
  )
  const totalBytes = evidence.reduce((sum, object) => sum + object.bytes, 0)
  await writeFile(
    inventoryPath,
    `${JSON.stringify({
      projectRef: actualRef,
      createdAt: new Date().toISOString(),
      buckets: buckets.map((bucket) => bucket.id).sort(),
      objectCount: evidence.length,
      totalBytes,
      objects: evidence,
    }, null, 2)}\n`,
    { flag: 'wx' },
  )

  console.log(`Storage backup complete: buckets=${buckets.length} objects=${evidence.length} bytes=${totalBytes}`)
}

main().catch((cause) => {
  console.error(cause instanceof Error ? cause.message : cause)
  process.exit(1)
})
