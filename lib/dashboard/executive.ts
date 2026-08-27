import { z } from 'zod'
import { CONTRACT_TYPES } from '@/lib/contracts/schema'
import type {
  ContractDurationYears,
  ContractStatus,
  ContractType,
} from '@/lib/contracts/types'
import {
  budgetSnapshot,
  isExpiring,
  isLowBudget,
  normalizeUsageMonth,
} from '@/lib/contracts/budget'
import {
  CONTRACT_STATUS_LABELS,
  effectiveContractStatus,
} from '@/lib/contracts/presenter'
import { fiscalYearFromDate, fiscalYearRange, isDateInFiscalYear } from '@/lib/service-procurement/domain'
import { bangkokIsoDate } from '@/lib/date/thai'
import { createClient } from '@/lib/supabase/server'
import type {
  ExecutiveAlert,
  ExecutiveCategorySummary,
  ExecutiveComparison,
  ExecutiveDataQuality,
  ExecutiveLeaseSourceRow,
  ExecutiveMonthlySpend,
  ExecutiveOverview,
  ExecutivePurchaseSourceRow,
  ExecutiveServiceSourceRow,
  ExecutiveSpendTotals,
  LeaseContractSummary,
  LeaseDurationSummary,
} from './executive-types'

const numericSchema = z
  .union([z.number(), z.string()])
  .transform(Number)
  .refine(Number.isFinite)

const contractUsageRowSchema = z.object({
  amount: numericSchema,
  usage_month: z.string().nullable(),
})

const contractRowSchema = z.object({
  id: numericSchema.pipe(z.number().int().positive()),
  display_name: z.string().nullable(),
  product: z.string(),
  fiscal_year: numericSchema.pipe(z.number().int()).nullable(),
  contract_type: z.enum(CONTRACT_TYPES).nullable(),
  contract_number: z.string().nullable(),
  contract_duration_years: z.union([z.literal(1), z.literal(3)]).nullable(),
  status: z.enum(['active', 'expired', 'cancelled', 'pending']).nullable(),
  total: numericSchema.nullable(),
  start_date: z.string().nullable(),
  end_date: z.string().nullable(),
  department: z.string().nullable(),
  contract_usage: z.array(contractUsageRowSchema).nullable().default([]),
})

const receiptItemRowSchema = z.object({
  inventory_item_id: z.string(),
  quantity: numericSchema,
})

const receiptRowSchema = z.object({
  id: z.string(),
  fiscal_year: numericSchema.pipe(z.number().int()),
  purchase_request_id: z.string().nullable(),
  received_date: z.string(),
  status: z.enum(['draft', 'posted', 'cancelled']),
  goods_receipt_items: z.array(receiptItemRowSchema).nullable().default([]),
})

const contractItemRelationSchema = z.object({
  contract_id: numericSchema.pipe(z.number().int().positive()),
})

const purchaseRequestItemRowSchema = z.object({
  purchase_request_id: z.string(),
  inventory_item_id: z.string(),
  unit_price: numericSchema.nullable(),
  contract_item_id: z.string().nullable(),
  inventory_items: z.object({ name: z.string().nullable() }).nullable().optional(),
  contract_items: z.union([
    contractItemRelationSchema,
    z.array(contractItemRelationSchema),
  ]).nullable().optional(),
})

const servicePlanRowSchema = z.object({
  id: z.string(),
  fiscal_year: numericSchema.pipe(z.number().int()),
  name: z.string(),
  department: z.string(),
  plan_type: z.string(),
})

const serviceLedgerRowSchema = z.object({
  id: z.string(),
  plan_id: z.string(),
  entry_kind: z.string(),
  amount: numericSchema,
  event_date: z.string(),
  purchase_request_id: z.string().nullable(),
  source_reference: z.string().nullable(),
})

export interface ExecutiveContractInput {
  id: number
  displayName: string | null
  product: string
  fiscalYear: number | null
  contractType: ContractType | null
  contractNumber: string | null
  durationYears: ContractDurationYears | null
  status: ContractStatus | null
  total: number | null
  startDate: string | null
  endDate: string | null
  department: string | null
  usages: Array<{ amount: number; usageMonth: string | null }>
}

export interface ExecutiveReceiptInput {
  id: string
  fiscalYear: number
  purchaseRequestId: string | null
  receivedDate: string
  status: 'draft' | 'posted' | 'cancelled'
  items: Array<{ inventoryItemId: string; quantity: number }>
}

