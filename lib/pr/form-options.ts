import { effectiveContractStatus } from '@/lib/contracts/presenter'
import { listContracts } from '@/lib/contracts/queries'
import { listInventoryItems } from '@/lib/inventory/queries'
import { normalizeLsCode } from '@/lib/inventory/ls-code'
import { listContractItemOptions, listNextContractPurchaseSequences } from '@/lib/pr/queries'

export interface PurchaseRequestFormOptions {
  contracts: Array<{
    id: number
    department: string
    label: string
    nextPurchaseSequence: number
  }>
  awaitingContracts: Array<{
    id: number
    department: string
    label: string
  }>
  contractLines: Array<{
    inventoryItemId: string
    contractItemId: string
    contractId: number
    contractRemaining: number
    contractedQuantity: number
    lsCode: string
    name: string
    unit: string
    defaultUnitPrice: number
    onHand: number
    averageMonthlyUsage: number
    belowMinimum: boolean
  }>
  catalog: Array<{
    inventoryItemId: string
    lsCode: string
    name: string
    unit: string
    defaultUnitPrice: number
    onHand: number
    averageMonthlyUsage: number
    belowMinimum: boolean
  }>
}

/**
 * The create and edit screens must offer the same live catalogue and contract
 * choices. Keeping the loader here also prevents an edit screen from drifting
 * away from the safeguards on the new-PR screen.
 */
export async function loadPurchaseRequestFormOptions(): Promise<PurchaseRequestFormOptions> {
  const [inventoryItems, contractItems, allContracts] = await Promise.all([
    listInventoryItems({}),
    listContractItemOptions(),
    listContracts({}),
  ])

  const startedContracts = allContracts.filter(
    (contract) =>
      contract.procurementStage === 'contract_started' &&
      contract.contractType !== 'equipment_lease' &&
      effectiveContractStatus(contract.status, contract.endDate) === 'active',
  )
  const awaitingContracts = allContracts.filter(
    (contract) =>
      contract.procurementStage !== 'contract_started' &&
      effectiveContractStatus(contract.status, contract.endDate) === 'pending',
  )

  const contracts = startedContracts.map((contract) => ({
    id: contract.id,
    department: contract.department ?? '',
    label: `${contract.displayName?.trim() || contract.product}${
      contract.contractNumber ? ` · ${contract.contractNumber}` : ''
    }`,
  }))
  const nextPurchaseSequenceByContract = await listNextContractPurchaseSequences(contracts.map((contract) => contract.id))

  const inventoryByLsCode = new Map(inventoryItems.map((item) => [normalizeLsCode(item.lsCode), item]))

  const catalog = inventoryItems.map((item) => ({
    inventoryItemId: item.id,
    lsCode: item.lsCode,
    name: item.name,
    unit: item.baseUnit,
    defaultUnitPrice: item.defaultUnitPrice ?? 0,
    onHand: item.onHand,
    averageMonthlyUsage:
      item.monthlyIssues.reduce((sum, value) => sum + value, 0) /
      Math.max(item.monthlyIssues.length, 1),
    belowMinimum: item.stockLevel !== 'healthy',
  }))

  const contractLines = contractItems.flatMap((option) => {
    const inventoryItem = inventoryByLsCode.get(normalizeLsCode(option.lsCode))
    if (!inventoryItem) return []

    return [{
      inventoryItemId: inventoryItem.id,
      contractItemId: option.id,
      contractId: option.contractId,
      contractRemaining: option.remainingQuantity,
      contractedQuantity: option.contractedQuantity,
      lsCode: option.lsCode,
      name: option.name,
      unit: option.unit,
      defaultUnitPrice: option.unitPrice,
      onHand: inventoryItem.onHand,
      averageMonthlyUsage:
        inventoryItem.monthlyIssues.reduce((sum, value) => sum + value, 0) /
        Math.max(inventoryItem.monthlyIssues.length, 1),
      belowMinimum: inventoryItem.stockLevel !== 'healthy',
    }]
  })

  return {
    contracts: contracts.map((contract) => ({
      ...contract,
      nextPurchaseSequence: nextPurchaseSequenceByContract[contract.id] ?? 1,
    })),
    awaitingContracts: awaitingContracts.map((contract) => ({
      id: contract.id,
      department: contract.department ?? '',
      label: `${contract.displayName?.trim() || contract.product}${
        contract.contractNumber ? ` · ${contract.contractNumber}` : ''
      }`,
    })),
    contractLines,
    catalog,
  }
}
