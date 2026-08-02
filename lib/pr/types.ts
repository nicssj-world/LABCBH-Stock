import type { z } from 'zod'
import type {
  PurchaseMethod,
  PurchaseRequestStatus,
  purchaseOrderNumberSchema,
  purchaseRequestInputSchema,
  purchaseRequestLineSchema,
  purchaseRequestReversalSchema,
} from './schema'

export type PurchaseRequestInput = z.infer<typeof purchaseRequestInputSchema>
export type PurchaseRequestLineInput = z.infer<typeof purchaseRequestLineSchema>
export type PurchaseOrderNumberInput = z.infer<typeof purchaseOrderNumberSchema>
export type PurchaseRequestReversalInput = z.infer<typeof purchaseRequestReversalSchema>

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
  unit: string
  unitPrice: number
  lineTotal: number
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
  /** Set once confirmation opens a contract from this PR (specific_contract/e_bidding). */
  createdContractId: number | null
  acknowledgedBy: string | null
  acknowledgedByName: string | null
  acknowledgedAt: string | null
  note: string | null
  createdAt: string
  updatedAt: string | null
  items: PurchaseRequestItemRecord[]
  total: number
}
