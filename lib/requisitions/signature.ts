import 'server-only'

import { supabaseAdmin } from '@/lib/supabase/admin'

export const SIGNATURE_BUCKET = 'signatures'
export const MAX_SIGNATURE_UPLOAD_BYTES = 2 * 1024 * 1024
export const MAX_SIGNATURE_DATA_URI_LENGTH = 500_000
export const PORTAL_PROFILE_PATH = '/staff/profile'

const PNG_DATA_URI_PREFIX = 'data:image/png;base64,'
const NORMALIZED_SIGNATURE_WIDTH = 900
const NORMALIZED_SIGNATURE_HEIGHT = 260
const NORMALIZED_CONTENT_WIDTH = 820
const NORMALIZED_CONTENT_HEIGHT = 170

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

export async function ensureSignatureBucket() {
  const { data, error } = await supabaseAdmin.storage.listBuckets()
  if (error) throw new Error(`ตรวจสอบพื้นที่ลายเซ็นต์ไม่สำเร็จ: ${error.message}`)
  if (!data?.some((bucket) => bucket.id === SIGNATURE_BUCKET)) {
    const { error: createError } = await supabaseAdmin.storage.createBucket(SIGNATURE_BUCKET, { public: false })
    if (createError && !/already exists/i.test(createError.message)) {
      throw new Error(`เตรียมพื้นที่ลายเซ็นต์ไม่สำเร็จ: ${createError.message}`)
    }
  }
}

async function downloadSignature(path: string): Promise<Buffer | null> {
  const { data, error } = await supabaseAdmin.storage.from(SIGNATURE_BUCKET).download(path)
  if (error || !data) return null

  const bytes = Buffer.from(await data.arrayBuffer())
  if (bytes.length === 0 || bytes.length > MAX_SIGNATURE_UPLOAD_BYTES) return null
  return bytes
}

/**
 * Reads the current Portal profile signature server-side. The browser receives
 * a short-lived in-memory data URI preview; the private Storage path never
 * leaves the server.
 */
export async function loadPortalSignatureDataUri(profileId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('signature_url')
    .eq('id', profileId)
    .maybeSingle()

  if (error) throw new Error(`อ่านลายเซ็นต์จาก Portal ไม่สำเร็จ: ${error.message}`)
  if (!data?.signature_url) return null

  const bytes = await downloadSignature(data.signature_url)
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
