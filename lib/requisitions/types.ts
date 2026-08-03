import type { z } from 'zod'
import type {
  RequisitionStatus,
  fulfillRequisitionInputSchema,
  requisitionInputSchema,
  requisitionLineInputSchema,
  signRequisitionInputSchema,
} from './schema'

export type RequisitionInput = z.infer<typeof requisitionInputSchema>
export type RequisitionLineInput = z.infer<typeof requisitionLineInputSchema>
export type FulfillRequisitionInput = z.infer<typeof fulfillRequisitionInputSchema>
export type SignRequisitionInput = z.infer<typeof signRequisitionInputSchema>

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
  unit: string
  note: string | null
  allocations: RequisitionLotAllocationRecord[]
}

export interface RequisitionRecord {
  id: string
  fiscalYear: number
  sequenceNumber: number
  documentNumber: string
  requesterName: string
  department: string
  desiredDate: string
  status: RequisitionStatus
  note: string | null
  fulfilledAt: string | null
  fulfilledByName: string | null
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