export interface ExecutivePurchaseRequestItemInput {
  purchaseRequestId: string
  inventoryItemId: string
  itemName: string | null
  unitPrice: number | null
  contractItemId: string | null
  contractId: number | null
}

export interface ExecutiveServicePlanInput {
  id: string
  fiscalYear: number
  name: string
  department: string
}

export interface ExecutiveServiceLedgerInput {
  id: string
  planId: string
  entryKind: string
  amount: number
  eventDate: string
  purchaseRequestId: string | null
  sourceReference: string | null
}

export interface ExecutiveAggregationInput {
  fiscalYear: number
  generatedOn?: string
  contracts: ExecutiveContractInput[]
  receipts: ExecutiveReceiptInput[]
  purchaseRequestItems: ExecutivePurchaseRequestItemInput[]
  servicePlans: ExecutiveServicePlanInput[]
  serviceLedger: ExecutiveServiceLedgerInput[]
}

const MONTH_LABELS = [
  { month: 10, label: 'ต.ค.' },
  { month: 11, label: 'พ.ย.' },
  { month: 12, label: 'ธ.ค.' },
  { month: 1, label: 'ม.ค.' },
  { month: 2, label: 'ก.พ.' },
  { month: 3, label: 'มี.ค.' },
  { month: 4, label: 'เม.ย.' },
  { month: 5, label: 'พ.ค.' },
  { month: 6, label: 'มิ.ย.' },
  { month: 7, label: 'ก.ค.' },
  { month: 8, label: 'ส.ค.' },
  { month: 9, label: 'ก.ย.' },
] as const

const ACTUAL_SERVICE_ENTRY_KINDS = new Set([
  'expense',
  'historical_expense',
  'expense_adjustment',
  'expense_reversal',
])

function toSatang(value: number): number {
  return Math.round(value * 100)
}

function fromSatang(value: number): number {
  return value / 100
}

function safeName(displayName: string | null, product: string): string {
  return displayName?.trim() || product
}

function dateInRange(value: string, fiscalYear: number): boolean {
  return isDateInFiscalYear(value.slice(0, 10), fiscalYear)
}

function monthKey(value: string): string {
  return value.slice(0, 7)
}

function fiscalMonths(fiscalYear: number): Array<{ month: string; label: string }> {
  const startYear = fiscalYear - 544
  return MONTH_LABELS.map(({ month, label }, index) => {
    const gregorianYear = index < 3 ? startYear : startYear + 1
    return {
      month: `${gregorianYear}-${String(month).padStart(2, '0')}`,
      label,
    }
  })
}

function contractOverlapsFiscalYear(contract: ExecutiveContractInput, fiscalYear: number): boolean {
  const range = fiscalYearRange(fiscalYear)
  if (contract.startDate && contract.startDate.slice(0, 10) <= range.end) {
    if (!contract.endDate || contract.endDate.slice(0, 10) >= range.start) return true
  }
  return contract.fiscalYear === fiscalYear
}

function relationContractId(
  relation: z.infer<typeof contractItemRelationSchema> | z.infer<typeof contractItemRelationSchema>[] | null | undefined,
): number | null {
  if (!relation) return null
  const row = Array.isArray(relation) ? relation[0] : relation
  return row ? row.contract_id : null
}

interface PeriodAccumulator {
  purchase: number
  service: number
  lease: number
  purchaseCount: number
  serviceCount: number
  leaseCount: number
  monthly: Map<string, { purchase: number; service: number; lease: number }>
}

function createAccumulator(fiscalYear: number): PeriodAccumulator {
  return {
    purchase: 0,
    service: 0,
    lease: 0,
    purchaseCount: 0,
    serviceCount: 0,
    leaseCount: 0,
    monthly: new Map(fiscalMonths(fiscalYear).map(({ month }) => [month, { purchase: 0, service: 0, lease: 0 }])),
  }
}

function addMonthly(
  accumulator: PeriodAccumulator,
  value: string,
  category: 'purchase' | 'service' | 'lease',
  amount: number,
) {
  const row = accumulator.monthly.get(monthKey(value))
  if (!row) return
  row[category] += toSatang(amount)
}

