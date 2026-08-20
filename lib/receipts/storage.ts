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

/**
 * PO images live at `po/<fiscal-year>/<receipt-id>/<file>`. The folder is part
 * of the storage policy, so the path is derived here rather than accepted from
 * the browser, and any traversal segment is dropped instead of honoured.
 */
export function buildPoImagePath({
  fiscalYear,
  receiptId,
  fileName,
}: {
  fiscalYear: number
  receiptId: string
  fileName: string
}): string {
  const safeName = fileName.split(/[\\/]/).pop()?.replace(/^\.+/, '') || 'po-image'
  // Each upload gets a new object. The database pointer is updated only after
  // the upload succeeds, so a failed pointer update can remove this new object
  // without risking the previous PO evidence.
  const uniqueId = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  return `po/${fiscalYear}/${receiptId}/${uniqueId}-${safeName}`
}

export function isPoImagePathAllowed(
  path: string,
  fiscalYear: number,
  receiptId: string,
): boolean {
  if (!path) return false
  if (path.includes('..')) return false

  const segments = path.split('/')
  if (segments.length !== 4) return false

  const [root, year, folder, fileName] = segments
  return root === 'po' && year === String(fiscalYear) && folder === receiptId && fileName.length > 0
}
