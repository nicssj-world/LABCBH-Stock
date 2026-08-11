import { z } from 'zod'
import { roundQuantity } from '@/lib/inventory/balance'
import { isoDateSchema } from '@/lib/validation/date'

export const GOODS_RECEIPT_STATUSES = ['draft', 'posted', 'cancelled'] as const
export type GoodsReceiptStatus = (typeof GOODS_RECEIPT_STATUSES)[number]

export const receiptLineInputSchema = z
  .object({
    inventoryItemId: z.string().uuid(),
    lotNumber: z.string().trim().min(1, 'กรุณาระบุเลขที่ล็อต'),
    expiryDate: isoDateSchema.nullable(),
    quantity: z.number().finite().positive('จำนวนที่รับเข้าต้องมากกว่า 0'),
    unit: z.string().trim().min(1, 'กรุณาระบุหน่วย'),
    storageLocation: z.string().trim().max(200).nullable(),
  })
  .strict()

export const goodsReceiptInputSchema = z
  .object({
    purchaseRequestId: z.string().uuid().nullable(),
    poNumber: z.string().trim().max(100).nullable(),
    department: z.string().trim().min(1, 'กรุณาระบุหน่วยงานที่รับของ'),
    receivedDate: isoDateSchema,
    receiverName: z.string().trim().min(1, 'กรุณาระบุชื่อผู้รับของ'),
    note: z.string().trim().max(1000).nullable(),
    items: z.array(receiptLineInputSchema).min(1, 'ต้องมีรายการรับเข้าอย่างน้อย 1 รายการ'),
  })
  .strict()
  .superRefine((value, context) => {
    const duplicates = detectDuplicateLots(value.items)
    if (duplicates.length > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['items'],
        message: 'มีล็อตซ้ำกันภายในใบรับเดียวกัน กรุณารวมเป็นบรรทัดเดียว',
      })
    }
  })

export const goodsReceiptImageSchema = z
  .object({ poImagePath: z.string().trim().min(1) })
  .strict()

/**
 * Lot numbers are written by hand from a label, so `L1`, `l1`, and `l1 ` are the
 * same lot. Returns the duplicated `item::lot` keys.
 */
export function detectDuplicateLots(
  lines: Array<{ inventoryItemId: string; lotNumber: string }>,
): string[] {
  const seen = new Set<string>()
  const duplicates = new Set<string>()

  for (const line of lines) {
    const key = `${line.inventoryItemId}::${line.lotNumber.trim().toUpperCase()}`
    if (seen.has(key)) duplicates.add(key)
    seen.add(key)
  }

  return [...duplicates]
}

/**
 * A reagent can arrive split across several lots — several draft lines share
 * one inventoryItemId. Sums across all of them before comparing against what
 * the PR actually requested, so splitting into lots cannot hide an overage.
 */
export function findOverRequestedItems(
  lines: Array<{ inventoryItemId: string; quantity: number }>,
  requestedByItem: Record<string, number>,
  enforceRequestedItems = false,
): string[] {
  const totals = new Map<string, number>()
  for (const line of lines) {
    totals.set(line.inventoryItemId, (totals.get(line.inventoryItemId) ?? 0) + line.quantity)
  }

  return [...totals.entries()]
    .filter(([itemId, total]) =>
      (enforceRequestedItems && !(itemId in requestedByItem)) ||
      (itemId in requestedByItem && total > requestedByItem[itemId]),
    )
    .map(([itemId]) => itemId)
}

export function summarizeReceiptLines(
  lines: Array<{ quantity: number }>,
): { lineCount: number; totalQuantity: number } {
  return {
    lineCount: lines.length,
    totalQuantity: roundQuantity(lines.reduce((sum, line) => sum + line.quantity, 0)),
  }
}
