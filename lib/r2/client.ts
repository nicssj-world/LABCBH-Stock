import 'server-only'

import { S3Client } from '@aws-sdk/client-s3'

let cachedClient: S3Client | null = null

function requiredR2Env(name: 'R2_ACCOUNT_ID' | 'R2_ACCESS_KEY_ID' | 'R2_SECRET_ACCESS_KEY' | 'R2_BUCKET_NAME') {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`ยังไม่ได้ตั้งค่า ${name} สำหรับ Cloudflare R2`)
  return value
}

export function getR2Client() {
  if (!cachedClient) {
    cachedClient = new S3Client({
      region: 'auto',
      endpoint: `https://${requiredR2Env('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: requiredR2Env('R2_ACCESS_KEY_ID'),
        secretAccessKey: requiredR2Env('R2_SECRET_ACCESS_KEY'),
      },
    })
  }
  return cachedClient
}

export function getR2BucketName() {
  return requiredR2Env('R2_BUCKET_NAME')
}
