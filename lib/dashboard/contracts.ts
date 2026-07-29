import 'server-only'

import { z } from 'zod'
import { CONTRACT_TYPES } from '@/lib/contracts/schema'
import { PROCUREMENT_STAGES } from '@/lib/contracts/stages'
import type { ContractType } from '@/lib/contracts/types'
import type { ProcurementStage } from '@/lib/contracts/stages'
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
  contract_items: z.array(z.object({
    id: z.string().uuid(),
    ls_code: z.string(),
    name: z.string(),
    quantity: numeric,
    unit: z.string(),
    unit_price: numeric,
    contract_item_allocations: z.array(z.object({ quantity: numeric })).nullable().default([]),
  })).nullable().default([]),
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

export interface ExecutiveDashboard {
  activeContracts: number
  pendingContracts: number
  totalContractValue: number
  remainingContractValue: number
  pipeline: Array<{ stage: ProcurementStage; count: number }>
  typeMix: Array<{ type: ContractType; count: number; value: number }>
  watchlist: DashboardWatchItem[]
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
  const watchlist: DashboardWatchItem[] = []
  const pipeline = new Map(PROCUREMENT_STAGES.map((stage) => [stage, 0]))
  const typeMix = new Map<ContractType, { count: number; value: number }>()

  for (const contract of rows) {
    if (contract.procurement_stage) {
      pipeline.set(contract.procurement_stage, (pipeline.get(contract.procurement_stage) ?? 0) + 1)
    }

    let contractValue = 0
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

      if (remainingPercent < 30) {
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
    activeContracts: rows.filter((contract) => contract.status === 'active').length,
    pendingContracts: rows.filter((contract) => contract.status === 'pending').length,
    totalContractValue,
    remainingContractValue,
    pipeline: PROCUREMENT_STAGES.map((stage) => ({ stage, count: pipeline.get(stage) ?? 0 })),
    typeMix: CONTRACT_TYPES
      .filter((type) => typeMix.has(type))
      .map((type) => ({ type, ...typeMix.get(type)! })),
    watchlist: watchlist.sort((left, right) => left.remainingPercent - right.remainingPercent),
    contractCount: rows.length,
  }
}