function toSpendTotals(accumulator: PeriodAccumulator): ExecutiveSpendTotals {
  const purchase = fromSatang(accumulator.purchase)
  const service = fromSatang(accumulator.service)
  const lease = fromSatang(accumulator.lease)
  const hiringTotal = service + lease
  return {
    purchase,
    service,
    lease,
    hiringTotal,
    total: purchase + hiringTotal,
  }
}

function comparison(current: number, previous: number): ExecutiveComparison {
  const changeAmount = current - previous
  if (previous === 0) {
    return {
      current,
      previous,
      changeAmount,
      changePercent: null,
      trend: current === 0 ? 'flat' : 'no-baseline',
    }
  }
  const changePercent = (changeAmount / previous) * 100
  return {
    current,
    previous,
    changeAmount,
    changePercent,
    trend: changeAmount === 0 ? 'flat' : changeAmount > 0 ? 'up' : 'down',
  }
}

function buildMonthlyRows(
  fiscalYear: number,
  accumulator: PeriodAccumulator,
): ExecutiveMonthlySpend[] {
  return fiscalMonths(fiscalYear).map(({ month, label }) => {
    const row = accumulator.monthly.get(month) ?? { purchase: 0, service: 0, lease: 0 }
    const purchase = fromSatang(row.purchase)
    const service = fromSatang(row.service)
    const lease = fromSatang(row.lease)
    const hiringTotal = service + lease
    return {
      month,
      label,
      purchase,
      service,
      lease,
      hiringTotal,
      total: purchase + hiringTotal,
    }
  })
}

function share(amount: number, total: number): number | null {
  return total > 0 ? (amount / total) * 100 : null
}

function buildCategories(spend: ExecutiveSpendTotals, accumulator: PeriodAccumulator): ExecutiveCategorySummary[] {
  return [
    {
      key: 'purchase',
      label: 'งานซื้อ',
      amount: spend.purchase,
      count: accumulator.purchaseCount,
      share: share(spend.purchase, spend.total),
      note: 'มูลค่ารับเข้าคลังจากสัญญาที่ไม่ใช่เช่าเครื่อง',
    },
    {
      key: 'hiring',
      label: 'งานจ้างทั้งหมด',
      amount: spend.hiringTotal,
      count: accumulator.serviceCount + accumulator.leaseCount,
      share: share(spend.hiringTotal, spend.total),
      note: 'งานจ้างระบบรวมกับเช่าเครื่อง',
    },
    {
      key: 'lease',
      label: 'เช่าเครื่อง',
      amount: spend.lease,
      count: accumulator.leaseCount,
      share: share(spend.lease, spend.total),
      note: 'รายละเอียดภายในงานจ้าง ไม่บวกซ้ำในยอดรวม',
    },
  ]
}

function buildDurationSummary(
  contracts: ExecutiveContractInput[],
  fiscalYear: number,
  expenseByContract: Map<number, number>,
  leaseTotal: number,
): { summary: LeaseDurationSummary[]; contracts: LeaseContractSummary[]; missingDuration: number; missingDate: number } {
  const leaseContracts = contracts
    .filter((contract) => contract.contractType === 'equipment_lease')
    .filter((contract) => contractOverlapsFiscalYear(contract, fiscalYear))
    .map((contract) => ({
      contractId: contract.id,
      contractNumber: contract.contractNumber,
      contractName: safeName(contract.displayName, contract.product),
      durationYears: contract.durationYears,
      startDate: contract.startDate,
      endDate: contract.endDate,
      fiscalYearExpense: expenseByContract.get(contract.id) ?? 0,
      status: effectiveContractStatus(contract.status, contract.endDate),
      department: contract.department,
    }))
    .sort((left, right) => {
      if (right.fiscalYearExpense !== left.fiscalYearExpense) return right.fiscalYearExpense - left.fiscalYearExpense
      if (!left.endDate) return 1
      if (!right.endDate) return -1
      return left.endDate.localeCompare(right.endDate)
    })

  const durationKeys: Array<ContractDurationYears | null> = [1, 3]
  if (leaseContracts.some((contract) => contract.durationYears === null)) durationKeys.push(null)
  const summary = durationKeys.map((durationYears) => {
    const matching = leaseContracts.filter((contract) => contract.durationYears === durationYears)
    const expense = matching.reduce((sum, contract) => sum + contract.fiscalYearExpense, 0)
    return {
      durationYears,
      label: durationYears === null ? 'ไม่ระบุ' : `${durationYears} ปี`,
      contractCount: matching.length,
      expense,
      share: share(expense, leaseTotal),
    }
  })

  return {
    summary,
    contracts: leaseContracts,
    missingDuration: leaseContracts.filter((contract) => contract.durationYears === null).length,
    missingDate: leaseContracts.filter((contract) => !contract.startDate || !contract.endDate).length,
  }
}

