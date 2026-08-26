import { createHash } from 'node:crypto'
import { CONTRACT_FILE_BUCKET } from '@/lib/contracts/files'

export const SERVICE_FILE_BUCKET = CONTRACT_FILE_BUCKET
export const SERVICE_ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024
export const SERVICE_PO_MAX_BYTES = 10 * 1024 * 1024
export const SERVICE_DOCUMENT_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] as const

export function serviceFilePath(ownerId: string, filename: string, kind: 'checklist' | 'po'): string {
  const safe = filename.split(/[\\/]/).pop()?.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/\.{2,}/g, '_') || 'document'
  const unique = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  return `service-procurement/${kind}/${ownerId}/${Date.now()}-${unique}-${safe}`
}

export function isServiceFilePathAllowed(path: string, ownerId: string, kind: 'checklist' | 'po'): boolean {
  if (!path || path.includes('..')) return false
  const prefix = `service-procurement/${kind}/${ownerId}/`
  return path.startsWith(prefix) && !path.slice(prefix.length).includes('/')
}

export function isServiceDocumentMimeAllowed(mime: string): boolean {
  return (SERVICE_DOCUMENT_MIME_TYPES as readonly string[]).includes(mime)
}

export function validateServiceAttachment(input: { kind: 'tor' | 'quotation'; mimeType: string; sizeBytes: number }): string[] {
  const errors: string[] = []
  if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes <= 0 || input.sizeBytes > SERVICE_ATTACHMENT_MAX_BYTES) {
    errors.push('ไฟล์แนบแต่ละไฟล์ต้องมีขนาดไม่เกิน 20 MB')
  }
  if (!isServiceDocumentMimeAllowed(input.mimeType)) errors.push('รองรับเฉพาะ PDF, JPG, PNG หรือ WEBP')
  if (input.kind === 'tor' && input.mimeType !== 'application/pdf') errors.push('เอกสาร TOR ต้องเป็นไฟล์ PDF เท่านั้น')
  return errors
}

export function checksumFor(buffer: ArrayBuffer): string {
  return createHash('sha256').update(Buffer.from(buffer)).digest('hex')
}
