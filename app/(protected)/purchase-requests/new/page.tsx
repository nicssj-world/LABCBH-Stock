import Link from 'next/link'
import { redirect } from 'next/navigation'
import {
  PurchaseRequestForm,
  type CatalogOption,
  type ContractLineOption,
} from '@/components/pr/PurchaseRequestForm'
import { requireActor } from '@/lib/auth/actor'
import { effectiveContractStatus } from '@/lib/contracts/presenter'
import { listContracts } from '@/lib/contracts/queries'
import { listInventoryItems } from '@/lib/inventory/queries'
import { normalizeLsCode } from '@/lib/inventory/ls-code'
import { DEPARTMENTS } from '@/lib/organization/departments'
import { canRequestPurchase } from '@/lib/pr/authorization'
import { listContractItemOptions, listNextContractPurchaseSequences } from '@/lib/pr/queries'

export default async function NewPurchaseRequestPage() {
  const actor = await requireActor()
  if (!canRequestPurchase(actor)) redirect('/purchase-requests')

  const [inventoryItems, contractItems, allContracts] = await Promise.all([
    listInventoryItems({}),
    listContractItemOptions(),
    listContracts({}),
  ])

  // "ซื้อในสัญญา" only orders against a contract that has already started,
  // is not an equipment lease (which has no line items to draw down), and has
  // not already ended.
  const startedContracts = allContracts.filter(
    (contract) =>
      contract.procurementStage === 'contract_started' &&
      contract.contractType !== 'equipment_lease' &&
      effectiveContractStatus(contract.status, contract.endDate) !== 'expired',
  )
  // "ซื้อเจาะจงระหว่างรอสัญญา" references a contract still working through the
  // procurement stages — it exists to identify which arrangement is being
  // waited on, and never draws down a balance.
  const awaitingContracts = allContracts.filter(
    (contract) => contract.procurementStage !== 'contract_started',
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

  const catalog: CatalogOption[] = inventoryItems.map((item) => ({
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

  // Contract lines carry their own LS code; matching to the catalogue is what
  // lets the picker show live on-hand next to contracted balance.
  const contractLines: ContractLineOption[] = contractItems.flatMap((option) => {
    const inventoryItem = inventoryByLsCode.get(normalizeLsCode(option.lsCode))
    if (!inventoryItem) return []

    return [{
      inventoryItemId: inventoryItem.id,
      contractItemId: option.id,
      contractId: option.contractId,
      contractRemaining: option.remainingQuantity,
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

  return (
    <div className="route-stack">
      <header className="page-heading">
        <div>
          <Link className="back-link" href="/purchase-requests">← ใบขอซื้อ</Link>
          <p className="section-kicker">NEW REQUEST</p>
          <h1>สร้างใบขอซื้อ</h1>
          <p>ข้อมูลคลัง สัญญา ราคา และการใช้งานย้อนหลังถูกดึงมาให้แล้ว ไม่ต้องพิมพ์ซ้ำ</p>
        </div>
      </header>

      <PurchaseRequestForm
        department={DEPARTMENTS[0]}
        departments={DEPARTMENTS}
        headName={actor.name ?? ''}
        contracts={contracts.map((contract) => ({
          ...contract,
          nextPurchaseSequence: nextPurchaseSequenceByContract[contract.id] ?? 1,
        }))}
        awaitingContracts={awaitingContracts.map((contract) => ({
          id: contract.id,
          department: contract.department ?? '',
          label: `${contract.displayName?.trim() || contract.product}${
            contract.contractNumber ? ` · ${contract.contractNumber}` : ''
          }`,
        }))}
        contractLines={contractLines}
        catalog={catalog}
      />
    </div>
  )
}
