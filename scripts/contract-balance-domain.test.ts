import assert from 'node:assert/strict'

interface SupplyItemInput {
  quantity: number
  unitPrice: number
  allocations?: Array<{ quantity: number; allocationKind?: string }> | null
}

interface SupplyBalance {
  totalValue: number
  remainingValue: number
  items: Array<{
    allocatedQuantity: number
    openingUsedQuantity: number
    remainingQuantity: number
    remainingValue: number
  }>
}

async function main() {
  const budget = await import('../lib/contracts/budget') as unknown as {
    contractSupplyBalance?: (items: SupplyItemInput[]) => SupplyBalance
    contractActualUsedValue?: (total: number | null, remaining: number | null) => number | null
    contractSpendingRates?: (actualUsed: number | null, durationYears: 1 | 3 | null) => {
      durationYears: 1 | 3 | null
      durationMonths: number | null
      monthly: number | null
      annual: number | null
    }
  }

  assert.equal(typeof budget.contractSupplyBalance, 'function', 'supply balance calculation must be available to contract detail reads')

  const balance = budget.contractSupplyBalance!([
    {
      quantity: 10,
      unitPrice: 125.5,
      allocations: [{ quantity: 2 }, { quantity: -0.5 }],
    },
    {
      quantity: 3,
      unitPrice: 1000,
      allocations: [{ quantity: 3 }],
    },
  ])

  assert.deepEqual(balance, {
    totalValue: 4255,
    remainingValue: 1066.75,
    items: [
      { allocatedQuantity: 1.5, openingUsedQuantity: 0, remainingQuantity: 8.5, remainingValue: 1066.75, remainingPercent: 85 },
      { allocatedQuantity: 3, openingUsedQuantity: 0, remainingQuantity: 0, remainingValue: 0, remainingPercent: 0 },
    ],
  }, 'remaining quantities and baht values must come from the net allocation ledger')

  // A line with an opening_balance row is reported separately from allocatedQuantity
  // (which still totals every kind), so the UI can show "used before this system" apart
  // from "used since".
  const withOpeningBalance = budget.contractSupplyBalance!([
    {
      quantity: 100,
      unitPrice: 10,
      allocations: [{ quantity: 30, allocationKind: 'opening_balance' }, { quantity: 5, allocationKind: 'purchase_request' }],
    },
  ])
  assert.deepEqual(withOpeningBalance.items[0], {
    allocatedQuantity: 35,
    openingUsedQuantity: 30,
    remainingQuantity: 65,
    remainingValue: 650,
    remainingPercent: 65,
  }, 'openingUsedQuantity must isolate only the opening_balance rows while allocatedQuantity keeps the ledger total')

  assert.equal(typeof budget.contractSpendingRates, 'function', 'contract spending pace must be available to the detail page')
  assert.equal(budget.contractActualUsedValue!(4255, 1066.75), 3188.25, 'supply actual use must be derived from total less remaining value')
  assert.equal(budget.contractActualUsedValue!(null, 1066.75), null, 'an unknown contract value must not become an actual-use zero')
  assert.deepEqual(budget.contractSpendingRates!(300_000, 1), {
    durationYears: 1,
    durationMonths: 12,
    monthly: 25_000,
    annual: 300_000,
  }, 'a one-year contract should divide actual use by 12 months and one year')
  assert.deepEqual(budget.contractSpendingRates!(300_000, 3), {
    durationYears: 3,
    durationMonths: 36,
    monthly: 8_333.33,
    annual: 100_000,
  }, 'a three-year contract should divide actual use by 36 months and three years')
  assert.deepEqual(budget.contractSpendingRates!(0, 1), {
    durationYears: 1,
    durationMonths: 12,
    monthly: 0,
    annual: 0,
  }, 'a contract with no recorded use yet should show zero, not an unavailable rate')
  assert.deepEqual(budget.contractSpendingRates!(1_200_000, null), {
    durationYears: null,
    durationMonths: null,
    monthly: null,
    annual: null,
  }, 'an unclassified contract must not be presented as a zero spending pace')

  console.log('contract balance domain: ok')
}

void main()
