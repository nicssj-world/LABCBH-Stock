import type { ContractDurationYears, ContractStatus } from '@/lib/contracts/types'

export type ExecutiveSpendCategory = 'purchase' | 'service' | 'lease'

export interface ExecutiveSpendTotals {
  purchase: number
  service: number
  lease: number
  hiringTotal: number
  total: number
}

export interface ExecutiveComparison {
  current: number
  previous: number
  changeAmount: number
  changePercent: number | null
  trend: 'up' | 'down' | 'flat' | 'no-baseline'
}

export interface ExecutiveMonthlySpend {
  month: string
  label: string
  purchase: number
  service: number
  lease: number
  hiringTotal: number
  total: number
}

export interface ExecutiveCategorySummary {
  key: 'purchase' | 'hiring' | 'lease'
  label: string
  amount: number
  count: number
  share: number | null
  note: string
}

export interface LeaseDurationSummary {
  durationYears: ContractDurationYears | null
  label: string
  contractCount: number
  expense: number
  share: number | null
}

export interface LeaseContractSummary {
  contractId: number
  contractNumber: string | null
  contractName: string
  durationYears: ContractDurationYears | null
  startDate: string | null
  endDate: string | null
  fiscalYearExpense: number
  status: ContractStatus | null
  department: string | null
}

export interface ExecutiveAlert {
  key: string
  tone: 'attention' | 'danger' | 'neutral'
  label: string
  detail: string
  href: string | null
}

export interface ExecutiveDataQuality {
  unclassifiedReceiptCount: number
  unclassifiedReceiptAmount: number
  missingReceiptPriceCount: number
  missingReceiptPriceAmount: number
  missingUsageMonthCount: number
  missingUsageMonthAmount: number
  missingLeaseDurationCount: number
  missingLeaseDateCount: number
}

export interface ExecutivePurchaseSourceRow {
  receiptId: string
  receivedDate: string
  purchaseRequestId: string | null
  itemName: string | null
  quantity: number
  unitPrice: number | null
  amount: number
  contractId: number | null
  contractName: string | null
}

export interface ExecutiveServiceSourceRow {
  planId: string
  planName: string
  department: string
  eventDate: string
  entryKind: string
  amount: number
  purchaseRequestId: string | null
  sourceReference: string | null
}

export interface ExecutiveLeaseSourceRow {
  contractId: number
  contractName: string
  usageMonth: string
  amount: number
}

export interface ExecutiveOverview {
  fiscalYear: number
  fiscalYearRange: { start: string; end: string }
  generatedOn: string
  spend: ExecutiveSpendTotals
  priorYearSpend: ExecutiveSpendTotals
  comparison: ExecutiveComparison
  monthly: ExecutiveMonthlySpend[]
  categories: ExecutiveCategorySummary[]
  leaseDurationSummary: LeaseDurationSummary[]
  leaseContracts: LeaseContractSummary[]
  alerts: ExecutiveAlert[]
  dataQuality: ExecutiveDataQuality
  purchaseSourceRows: ExecutivePurchaseSourceRow[]
  serviceSourceRows: ExecutiveServiceSourceRow[]
  leaseSourceRows: ExecutiveLeaseSourceRow[]
}
