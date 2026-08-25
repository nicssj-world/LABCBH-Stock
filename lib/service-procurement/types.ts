import type {
  ServiceAttachmentKind,
  ServiceCommitteeKind,
  ServiceFulfillmentStatus,
  ServicePlanInput,
  ServicePlanType,
  ServicePoStatus,
  ServicePrStatus,
  ServicePurchaseMethod,
  ServicePurchaseRequestInput,
  ServiceUsageInput,
} from './schema'

export type { ServiceAttachmentKind, ServiceCommitteeKind, ServicePlanType, ServicePoStatus, ServicePrStatus, ServicePurchaseMethod, ServiceFulfillmentStatus }
export type ServicePlanInputRecord = ServicePlanInput
export type ServicePurchaseRequestInputRecord = ServicePurchaseRequestInput
export type ServiceUsageInputRecord = ServiceUsageInput

export interface ServicePlanBalance {
  budget: number
  spent: number
  reserved: number
  available: number
}

export interface ServiceResponsibleRecord {
  profileId: string
  name: string
  department: string | null
  assignedAt: string
}

export interface ServicePlanLedgerRecord {
  id: string
  planId: string
  entryKind: 'reservation' | 'reservation_release' | 'expense' | 'historical_expense' | 'expense_adjustment' | 'expense_reversal'
  amount: number
  eventDate: string
  purchaseRequestId: string | null
  usageEventId: string | null
  referenceLedgerId: string | null
  reason: string
  sourceReference: string | null
  actorName: string | null
  createdAt: string
}

export interface ServicePlanRecord {
  id: string
  fiscalYear: number
  name: string
  department: string
  type: ServicePlanType
  budget: number
  balance: ServicePlanBalance
  responsibles: ServiceResponsibleRecord[]
  createdAt: string
  updatedAt: string
}

export interface ServicePurchaseRequestItemRecord {
  id: string
  lineNumber: number
  inventoryItemId: string
  lsCode: string
  name: string
  unit: string
  requestedQuantity: number
  unitPrice: number
  lineTotal: number
  usedQuantity: number
  remainingQuantity: number
}

export interface ServiceUsageEventRecord {
  id: string
  kind: 'annual_usage' | 'lab_expense' | 'expense_adjustment' | 'expense_reversal'
  expenseDate: string
  amount: number
  note: string | null
  actorName: string | null
  createdAt: string
}

export interface ServiceAttachmentRecord {
  id: string
  kind: ServiceAttachmentKind
  slot: number
  fileName: string
  mimeType: string
  sizeBytes: number
  storageKey: string
  uploadedAt: string
}

export interface ServiceCommitteeRecord {
  id: string
  kind: ServiceCommitteeKind
  seat: number
  profileId: string
  name: string
  position: string | null
}

export interface ServicePoEventRecord {
  id: string
  kind: 'number_added' | 'file_added' | 'closed' | 'cancelled'
  poNumber: string | null
  poFilePath: string | null
  reason: string | null
  actorName: string | null
  createdAt: string
}

export interface ServicePurchaseRequestRecord {
  id: string
  fiscalYear: number
  sequenceNumber: number
  documentNumber: string
  requesterId: string | null
  requesterName: string
  department: string
  requestedDate: string
  note: string | null
  planId: string | null
  planName: string | null
  purchaseMethod: ServicePurchaseMethod
  requestedAmount: number
  requestedPoMonth: string | null
  status: ServicePrStatus
  poStatus: ServicePoStatus
  ephisPrNumber: string | null
  poNumber: string | null
  poFileName: string | null
  poFilePath: string | null
  fulfillment: ServiceFulfillmentStatus
  actualAmount: number
  items: ServicePurchaseRequestItemRecord[]
  usageEvents: ServiceUsageEventRecord[]
  attachments: ServiceAttachmentRecord[]
  committees: ServiceCommitteeRecord[]
  poEvents: ServicePoEventRecord[]
  createdAt: string
  updatedAt: string
}
