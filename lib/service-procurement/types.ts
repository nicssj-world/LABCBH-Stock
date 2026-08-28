import type {
  ServiceAttachmentKind,
  ServiceCommitteeKind,
  ServiceExpenseFrequency,
  ServiceFulfillmentStatus,
  ServicePlanDocumentKind,
  ServicePlanInput,
  ServicePlanStatus,
  ServicePlanType,
  ServicePoStatus,
  ServicePrStatus,
  ServicePurchaseMethod,
  ServicePurchaseRequestInput,
} from './schema'

export type {
  ServiceAttachmentKind,
  ServiceCommitteeKind,
  ServiceExpenseFrequency,
  ServicePlanDocumentKind,
  ServicePlanStatus,
  ServicePlanType,
  ServicePoStatus,
  ServicePrStatus,
  ServicePurchaseMethod,
  ServiceFulfillmentStatus,
}
export type ServicePlanInputRecord = ServicePlanInput
export type ServicePurchaseRequestInputRecord = ServicePurchaseRequestInput

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

export interface ServicePlanTestItemRecord {
  id: string
  lineNumber: number
  name: string
  unit: string
}

export interface ServicePlanDocumentRecord {
  id: string
  kind: ServicePlanDocumentKind
  fileName: string
  mimeType: string
  sizeBytes: number
  storageKey: string
  checksum: string | null
  uploadedAt: string
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
  reason: string | null
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
  status: ServicePlanStatus
  closedAt: string | null
  isRedCross: boolean
  requiresContract: boolean
  testItems: ServicePlanTestItemRecord[]
  documents: ServicePlanDocumentRecord[]
  responsibles: ServiceResponsibleRecord[]
  createdAt: string
  updatedAt: string
}

export interface ServicePurchaseRequestItemRecord {
  id: string
  lineNumber: number
  planItemId: string
  inventoryItemId: string | null
  lsCode: string | null
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
  invoiceNumber: string | null
  note: string | null
  status: 'active' | 'cancelled'
  referenceEventId: string | null
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
  planId: string
  planName: string | null
  purchaseMethod: ServicePurchaseMethod
  requestedAmount: number
  usageStartDate: string
  usageEndDate: string
  requestedPoMonth: string | null
  status: ServicePrStatus
  poStatus: ServicePoStatus
  ephisPrNumber: string | null
  poNumber: string | null
  poFileName: string | null
  poFilePath: string | null
  fulfillment: ServiceFulfillmentStatus
  actualAmount: number
  expenseFrequency: ServiceExpenseFrequency
  isRedCross: boolean
  requiresContract: boolean
  items: ServicePurchaseRequestItemRecord[]
  usageEvents: ServiceUsageEventRecord[]
  attachments: ServiceAttachmentRecord[]
  planDocuments: ServicePlanDocumentRecord[]
  committees: ServiceCommitteeRecord[]
  poEvents: ServicePoEventRecord[]
  createdAt: string
  updatedAt: string
}
