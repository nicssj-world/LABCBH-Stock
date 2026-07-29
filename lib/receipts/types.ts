import type { z } from 'zod'
import type {
  GoodsReceiptStatus,
  goodsReceiptImageSchema,
  goodsReceiptInputSchema,
  receiptLineInputSchema,
} from './schema'

export type GoodsReceiptInput = z.infer<typeof goodsReceiptInputSchema>
export type ReceiptLineInput = z.infer<typeof receiptLineInputSchema>
export type GoodsReceiptImageInput = z.infer<typeof goodsReceiptImageSchema>

export interface GoodsReceiptItemRecord {
  id: string
  lineNumber: number
  inventoryItemId: string
  lsCode: string
  name: string
  lotNumber: string
  expiryDate: string | null
  quantity: number
  unit: string
  storageLocation: string | null
  inventoryLotId: string | null
}

export interface GoodsReceiptRecord {
  id: string
  fiscalYear: number
  purchaseRequestId: string | null
  purchaseRequestNumber: string | null
  poNumber: string | null
  department: string
  receivedDate: string
  receiverName: string
  poImagePath: string | null
  status: GoodsReceiptStatus
  note: string | null
  postedAt: string | null
  postedByName: string | null
  createdAt: string
  items: GoodsReceiptItemRecord[]
  totalQuantity: number
}
