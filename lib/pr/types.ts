import type { z } from 'zod'
import type { GoodsReceiptStatus } from '@/lib/receipts/schema'
import type {
  PurchaseMethod,
  PurchaseRequestStatus,
  ephisPrNumberSchema,
  purchaseOrderNumberSchema,
  purchaseRequestInputSchema,
  purchaseRequestLineSchema,
  purchaseRequestReversalSchema,
  purchaseRequestShortCloseSchema,
} from './schema'

export type PurchaseRequestInput = z.infer<typeof purchaseRequestInputSchema>
export type PurchaseRequestLineInput = z.infer<typeof purchaseRequestLineSchema>
export type PurchaseOrderNumberInput = z.infer<typeof purchaseOrderNumberSchema>
export type EphisPrNumberInput = z.infer<typeof ephisPrNumberSchema>
export type PurchaseRequestReversalInput = z.infer<typeof purchaseRequestReversalSchema>
export type PurchaseRequestShortCloseInput = z.infer<typeof purchaseRequestShortCloseSchema>

export interface PurchaseRequestPoFileRecord {
  path: string | null
  fileName: string | null
  mimeType: string | null
  sizeBytes: number | null
  checksum: string | null
  uploadedAt: string | null
  uploadedByName: string | null
  deletedAt: string | null
  deletedByName: string | null
  deletionReason: 'received' | 'closed_short' | null
  deletedReceiptId: string | null
}

export interface PurchaseRequestItemRecord {
  id: string
  lineNumber: number
  inventoryItemId: string
  lsCode: string
  name: string
  contractItemId: string | null
  contractDisplayName: string | null
  /** Contracted quantity still unallocated at the moment this is read. */
  contractRemaining: number | null
  /** Rolling three-month issuance captured when the PR was submitted. */
  monthlyUsageSnapshot: number
  /** Item on-hand captured when the PR was submitted. */
  onHandSnapshot: number
  requestedQuantity: number
  /** Quantity already posted into stock across every receipt for this PR line. */
  receivedQuantity: number
  /** Quantity still available to receive; no LOT exists until it is received. */
  remainingQuantity: number
  unit: string
  unitPrice: number
  lineTotal: number
}

export interface PurchaseRequestReceiptRecord {
  id: string
  poNumber: string | null
  receivedDate: string
  status: GoodsReceiptStatus
  postedAt: string | null
  cancellationNote: string | null
  items: PurchaseRequestReceiptItemRecord[]
  totalQuantity: number
}

export interface PurchaseRequestReceiptItemRecord {
  id: string
  lineNumber: number
  inventoryItemId: string
  lsCode: string
  name: string
  lotNumber: string
  expiryDate: string | null
  quantity: number
  unit: string
}

export interface PurchaseRequestRecord {
  id: string
  fiscalYear: number
  sequenceNumber: number
  documentNumber: string
  requesterId: string | null
  requesterName: string | null
  department: string
  headName: string
  requestedDate: string
  purchaseMethod: PurchaseMethod['kind']
  methodDetails: Record<string, unknown>
  status: PurchaseRequestStatus
  poNumber: string | null
  poFile: PurchaseRequestPoFileRecord
  ephisPrNumber: string | null
  /** Set once confirmation opens a contract from this PR (specific_contract/e_bidding). */
  createdContractId: number | null
  acknowledgedBy: string | null
  acknowledgedByName: string | null
  acknowledgedAt: string | null
  reversedBy: string | null
  reversedByName: string | null
  reversedAt: string | null
  reversalReason: string | null
  closedShortBy: string | null
  closedShortByName: string | null
  closedShortAt: string | null
  closedShortReason: string | null
  /** Last mutation actor — only meaningfully distinct from acknowledgedBy/reversedBy while the PR sits completed and its PO number gets edited. */
  updatedByName: string | null
  note: string | null
  createdAt: string
  updatedAt: string | null
  items: PurchaseRequestItemRecord[]
  receiptHistory: PurchaseRequestReceiptRecord[]
  total: number
}
