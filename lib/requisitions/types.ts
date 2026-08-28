import type { z } from 'zod'
import type {
  RequisitionStatus,
  fulfillRequisitionInputSchema,
  drawnSignatureInputSchema,
  requisitionInputSchema,
  requisitionLineInputSchema,
} from './schema'

export type RequisitionInput = z.infer<typeof requisitionInputSchema>
export type RequisitionLineInput = z.infer<typeof requisitionLineInputSchema>
export type FulfillRequisitionInput = z.infer<typeof fulfillRequisitionInputSchema>
export type DrawnSignatureInput = z.infer<typeof drawnSignatureInputSchema>

export interface RequisitionLotAllocationRecord {
  id: string
  inventoryLotId: string
  lotNumber: string
  expiryDate: string | null
  quantity: number
  isFifoOverride: boolean
  overrideReason: string | null
}

export interface RequisitionItemRecord {
  id: string
  lineNumber: number
  inventoryItemId: string
  lsCode: string
  name: string
  requestedQuantity: number
  fulfilledQuantity: number | null
  shortIssueReason: string | null
  unit: string
  note: string | null
  allocations: RequisitionLotAllocationRecord[]
}

export interface RequisitionRecord {
  id: string
  fiscalYear: number
  sequenceNumber: number
  documentNumber: string
  /** The profile that created the requisition — the owner for edit/cancel. */
  requesterId: string | null
  requesterName: string
  department: string
  desiredDate: string
  status: RequisitionStatus
  note: string | null
  fulfilledAt: string | null
  fulfilledBy: string | null
  fulfilledByName: string | null
  receivedBy: string | null
  receivedByName: string | null
  signature: string | null
  signedAt: string | null
  createdAt: string
  items: RequisitionItemRecord[]
}

export interface SelectableLot {
  id: string
  lotNumber: string
  expiryDate: string | null
  receivedAt: string
  balance: number
  storageLocation: string | null
  selectable: boolean
}
