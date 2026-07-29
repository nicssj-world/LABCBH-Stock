export const PO_IMAGE_BUCKET = 'lab-stock-po'

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
  return `po/${fiscalYear}/${receiptId}/${safeName}`
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