function buildAlerts(
  contracts: ExecutiveContractInput[],
  fiscalYear: number,
  dataQuality: ExecutiveDataQuality,
): ExecutiveAlert[] {
  const alerts: ExecutiveAlert[] = []
  const qualityAmount = dataQuality.unclassifiedReceiptAmount + dataQuality.missingReceiptPriceAmount
  const qualityCount = dataQuality.unclassifiedReceiptCount + dataQuality.missingReceiptPriceCount

  if (qualityCount > 0) {
    alerts.push({
      key: 'receiving-data-quality',
      tone: 'danger',
      label: 'มีรายการรับเข้าต้องตรวจสอบ',
      detail: `${qualityCount.toLocaleString('th-TH')} รายการ${qualityAmount > 0 ? ` · ${qualityAmount.toLocaleString('th-TH')} บาท` : ''}`,
      href: '/receipts',
    })
  }

  if (dataQuality.missingUsageMonthCount > 0) {
    alerts.push({
      key: 'lease-usage-data-quality',
      tone: 'danger',
      label: 'ค่าเช่าบางรายการไม่มีเดือนอ้างอิง',
      detail: `${dataQuality.missingUsageMonthCount.toLocaleString('th-TH')} รายการไม่ถูกจัดเข้าปีงบประมาณ`,
      href: '/contracts?contractType=equipment_lease',
    })
  }

  if (dataQuality.missingLeaseDurationCount > 0 || dataQuality.missingLeaseDateCount > 0) {
    const parts = []
    if (dataQuality.missingLeaseDurationCount > 0) parts.push(`ไม่ระบุระยะเวลา ${dataQuality.missingLeaseDurationCount} สัญญา`)
    if (dataQuality.missingLeaseDateCount > 0) parts.push(`ไม่ระบุวันเริ่ม/สิ้นสุด ${dataQuality.missingLeaseDateCount} สัญญา`)
    alerts.push({
      key: 'lease-contract-metadata',
      tone: 'attention',
      label: 'ข้อมูลสัญญาเช่าเครื่องยังไม่ครบ',
      detail: parts.join(' · '),
      href: '/contracts?contractType=equipment_lease',
    })
  }

  const selectedLeases = contracts
    .filter((contract) => contract.contractType === 'equipment_lease')
    .filter((contract) => contractOverlapsFiscalYear(contract, fiscalYear))
  const riskCount = selectedLeases.filter((contract) => {
    const snapshot = budgetSnapshot({
      total: contract.total,
      entries: contract.usages.map((usage) => ({ amount: usage.amount })),
    })
    return isExpiring(contract.total, contract.endDate) || isLowBudget(contract.total, snapshot.used)
  }).length
  if (riskCount > 0) {
    alerts.push({
      key: 'lease-risk',
      tone: 'attention',
      label: 'สัญญาเช่าเครื่องที่ต้องติดตาม',
      detail: `${riskCount.toLocaleString('th-TH')} สัญญา · ใกล้สิ้นสุดหรือมีงบคงเหลือต่ำ`,
      href: '/contracts?contractType=equipment_lease',
    })
  }

  const pendingCount = contracts.filter((contract) =>
    contract.fiscalYear === fiscalYear && effectiveContractStatus(contract.status, contract.endDate) === 'pending',
  ).length
  if (pendingCount > 0) {
    alerts.push({
      key: 'pending-contracts',
      tone: 'attention',
      label: 'สัญญาที่ยังอยู่ระหว่างดำเนินการ',
      detail: `${pendingCount.toLocaleString('th-TH')} สัญญาในปีงบประมาณ ${fiscalYear}`,
      href: '/contracts?fiscalYear=' + fiscalYear,
    })
  }

  if (alerts.length === 0) {
    alerts.push({
      key: 'clear',
      tone: 'neutral',
      label: 'ไม่พบประเด็นเร่งด่วนจากข้อมูลที่เลือก',
      detail: 'ระบบจะอัปเดตสถานะเมื่อมีรายการใหม่หรือข้อมูลเปลี่ยนแปลง',
      href: null,
    })
  }
  return alerts
}

