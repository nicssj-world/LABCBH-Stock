export const PR_CHECKLIST_STORAGE_PREFIX = 'labcbh-stock/pr-checklists/uploads/'

const UUID_SEGMENT = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
const PR_CHECKLIST_STORAGE_KEY_PATTERN = new RegExp(
  `^${PR_CHECKLIST_STORAGE_PREFIX}${UUID_SEGMENT}/${UUID_SEGMENT}/[0-9a-f-]+-[^/]+$`,
  'i',
)

function safeStorageName(fileName: string) {
  const leaf = fileName.split(/[\\/]/).pop()?.trim() || 'attachment'
  return leaf
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}._ -]/gu, '_')
    .replace(/\.{2,}/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 160)
}

export function buildPurchaseRequestChecklistUploadKey(input: {
  actorId: string
  sessionId: string
  fileName: string
}) {
  return `${PR_CHECKLIST_STORAGE_PREFIX}${input.actorId}/${input.sessionId}/${crypto.randomUUID()}-${safeStorageName(input.fileName)}`
}

export function isPurchaseRequestChecklistStorageKey(key: string) {
  return !key.includes('..') && PR_CHECKLIST_STORAGE_KEY_PATTERN.test(key)
}

export function validatePurchaseRequestChecklistObject(
  expected: { sizeBytes: number; mimeType: string },
  object: { contentLength?: number | null; contentType?: string | null },
): string[] {
  const errors: string[] = []
  if (object.contentLength !== expected.sizeBytes) {
    errors.push('ขนาดไฟล์ใน R2 ไม่ตรงกับไฟล์ที่ลงทะเบียน')
  }
  const contentType = object.contentType?.trim().toLowerCase()
  if (!contentType || contentType !== expected.mimeType.trim().toLowerCase()) {
    errors.push('ชนิดไฟล์ใน R2 ไม่ตรงกับไฟล์ที่ลงทะเบียน')
  }
  return errors
}
