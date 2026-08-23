export const PO_IMAGE_BUCKET = 'lab-stock-po'
export const PO_ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const
export const PO_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024

export function isPoFileTypeAllowed(fileType: string): fileType is (typeof PO_ALLOWED_MIME_TYPES)[number] {
  return (PO_ALLOWED_MIME_TYPES as readonly string[]).includes(fileType)
}

function safeFileName(fileName: string): string {
  return fileName.split(/[\\/]/).pop()?.replace(/^\.+/, '') || 'po-file'
}

function buildNamespacedPoFilePath({
  fiscalYear,
  ownerId,
  fileName,
}: {
  fiscalYear: number
  ownerId: string
  fileName: string
}): string {
  const uniqueId = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  return `po/${fiscalYear}/${ownerId}/${uniqueId}-${safeFileName(fileName)}`
}

/** New PO files are owned by the PR that carries the PO number and audit trail. */
export function buildPurchaseRequestPoFilePath({
  fiscalYear,
  purchaseRequestId,
  fileName,
}: {
  fiscalYear: number
  purchaseRequestId: string
  fileName: string
}): string {
  return buildNamespacedPoFilePath({ fiscalYear, ownerId: purchaseRequestId, fileName })
}

/** Legacy receipt paths remain addressable only so terminal cleanup can remove them safely. */
export function buildLegacyReceiptPoImagePath({
  fiscalYear,
  receiptId,
  fileName,
}: {
  fiscalYear: number
  receiptId: string
  fileName: string
}): string {
  return buildNamespacedPoFilePath({ fiscalYear, ownerId: receiptId, fileName })
}

function isNamespacedPoFilePathAllowed(path: string, fiscalYear: number, ownerId: string): boolean {
  if (!path || path.includes('..')) return false

  const segments = path.split('/')
  if (segments.length !== 4) return false

  const [root, year, folder, fileName] = segments
  return root === 'po' && year === String(fiscalYear) && folder === ownerId && fileName.length > 0
}

export function isPurchaseRequestPoFilePathAllowed(
  path: string,
  fiscalYear: number,
  purchaseRequestId: string,
): boolean {
  return isNamespacedPoFilePathAllowed(path, fiscalYear, purchaseRequestId)
}

export function isLegacyReceiptPoImagePathAllowed(
  path: string,
  fiscalYear: number,
  receiptId: string,
): boolean {
  return isNamespacedPoFilePathAllowed(path, fiscalYear, receiptId)
}