export function aggregateExecutiveOverview(input: ExecutiveAggregationInput): ExecutiveOverview {
  const fiscalYear = input.fiscalYear
  const priorFiscalYear = fiscalYear - 1
  const selected = createAccumulator(fiscalYear)
  const previous = createAccumulator(priorFiscalYear)
  const accumulators = new Map([[fiscalYear, selected], [priorFiscalYear, previous]])
  const contractsById = new Map(input.contracts.map((contract) => [contract.id, contract]))
  const purchaseItems = new Map(
    input.purchaseRequestItems.map((item) => [`${item.purchaseRequestId}:${item.inventoryItemId}`, item]),
  )
  const expenseByLeaseContract = new Map<number, number>()
  const purchaseSourceRows: ExecutivePurchaseSourceRow[] = []
  const serviceSourceRows: ExecutiveServiceSourceRow[] = []
  const leaseSourceRows: ExecutiveLeaseSourceRow[] = []
  const dataQuality: ExecutiveDataQuality = {
    unclassifiedReceiptCount: 0,
    unclassifiedReceiptAmount: 0,
    missingReceiptPriceCount: 0,
    missingReceiptPriceAmount: 0,
    missingUsageMonthCount: 0,
    missingUsageMonthAmount: 0,
    missingLeaseDurationCount: 0,
    missingLeaseDateCount: 0,
  }

  for (const contract of input.contracts) {
    if (contract.contractType !== 'equipment_lease') continue
    for (const usage of contract.usages) {
      const normalizedMonth = usage.usageMonth ? normalizeUsageMonth(usage.usageMonth) : null
      if (!normalizedMonth) {
        dataQuality.missingUsageMonthCount += 1
        dataQuality.missingUsageMonthAmount += usage.amount
        continue
      }
      const usageFiscalYear = fiscalYearFromDate(normalizedMonth)
      const accumulator = accumulators.get(usageFiscalYear)
      if (!accumulator) continue
      const amountSatang = toSatang(usage.amount)
      accumulator.lease += amountSatang
      accumulator.leaseCount += 1
      addMonthly(accumulator, normalizedMonth, 'lease', usage.amount)
      if (usageFiscalYear === fiscalYear) {
        expenseByLeaseContract.set(
          contract.id,
          fromSatang(toSatang(expenseByLeaseContract.get(contract.id) ?? 0) + amountSatang),
        )
        leaseSourceRows.push({
          contractId: contract.id,
          contractName: safeName(contract.displayName, contract.product),
          usageMonth: normalizedMonth,
          amount: usage.amount,
        })
      }
    }
  }

  for (const receipt of input.receipts) {
    if (receipt.status !== 'posted' || !receipt.purchaseRequestId) {
      if (receipt.status === 'posted' && dateInRange(receipt.receivedDate, fiscalYear)) {
        dataQuality.unclassifiedReceiptCount += receipt.items.length || 1
      }
      continue
    }
    const receiptFiscalYear = fiscalYearFromDate(receipt.receivedDate)
    const accumulator = accumulators.get(receiptFiscalYear)
    if (!accumulator) continue

    for (const receiptItem of receipt.items) {
      const source = purchaseItems.get(`${receipt.purchaseRequestId}:${receiptItem.inventoryItemId}`)
      const amount = source?.unitPrice === null || source === undefined
        ? null
        : fromSatang(toSatang(receiptItem.quantity * source.unitPrice))
      const contract = source?.contractId === null || source === undefined
        ? null
        : contractsById.get(source.contractId)
      if (!source) {
        if (receiptFiscalYear === fiscalYear) {
          dataQuality.unclassifiedReceiptCount += 1
        }
        continue
      }
      if (source.unitPrice === null) {
        if (receiptFiscalYear === fiscalYear) dataQuality.missingReceiptPriceCount += 1
        continue
      }
      if (!contract || contract.contractType === 'equipment_lease') {
        if (receiptFiscalYear === fiscalYear) {
          dataQuality.unclassifiedReceiptCount += 1
          if (amount !== null) dataQuality.unclassifiedReceiptAmount += amount
        }
        continue
      }
      if (amount === null) continue
      accumulator.purchase += toSatang(amount)
      accumulator.purchaseCount += 1
      addMonthly(accumulator, receipt.receivedDate, 'purchase', amount)
      if (receiptFiscalYear === fiscalYear) {
        purchaseSourceRows.push({
          receiptId: receipt.id,
          receivedDate: receipt.receivedDate,
          purchaseRequestId: receipt.purchaseRequestId,
          itemName: source.itemName,
          quantity: receiptItem.quantity,
          unitPrice: source.unitPrice,
          amount,
          contractId: contract.id,
          contractName: safeName(contract.displayName, contract.product),
        })
      }
    }
  }

  const servicePlansById = new Map(input.servicePlans.map((plan) => [plan.id, plan]))
  for (const entry of input.serviceLedger) {
    if (!ACTUAL_SERVICE_ENTRY_KINDS.has(entry.entryKind)) continue
    const entryFiscalYear = fiscalYearFromDate(entry.eventDate)
    const accumulator = accumulators.get(entryFiscalYear)
    if (!accumulator) continue
    accumulator.service += toSatang(entry.amount)
    accumulator.serviceCount += 1
    addMonthly(accumulator, entry.eventDate, 'service', entry.amount)
    if (entryFiscalYear === fiscalYear) {
      const plan = servicePlansById.get(entry.planId)
      if (plan) {
        serviceSourceRows.push({
          planId: plan.id,
          planName: plan.name,
          department: plan.department,
          eventDate: entry.eventDate,
          entryKind: entry.entryKind,
          amount: entry.amount,
          purchaseRequestId: entry.purchaseRequestId,
          sourceReference: entry.sourceReference,
        })
      }
    }
  }

  const spend = toSpendTotals(selected)
  const priorYearSpend = toSpendTotals(previous)
  const duration = buildDurationSummary(input.contracts, fiscalYear, expenseByLeaseContract, spend.lease)
  dataQuality.missingLeaseDurationCount = duration.missingDuration
  dataQuality.missingLeaseDateCount = duration.missingDate

  const categories = buildCategories(spend, selected)
  return {
    fiscalYear,
    fiscalYearRange: fiscalYearRange(fiscalYear),
    generatedOn: input.generatedOn ?? bangkokIsoDate(),
    spend,
    priorYearSpend,
    comparison: comparison(spend.total, priorYearSpend.total),
    monthly: buildMonthlyRows(fiscalYear, selected),
    categories,
    leaseDurationSummary: duration.summary,
    leaseContracts: duration.contracts,
    alerts: buildAlerts(input.contracts, fiscalYear, dataQuality),
    dataQuality,
    purchaseSourceRows,
    serviceSourceRows,
    leaseSourceRows,
  }
}

