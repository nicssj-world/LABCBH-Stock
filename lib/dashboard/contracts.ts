import 'server-only'

import { z } from 'zod'
import { CONTRACT_TYPES } from '@/lib/contracts/schema'
import { PROCUREMENT_STAGES } from '@/lib/contracts/stages'
import type { ContractType } from '@/lib/contracts/types'
import type { ProcurementStage } from '@/lib/contracts/stages'
import {
  budgetSnapshot,
  contractMode,
  isExpiring,
  isLowBudget,
  monthsLeft,
} from '@/lib/contracts/budget'
import { effectiveContractStatus } from '@/lib/contracts/presenter'
import { createClient } from '@/lib/supabase/server'

const numeric = z.union([z.number(), z.string()]).transform(Number).pipe(z.number().finite())

const dashboardRowSchema = z.object({
  id: z.union([z.number(), z.string()]).transform(Number).pipe(z.number().int().positive()),
  display_name: z.string().nullable(),
  product: z.string(),
  fiscal_year: z.number().int().nullable(),
  contract_type: z.enum(CONTRACT_TYPES).nullable(),
  procurement_stage: z.enum(PROCUREMENT_STAGES).nullable(),
  status: z.enum(['active', 'expired', 'cancelled', 'pending']).nullable(),
  total: numeric.nullable(),
  start_date: z.string().nullable(),
  end_date: z.string().nullable(),
  contract_items: z.array(z.object({
    id: z.string().uuid(),
    ls_code: z.string(),
    name: z.string(),
    quantity: numeric,
    unit: z.string(),
    unit_price: numeric,
    contract_item_allocations: z.array(z.object({ quantity: numeric })).nullable().default([]),
  })).nullable().default([]),
  contract_usage: z.array(z.object({ amount: numeric })).nullable().default([]),
})

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
  leaseWatchlist: DashboardLeaseWatchItem[]
  contractCount: number
}

export async function getExecutiveDashboard(): Promise<ExecutiveDashboard> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('contracts')
    .select(`
      id,
      display_name,
      product,
      fiscal_year,
      contract_type,
      procurement_stage,
      status,
      total,
      start_date,
      end_date,
      contract_usage (amount),
      contract_items (
        id,
        ls_code,
        name,
        quantity,
        unit,
        unit_price,
        contract_item_allocations (quantity)
      )
    `)
    .or('is_archived.eq.false,is_archived.is.null')

  if (error) throw new Error(`อ่านข้อมูล Dashboard ไม่สำเร็จ: ${error.message}`)
  const rows = dashboardRowSchema.array().parse(data ?? [])

  let totalContractValue = 0
  let remainingContractValue = 0
  let leaseTotal = 0
  let leaseRemaining = 0
  let supplyTotal = 0
  let supplyRemaining = 0
  const watchlist: DashboardWatchItem[] = []
  const leaseWatchlist: DashboardLeaseWatchItem[] = []
  const pipeline = new Map(PROCUREMENT_STAGES.map((stage) => [stage, 0]))
  const typeMix = new Map<ContractType, { count: number; value: number }>()

  for (const contract of rows) {
    const lifecycleStatus = effectiveContractStatus(contract.status, contract.end_date)

    if (contract.procurement_stage) {
      pipeline.set(contract.procurement_stage, (pipeline.get(contract.procurement_stage) ?? 0) + 1)
    }

    let contractValue = 0

    // A lease carries its value on the contract and is drawn down in baht.
    // Reading it from line items, which it never has, reported the entire
    // lease portfolio as worth nothing.
    if (contractMode(contract.contract_type ?? 'e_bidding') === 'budget') {
      const snapshot = budgetSnapshot({
        total: contract.total,
        entries: contract.contract_usage ?? [],
      })
      contractValue = contract.total ?? 0
      totalContractValue += contractValue
      remainingContractValue += snapshot.remaining ?? 0
      leaseTotal += contractValue
      leaseRemaining += snapshot.remaining ?? 0

      const expiring = isExpiring(contract.total, contract.end_date)
      const lowBudget = isLowBudget(contract.total, snapshot.used)
      // A lease past its end date or explicitly cancelled is done, not
      // "expiring" or "low budget" —
      // the register already hides it as สิ้นสุดแล้ว and the dashboard
      // watchlist should agree instead of nagging about a closed contract.

      if ((expiring || lowBudget) && lifecycleStatus === 'active') {
        leaseWatchlist.push({
          contractId: contract.id,
          contractName: contract.display_name?.trim() || contract.product,
          fiscalYear: contract.fiscal_year,
          total: contract.total,
          used: snapshot.used,
          remaining: snapshot.remaining,
          remainingPercent:
            snapshot.percentUsed === null ? null : 100 - snapshot.percentUsed,
          endDate: contract.end_date,
          monthsLeft: monthsLeft(contract.end_date),
          expiring,
          lowBudget,
        })
      }

      if (contract.contract_type) {
        const current = typeMix.get(contract.contract_type) ?? { count: 0, value: 0 }
        typeMix.set(contract.contract_type, {
          count: current.count + 1,
          value: current.value + contractValue,
        })
      }
      continue
    }

    for (const item of contract.contract_items ?? []) {
      const allocatedQuantity = (item.contract_item_allocations ?? [])
        .reduce((sum, allocation) => sum + allocation.quantity, 0)
      const remainingQuantity = Math.max(item.quantity - allocatedQuantity, 0)
      const remainingPercent = item.quantity > 0 ? (remainingQuantity / item.quantity) * 100 : 0
      const lineValue = item.quantity * item.unit_price
      const remainingValue = remainingQuantity * item.unit_price

      contractValue += lineValue
      totalContractValue += lineValue
      remainingContractValue += remainingValue
      supplyTotal += lineValue
      supplyRemaining += remainingValue

      if (remainingPercent < 30 && lifecycleStatus === 'active') {
        watchlist.push({
          contractId: contract.id,
          contractName: contract.display_name?.trim() || contract.product,
          fiscalYear: contract.fiscal_year,
          lsCode: item.ls_code,
          name: item.name,
          unit: item.unit,
          contractedQuantity: item.quantity,
          allocatedQuantity,
          remainingQuantity,
          remainingPercent,
          remainingValue,
        })
      }
    }

    if (contract.contract_type) {
      const current = typeMix.get(contract.contract_type) ?? { count: 0, value: 0 }
      typeMix.set(contract.contract_type, {
        count: current.count + 1,
        value: current.value + contractValue,
      })
    }
  }

  return {
    activeContracts: rows.filter(
      (contract) => effectiveContractStatus(contract.status, contract.end_date) === 'active',
    ).length,
    pendingContracts: rows.filter(
      (contract) => effectiveContractStatus(contract.status, contract.end_date) === 'pending',
    ).length,
    totalContractValue,
    remainingContractValue,
    leaseContractValue: { total: leaseTotal, remaining: leaseRemaining },
    supplyContractValue: { total: supplyTotal, remaining: supplyRemaining },
    pipeline: PROCUREMENT_STAGES.map((stage) => ({ stage, count: pipeline.get(stage) ?? 0 })),
    typeMix: CONTRACT_TYPES
      .filter((type) => typeMix.has(type))
      .map((type) => ({ type, ...typeMix.get(type)! })),
    watchlist: watchlist.sort((left, right) => left.remainingPercent - right.remainingPercent),
    // Soonest to expire first; a contract with no end date sorts last.
    leaseWatchlist: leaseWatchlist.sort((left, right) => left.monthsLeft - right.monthsLeft),
    contractCount: rows.length,
  }
}
