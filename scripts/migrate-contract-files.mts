/**
 * One-time copy of contract documents out of the portal's Cloudflare R2 bucket
 * into the stock system's private Supabase Storage bucket.
 *
 * Nothing is ever deleted from R2. The originals stay put so that rolling the
 * cutover back leaves the portal with a working set of documents.
 *
 * Re-runnable: a file already present in the destination bucket is skipped, so
 * an interrupted run can simply be repeated. Presence is asked of Supabase
 * Storage rather than inferred from the key, because the portal's R2 keys
 * already use the same contracts/<id>/<name> shape this bucket does and so
 * cannot say whether a copy has happened.
 *
 * Defaults to a dry run. Pass --apply to write.
 *
 *   R2_ACCOUNT_ID=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... \
 *   R2_BUCKET_NAME=... node scripts/migrate-contract-files.mts [--apply]
 *
 * The R2 credentials live in the portal's environment. They are needed once,
 * for this copy, and never at runtime by the stock system.
 */
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const APPLY = process.argv.includes('--apply')
const ENV_FILE = process.env.CONTRACT_FILE_ENV ?? '.env.local'

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) {
    console.error(`missing ${name}; R2 credentials live in the portal's environment`)
    process.exit(1)
  }
  return value
}

function readSupabase(): { url: string; key: string } {
  const env = readFileSync(ENV_FILE, 'utf8')
  const url = env.match(/NEXT_PUBLIC_SUPABASE_URL=(.*)/)?.[1]?.trim()
  const key = env.match(/SUPABASE_SERVICE_ROLE_KEY=(.*)/)?.[1]?.trim()
  if (!url || !key) {
    console.error(`could not read Supabase credentials from ${ENV_FILE}`)
    process.exit(1)
  }
  return { url, key }
}

const BUCKET = 'lab-stock-contracts'

/**
 * The portal's R2 keys are already shaped contracts/<id>/<name>, the same
 * layout this bucket uses, so the object is copied under its existing key and
 * contracts.file_url never changes. That keeps the two stores addressable by
 * one value and leaves nothing to undo in the database on rollback.
 *
 * It also means the key cannot tell us whether a file has been copied yet, so
 * presence is asked of Supabase Storage rather than inferred from the string.
 */
function splitKey(key: string): { folder: string; name: string } {
  const lastSlash = key.lastIndexOf('/')
  return {
    folder: lastSlash === -1 ? '' : key.slice(0, lastSlash),
    name: key.slice(lastSlash + 1),
  }
}

async function main() {
  const { url, key: serviceKey } = readSupabase()
  const supabase = createClient(url, serviceKey)

  const r2 = new S3Client({
    region: 'auto',
    endpoint: `https://${requiredEnv('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: requiredEnv('R2_ACCESS_KEY_ID'),
      secretAccessKey: requiredEnv('R2_SECRET_ACCESS_KEY'),
    },
  })
  const r2Bucket = requiredEnv('R2_BUCKET_NAME')

  console.log(`target : ${url}`)
  console.log(`mode   : ${APPLY ? 'APPLY (writes)' : 'DRY RUN (no writes)'}`)

  const alreadyCopied = async (key: string): Promise<boolean> => {
    const { folder, name } = splitKey(key)
    const { data, error: listError } = await supabase.storage
      .from(BUCKET)
      .list(folder, { search: name })
    if (listError) throw new Error(`could not inspect ${BUCKET}: ${listError.message}`)
    return (data ?? []).some((entry) => entry.name === name)
  }

  const { data: contracts, error } = await supabase
    .from('contracts')
    .select('id,contract_number,file_url')
    .not('file_url', 'is', null)
    .order('id')

  if (error) {
    console.error('read failed:', error.message)
    process.exit(1)
  }

  let copied = 0
  let skipped = 0
  let failed = 0

  for (const contract of contracts ?? []) {
    const key: string = contract.file_url
    const id = Number(contract.id)

    try {
      if (await alreadyCopied(key)) {
        console.log(`  #${id} skip     present in ${BUCKET} (${key})`)
        skipped += 1
        continue
      }

      if (!APPLY) {
        console.log(`  #${id} would   copy ${key}`)
        copied += 1
        continue
      }

      const object = await r2.send(new GetObjectCommand({ Bucket: r2Bucket, Key: key }))
      const body = await object.Body?.transformToByteArray()
      if (!body) throw new Error('empty body from R2')

      const { error: uploadError } = await supabase.storage.from(BUCKET).upload(key, body, {
        upsert: true,
        contentType: object.ContentType ?? 'application/octet-stream',
      })
      if (uploadError) throw new Error(uploadError.message)

      console.log(`  #${id} copied   ${body.length} bytes -> ${key}`)
      copied += 1
    } catch (cause) {
      console.error(`  #${id} FAILED   ${key}: ${(cause as Error).message}`)
      failed += 1
    }
  }

  console.log(`\n${APPLY ? 'copied' : 'would copy'}: ${copied}   skipped: ${skipped}   failed: ${failed}`)
  if (failed > 0) process.exit(1)
}

main().catch((cause) => {
  console.error(cause)
  process.exit(1)
})
