import assert from 'node:assert/strict'

interface SupplyItemInput {
  quantity: number
  unitPrice: number
  allocations?: Array<{ quantity: number }> | null
}

interface SupplyBalance {
  totalValue: number
  remainingValue: number
  items: Array<{
    allocatedQuantity: number
    remainingQuantity: number
    remainingValue: number
  }>
}

async function main() {
  const budget = await import('../lib/contracts/budget') as unknown as {
    contractSupplyBalance?: (items: SupplyItemInput[]) => SupplyBalance
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
      { allocatedQuantity: 1.5, remainingQuantity: 8.5, remainingValue: 1066.75, remainingPercent: 85 },
      { allocatedQuantity: 3, remainingQuantity: 0, remainingValue: 0, remainingPercent: 0 },
    ],
  }, 'remaining quantities and baht values must come from the net allocation ledger')

  console.log('contract balance domain: ok')
}

void main()