export async function getExecutiveOverview({ fiscalYear }: { fiscalYear: number }): Promise<ExecutiveOverview> {
  if (!Number.isInteger(fiscalYear) || fiscalYear < 2500 || fiscalYear > 3000) {
    throw new Error('ปีงบประมาณไม่ถูกต้อง')
  }

  const supabase = await createClient()
  const range = fiscalYearRange(fiscalYear)
  const priorRange = fiscalYearRange(fiscalYear - 1)
  const earliestDate = priorRange.start
  const latestDate = range.end

  const [contractsResult, receiptsResult, servicePlansResult] = await Promise.all([
    supabase
      .from('contracts')
      .select(`
        id,
        display_name,
        product,
        fiscal_year,
        contract_type,
        contract_number,
        contract_duration_years,
        status,
        total,
        start_date,
        end_date,
        department,
        contract_usage (amount, usage_month)
      `)
      .or('is_archived.eq.false,is_archived.is.null'),
    supabase
      .from('goods_receipts')
      .select(`
        id,
        fiscal_year,
        purchase_request_id,
        received_date,
        status,
        goods_receipt_items (inventory_item_id, quantity)
      `)
      .eq('status', 'posted')
      .gte('received_date', earliestDate)
      .lte('received_date', latestDate),
    supabase
      .from('service_procurement_plans')
      .select('id, fiscal_year, name, department, plan_type')
      .in('fiscal_year', [fiscalYear - 1, fiscalYear]),
  ])

  if (contractsResult.error) throw new Error(`อ่านสัญญาสำหรับ Dashboard ผู้บริหารไม่สำเร็จ: ${contractsResult.error.message}`)
  if (receiptsResult.error) throw new Error(`อ่านรายการรับเข้าสำหรับ Dashboard ผู้บริหารไม่สำเร็จ: ${receiptsResult.error.message}`)
  if (servicePlansResult.error) throw new Error(`อ่านแผนงานจ้างสำหรับ Dashboard ผู้บริหารไม่สำเร็จ: ${servicePlansResult.error.message}`)

  const contractRows = contractRowSchema.array().parse(contractsResult.data ?? [])
  const receiptRows = receiptRowSchema.array().parse(receiptsResult.data ?? [])
  const servicePlanRows = servicePlanRowSchema.array().parse(servicePlansResult.data ?? [])
  const requestIds = [...new Set(receiptRows.map((row) => row.purchase_request_id).filter((id): id is string => Boolean(id)))]
  const planIds = servicePlanRows.map((row) => row.id)

  const [purchaseItemsResult, serviceLedgerResult] = await Promise.all([
    requestIds.length
      ? supabase
        .from('purchase_request_items')
        .select(`
          purchase_request_id,
          inventory_item_id,
          unit_price,
          contract_item_id,
          inventory_items (name),
          contract_items (contract_id)
        `)
        .in('purchase_request_id', requestIds)
      : Promise.resolve({ data: [], error: null }),
    planIds.length
      ? supabase
        .from('service_plan_ledger')
        .select('id, plan_id, entry_kind, amount, event_date, purchase_request_id, source_reference')
        .in('plan_id', planIds)
      : Promise.resolve({ data: [], error: null }),
  ])

  if (purchaseItemsResult.error) throw new Error(`อ่านรายการ PR สำหรับ Dashboard ผู้บริหารไม่สำเร็จ: ${purchaseItemsResult.error.message}`)
  if (serviceLedgerResult.error) throw new Error(`อ่าน ledger งานจ้างสำหรับ Dashboard ผู้บริหารไม่สำเร็จ: ${serviceLedgerResult.error.message}`)

  const purchaseItemRows = purchaseRequestItemRowSchema.array().parse(purchaseItemsResult.data ?? [])
  const ledgerRows = serviceLedgerRowSchema.array().parse(serviceLedgerResult.data ?? [])

  return aggregateExecutiveOverview({
    fiscalYear,
    contracts: contractRows.map((row) => ({
      id: row.id,
      displayName: row.display_name,
      product: row.product,
      fiscalYear: row.fiscal_year,
      contractType: row.contract_type,
      contractNumber: row.contract_number,
      durationYears: row.contract_duration_years,
      status: row.status,
      total: row.total,
      startDate: row.start_date,
      endDate: row.end_date,
      department: row.department,
      usages: (row.contract_usage ?? []).map((usage) => ({ amount: usage.amount, usageMonth: usage.usage_month })),
    })),
    receipts: receiptRows.map((row) => ({
      id: row.id,
      fiscalYear: row.fiscal_year,
      purchaseRequestId: row.purchase_request_id,
      receivedDate: row.received_date,
      status: row.status,
      items: (row.goods_receipt_items ?? []).map((item) => ({ inventoryItemId: item.inventory_item_id, quantity: item.quantity })),
    })),
    purchaseRequestItems: purchaseItemRows.map((row) => {
      return {
        purchaseRequestId: row.purchase_request_id,
        inventoryItemId: row.inventory_item_id,
        itemName: row.inventory_items?.name ?? null,
        unitPrice: row.unit_price,
        contractItemId: row.contract_item_id,
        contractId: relationContractId(row.contract_items),
      }
    }),
    servicePlans: servicePlanRows.map((row) => ({
      id: row.id,
      fiscalYear: row.fiscal_year,
      name: row.name,
      department: row.department,
    })),
    serviceLedger: ledgerRows.map((row) => ({
      id: row.id,
      planId: row.plan_id,
      entryKind: row.entry_kind,
      amount: row.amount,
      eventDate: row.event_date,
      purchaseRequestId: row.purchase_request_id,
      sourceReference: row.source_reference,
    })),
  })
}

export function contractStatusLabel(status: ContractStatus | null): string {
  return status ? CONTRACT_STATUS_LABELS[status] : 'ไม่ระบุสถานะ'
}
