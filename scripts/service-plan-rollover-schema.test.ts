import assert from 'node:assert/strict'

async function run() {
  const schemaModule = await import('../lib/service-procurement/schema') as Record<string, unknown>
  const rolloverSchema = schemaModule.servicePlanRolloverInputSchema as {
    safeParse(value: unknown): { success: boolean }
  } | undefined

  assert.ok(rolloverSchema, 'servicePlanRolloverInputSchema must be exported')

  const valid = {
    sourceFiscalYear: 2569,
    targetFiscalYear: 2570,
    items: [
      { sourcePlanId: '11111111-1111-4111-8111-111111111111', budget: 125000.5, expectedUpdatedAt: '2026-08-30T12:00:00.000Z', responsibleProfileIds: [] },
      { sourcePlanId: '22222222-2222-4222-8222-222222222222', budget: 80000, expectedUpdatedAt: '2026-08-30T12:00:00.000Z', responsibleProfileIds: ['33333333-3333-4333-8333-333333333333'] },
    ],
  }
  assert.equal(rolloverSchema.safeParse(valid).success, true)
  assert.equal(rolloverSchema.safeParse({ ...valid, targetFiscalYear: 2571 }).success, false, 'target must follow source year')
  assert.equal(rolloverSchema.safeParse({ ...valid, items: [{ ...valid.items[0], budget: 0 }] }).success, false, 'budget must be positive')
  assert.equal(rolloverSchema.safeParse({ ...valid, items: [{ sourcePlanId: valid.items[0].sourcePlanId, budget: 100 }] }).success, false, 'source snapshot is required')
  assert.equal(rolloverSchema.safeParse({ ...valid, items: [valid.items[0], valid.items[0]] }).success, false, 'source plan ids must be unique')
  assert.equal(rolloverSchema.safeParse({ ...valid, items: [] }).success, true, 'review may confirm that no plan is carried forward')

  console.log('service plan rollover schema: ok')
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
