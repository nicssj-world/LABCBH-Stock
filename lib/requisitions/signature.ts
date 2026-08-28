import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { getPortalSupabaseAdmin } from '@/lib/supabase/portal-admin'

export const SIGNATURE_BUCKET = 'signatures'
export const MAX_SIGNATURE_UPLOAD_BYTES = 2 * 1024 * 1024
export const MAX_SIGNATURE_DATA_URI_LENGTH = 500_000
export const PORTAL_PROFILE_PATH = '/staff/profile'

const PNG_DATA_URI_PREFIX = 'data:image/png;base64,'
const NORMALIZED_SIGNATURE_WIDTH = 900
const NORMALIZED_SIGNATURE_HEIGHT = 260
const NORMALIZED_CONTENT_WIDTH = 820
const NORMALIZED_CONTENT_HEIGHT = 170

export interface PortalSignatureIdentity {
  id: string
  ephisId: string | null
  name: string | null
}

export interface PortalSignatureProfile {
  id: string
  ephisId: string | null
  name: string | null
  signatureUrl: string | null
}

const PORTAL_PROFILE_SELECT = 'id,ephis_id,name,signature_url,status,deleted_at'

function decodePngDataUri(dataUri: string): Buffer {
  if (!dataUri.startsWith(PNG_DATA_URI_PREFIX)) {
    throw new Error('รองรับเฉพาะลายเซ็นต์ PNG จาก canvas')
  }

  const encoded = dataUri.slice(PNG_DATA_URI_PREFIX.length)
  if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new Error('รูปแบบลายเซ็นต์ไม่ถูกต้อง')
  }

  const buffer = Buffer.from(encoded, 'base64')
  if (buffer.length === 0 || buffer.length > MAX_SIGNATURE_UPLOAD_BYTES) {
    throw new Error('ลายเซ็นต์ต้องมีขนาดไม่เกิน 2 MB')
  }
  return buffer
}

async function normalizeSignatureBuffer(input: Buffer): Promise<Buffer> {
  const sharp = (await import('sharp')).default
  const image = sharp(input, { animated: false })
  const metadata = await image.metadata()

  if (!metadata.width || !metadata.height) {
    throw new Error('อ่านภาพลายเซ็นต์ไม่สำเร็จ')
  }

  if (metadata.height > metadata.width * 1.6) {
    throw new Error('ลายเซ็นต์ควรเป็นภาพแนวนอน')
  }

  const trimmed = await sharp(input, { animated: false })
    .rotate()
    .trim({ threshold: 18 })
    .png()
    .toBuffer()
    .catch(() => sharp(input, { animated: false }).rotate().png().toBuffer())

  const fitted = await sharp(trimmed)
    .resize({
      width: NORMALIZED_CONTENT_WIDTH,
      height: NORMALIZED_CONTENT_HEIGHT,
      fit: 'inside',
      withoutEnlargement: false,
    })
    .png()
    .toBuffer()

  const output = await sharp({
    create: {
      width: NORMALIZED_SIGNATURE_WIDTH,
      height: NORMALIZED_SIGNATURE_HEIGHT,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 0 },
    },
  })
    .composite([{ input: fitted, gravity: 'center' }])
    .png()
    .toBuffer()

  const dataUriLength = PNG_DATA_URI_PREFIX.length + Buffer.byteLength(output.toString('base64'))
  if (dataUriLength > MAX_SIGNATURE_DATA_URI_LENGTH) {
    throw new Error('ลายเซ็นต์มีขนาดใหญ่เกินไปหลังปรับภาพ')
  }

  return output
}

export async function normalizeDrawnSignature(dataUri: string) {
  const input = decodePngDataUri(dataUri)
  const output = await normalizeSignatureBuffer(input)
  return {
    buffer: output,
    dataUri: `${PNG_DATA_URI_PREFIX}${output.toString('base64')}`,
  }
}

