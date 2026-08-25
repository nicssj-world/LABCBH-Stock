import { effectiveContractStatus } from '@/lib/contracts/presenter'
import { listContractFormOptions } from '@/lib/contracts/queries'
import { listInventoryItems } from '@/lib/inventory/queries'
import { normalizeLsCode } from '@/lib/inventory/ls-code'
import { listContractItemOptions, listNextContractPurchaseSequences } from '@/lib/pr/queries'
import { supabaseAdmin } from '@/lib/supabase/admin'

export interface PurchaseRequestCommitteeCandidate {
  id: string
  name: string
  namePrefix?: string | null
  ephisId: string | null
  positionTitle: string | null
}

export interface PurchaseRequestFormOptions {
  contracts: Array<{
    id: number
    department: string
    label: string
    nextPurchaseSequence: number
    fileUrl: string | null
    committeeRosterReady: boolean
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
  committeeCandidates: PurchaseRequestCommitteeCandidate[]
}

/**
 * The create and edit screens must offer the same live catalogue and contract
 * choices. Keeping the loader here also prevents an edit screen from drifting
 * away from the safeguards on the new-PR screen.
 */
export async function loadPurchaseRequestFormOptions(excludePurchaseRequestId?: string): Promise<PurchaseRequestFormOptions> {
  const [inventoryItems, allContracts, profileResult] = await Promise.all([
    listInventoryItems({}, { includeAlertScope: false }),
    listContractFormOptions(),
    supabaseAdmin
      .from('profiles')
      .select('id, name, name_prefix, ephis_id, position_title')
      .eq('status', 'active')
      .is('deleted_at', null)
      .not('name', 'is', null)
      .order('name'),
  ])
  if (profileResult.error) throw new Error(`อ่านรายชื่อบุคลากรไม่สำเร็จ: ${profileResult.error.message}`)

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
    contractType: contract.contractType,
    department: contract.department ?? '',
    fileUrl: contract.fileUrl,
    label: `${contract.displayName?.trim() || contract.product}${
      contract.contractNumber ? ` · ${contract.contractNumber}` : ''
    }`,
  }))
  const contractIds = contracts.map((contract) => contract.id)
  const [contractItems, committeeResult, nextPurchaseSequenceByContract] = await Promise.all([
    listContractItemOptions(undefined, excludePurchaseRequestId, contractIds),
    contracts.length === 0
      ? Promise.resolve({ data: [], error: null })
      : supabaseAdmin
          .from('contract_committees')
          .select('contract_id, committee_kind, seat')
          .in('contract_id', contractIds),
    listNextContractPurchaseSequences(contractIds),
  ])
  if (committeeResult.error) throw new Error(`อ่านรายชื่อกรรมการสัญญาไม่สำเร็จ: ${committeeResult.error.message}`)
  const committeesByContract = new Map<number, Array<{ committee_kind: string; seat: number }>>()
  for (const row of committeeResult.data ?? []) {
    const rows = committeesByContract.get(Number(row.contract_id)) ?? []
    rows.push({ committee_kind: row.committee_kind, seat: Number(row.seat) })
    committeesByContract.set(Number(row.contract_id), rows)
  }
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
      id: contract.id,
      department: contract.department,
      label: contract.label,
      nextPurchaseSequence: nextPurchaseSequenceByContract[contract.id] ?? 1,
      fileUrl: contract.fileUrl,
      committeeRosterReady: (() => {
        const roster = committeesByContract.get(contract.id) ?? []
        const count = (kind: string) => roster.filter((row) => row.committee_kind === kind).length
        const expectedResultCount = ['e_bidding', 'equipment_lease'].includes(contract.contractType ?? '') ? 3 : 0
        return count('specification') === 3 && count('inspection') === 3 && count('result') === expectedResultCount
      })(),
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
    committeeCandidates: (profileResult.data ?? []).map((profile) => ({
      id: profile.id,
      name: profile.name?.trim() || profile.ephis_id || profile.id,
      namePrefix: profile.name?.trim() ? profile.name_prefix?.trim() || null : null,
      ephisId: profile.ephis_id ?? null,
      positionTitle: profile.position_title?.trim() || null,
    })),
  }
}
