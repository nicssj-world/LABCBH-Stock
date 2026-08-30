import type { ProcurementStage } from '@/lib/contracts/stages'
import type { ContractType } from '@/lib/contracts/types'
import type { ServiceProcurementDashboardSummary } from '@/lib/service-procurement/types'

export interface DashboardWatchItem {
  contractId: number
  contractName: string
  fiscalYear: number | null
  lsCode: string
  name: string
  unit: string
  contractedQuantity: number
  allocatedQuantity: number
  remainingQuantity: number
  remainingPercent: number
  remainingValue: number
}

/** A lease is watched by money and by time, never by stock level. */
export interface DashboardLeaseWatchItem {
  contractId: number
  contractName: string
  fiscalYear: number | null
  total: number | null
  used: number
  remaining: number | null
  remainingPercent: number | null
  endDate: string | null
  monthsLeft: number
  expiring: boolean
  lowBudget: boolean
}

export interface ContractValueScope {
  total: number
  remaining: number
}

export interface DashboardWatchlistPage {
  items: DashboardWatchItem[]
  totalCount: number
  offset: number
  limit: number
  nextOffset: number | null
}

export interface ExecutiveDashboard {
  activeContracts: number
  pendingContracts: number
  totalContractValue: number
  remainingContractValue: number
  // Same totals split by contractMode(), so the dashboard can offer a
  // "รวม / เช่า / อื่นๆ" scope without a second read.
  leaseContractValue: ContractValueScope
  supplyContractValue: ContractValueScope
  pipeline: Array<{ stage: ProcurementStage; count: number }>
  typeMix: Array<{ type: ContractType; count: number; value: number }>
  watchlist: DashboardWatchItem[]
  watchlistTotal: number
  watchlistOffset: number
  watchlistLimit: number
  watchlistNextOffset: number | null
  leaseWatchlist: DashboardLeaseWatchItem[]
  contractCount: number
  serviceProcurement: ServiceProcurementDashboardSummary
}