export async function ensureSignatureBucket(client: SupabaseClient = getPortalSupabaseAdmin()) {
  const { data, error } = await client.storage.listBuckets()
  if (error) throw new Error(`ตรวจสอบพื้นที่ลายเซ็นต์ไม่สำเร็จ: ${error.message}`)
  if (!data?.some((bucket) => bucket.id === SIGNATURE_BUCKET)) {
    const { error: createError } = await client.storage.createBucket(SIGNATURE_BUCKET, { public: false })
    if (createError && !/already exists/i.test(createError.message)) {
      throw new Error(`เตรียมพื้นที่ลายเซ็นต์ไม่สำเร็จ: ${createError.message}`)
    }
  }
}

async function downloadSignature(client: SupabaseClient, path: string): Promise<Buffer | null> {
  const { data, error } = await client.storage.from(SIGNATURE_BUCKET).download(path)
  if (error || !data) return null

  const bytes = Buffer.from(await data.arrayBuffer())
  if (bytes.length === 0 || bytes.length > MAX_SIGNATURE_UPLOAD_BYTES) return null
  return bytes
}

function mapPortalProfile(row: Record<string, unknown>): PortalSignatureProfile | null {
  if (row.status !== 'active' || row.deleted_at !== null) return null
  if (typeof row.id !== 'string') return null

  return {
    id: row.id,
    ephisId: typeof row.ephis_id === 'string' ? row.ephis_id : null,
    name: typeof row.name === 'string' ? row.name : null,
    signatureUrl: typeof row.signature_url === 'string' ? row.signature_url : null,
  }
}

async function findPortalProfile(
  client: SupabaseClient,
  field: 'id' | 'ephis_id' | 'name',
  value: string,
): Promise<PortalSignatureProfile | null> {
  const { data, error } = await client
    .from('profiles')
    .select(PORTAL_PROFILE_SELECT)
    .eq(field, value)
    .limit(2)

  if (error) throw new Error(`อ่านโปรไฟล์จาก Lab Management Portal ไม่สำเร็จ: ${error.message}`)
  if (!data || data.length === 0) return null
  if (data.length > 1) {
    throw new Error(`พบโปรไฟล์ Portal ซ้ำหลายรายการสำหรับ ${field}`)
  }

  return mapPortalProfile(data[0] as Record<string, unknown>)
}

/**
 * Resolve a Stock actor to the Portal profile that owns the reusable
 * signature. UUIDs are shared in the production project, while staging can
 * use a different auth/profile project; ephis_id is the stable cross-project
 * identity in that case. Name is a last-resort migration bridge only when no
 * ephis_id is available and must still be unique.
 */
export async function resolvePortalSignatureProfile(
  identity: PortalSignatureIdentity,
): Promise<PortalSignatureProfile | null> {
  const client = getPortalSupabaseAdmin()
  const byId = await findPortalProfile(client, 'id', identity.id)
  if (byId) return byId

  const ephisId = identity.ephisId?.trim()
  if (ephisId) {
    const byEphisId = await findPortalProfile(client, 'ephis_id', ephisId)
    if (byEphisId) return byEphisId
  }

  const name = identity.name?.trim()
  return name ? findPortalProfile(client, 'name', name) : null
}

/**
 * Reads the current Portal profile signature server-side. The browser receives
 * a short-lived in-memory data URI preview; the private Storage path never
 * leaves the server.
 */
export async function loadPortalSignatureDataUri(
  identity: PortalSignatureIdentity,
): Promise<string | null> {
  const profile = await resolvePortalSignatureProfile(identity)
  if (!profile?.signatureUrl) return null

  const bytes = await downloadSignature(getPortalSupabaseAdmin(), profile.signatureUrl)
  if (!bytes) return null

  try {
    const normalized = await normalizeSignatureBuffer(bytes)
    return `${PNG_DATA_URI_PREFIX}${normalized.toString('base64')}`
  } catch {
    return null
  }
}

export function profileSignaturePath(profileId: string) {
  return `${profileId}.png`
}
