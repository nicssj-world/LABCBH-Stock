import assert from 'node:assert/strict'
import {
  PR_MAX_ATTACHMENT_SIZE_BYTES,
  annualPlanTypeForPurchaseMethod,
  committeePdfVariant,
  derivePurchaseRequestChecklist,
  methodRequiresAnnualPlanReference,
  methodRequiresProcurementPlanReference,
  validateCommitteeAssignments,
  validatePurchaseRequestAttachment,
} from '../lib/pr/checklist'
import {
  buildPurchaseRequestChecklistUploadKey,
  isPurchaseRequestChecklistStorageKey,
  validatePurchaseRequestChecklistObject,
} from '../lib/pr/checklist-storage'

function countAttachments(
  policy: ReturnType<typeof derivePurchaseRequestChecklist>,
  kind: 'tor' | 'quotation' | 'plan_page' | 'contract_page',
) {
  return policy.attachments.filter((attachment) => attachment.kind === kind).length
}

{
  const belowQuoteThreshold = derivePurchaseRequestChecklist('annual_plan', 49_999.99)
  assert.equal(countAttachments(belowQuoteThreshold, 'tor'), 1)
  assert.equal(countAttachments(belowQuoteThreshold, 'quotation'), 1)
  assert.equal(countAttachments(belowQuoteThreshold, 'plan_page'), 1)
  assert.deepEqual(
    belowQuoteThreshold.committees.map(({ kind, seats }) => [kind, seats]),
    [['specification', 1], ['inspection', 1]],
  )

  const atQuoteThreshold = derivePurchaseRequestChecklist('annual_plan', 50_000)
  assert.equal(countAttachments(atQuoteThreshold, 'quotation'), 3)
  assert.deepEqual(
    atQuoteThreshold.committees.map(({ kind, seats }) => [kind, seats]),
    [['specification', 1], ['inspection', 1]],
  )

  const atCommitteeThreshold = derivePurchaseRequestChecklist('annual_plan', 100_000)
  assert.deepEqual(
    atCommitteeThreshold.committees.map(({ kind, seats }) => [kind, seats]),
    [['specification', 3], ['inspection', 3]],
  )
}

{
  const actorId = '11111111-1111-4111-8111-111111111111'
  const sessionId = '22222222-2222-4222-8222-222222222222'
  const key = buildPurchaseRequestChecklistUploadKey({
    actorId,
    sessionId,
    fileName: '../../ใบเสนอราคา บริษัท ก.pdf',
  })
  assert.match(
    key,
    /^labcbh-stock\/pr-checklists\/uploads\/11111111-1111-4111-8111-111111111111\/22222222-2222-4222-8222-222222222222\/[0-9a-f-]+-.*\.pdf$/,
  )
  assert.equal(isPurchaseRequestChecklistStorageKey(key), true)
  assert.equal(isPurchaseRequestChecklistStorageKey('documents/sets/not-pr.pdf'), false)
  assert.equal(isPurchaseRequestChecklistStorageKey('labcbh-stock/pr-checklists/uploads/../secret.pdf'), false)
  assert.deepEqual(
    validatePurchaseRequestChecklistObject(
      { sizeBytes: 20, mimeType: 'application/pdf' },
      { contentLength: 20, contentType: 'application/pdf' },
    ),
    [],
  )
  assert.match(
    validatePurchaseRequestChecklistObject(
      { sizeBytes: 20, mimeType: 'application/pdf' },
      { contentLength: 19, contentType: 'application/pdf' },
    )[0] ?? '',
    /ขนาด/,
  )
}

{
  for (const method of ['awaiting_contract', 'off_plan'] as const) {
    const policy = derivePurchaseRequestChecklist(method, 50_000)
    assert.equal(countAttachments(policy, 'tor'), 1)
    assert.equal(countAttachments(policy, 'quotation'), 3)
    assert.equal(countAttachments(policy, 'plan_page'), 0)
    assert.deepEqual(policy.committees.map(({ kind }) => kind), ['specification', 'inspection'])
  }
}

{
  const policy = derivePurchaseRequestChecklist('contract', 250_000)
  assert.equal(policy.committeeSource, 'contract')
  assert.equal(countAttachments(policy, 'contract_page'), 1)
  assert.equal(policy.attachments.length, 1)
  assert.equal(policy.committees.length, 0)
}

{
  const specific = derivePurchaseRequestChecklist('specific_contract', 1_000_000)
  assert.equal(countAttachments(specific, 'tor'), 1)
  assert.equal(countAttachments(specific, 'quotation'), 3)
  assert.equal(countAttachments(specific, 'plan_page'), 1)
  assert.deepEqual(
    specific.committees.map(({ kind, seats }) => [kind, seats]),
    [['specification', 3], ['inspection', 3]],
  )

  for (const method of ['e_bidding', 'equipment_lease'] as const) {
    const policy = derivePurchaseRequestChecklist(method, method === 'equipment_lease' ? null : 1_000_000)
    assert.equal(countAttachments(policy, 'quotation'), 3)
    assert.equal(countAttachments(policy, 'plan_page'), 1)
    assert.deepEqual(
      policy.committees.map(({ kind, seats }) => [kind, seats]),
      [['specification', 3], ['result', 3], ['inspection', 3]],
    )
  }
}

for (const method of ['annual_plan', 'specific_contract', 'e_bidding'] as const) {
  assert.equal(methodRequiresProcurementPlanReference(method), true)
  assert.equal(methodRequiresAnnualPlanReference(method), true)
  assert.equal(annualPlanTypeForPurchaseMethod(method), 'procurement')
}
assert.equal(methodRequiresProcurementPlanReference('equipment_lease'), false)
assert.equal(methodRequiresAnnualPlanReference('equipment_lease'), true)
assert.equal(annualPlanTypeForPurchaseMethod('equipment_lease'), 'hiring')
assert.equal(methodRequiresProcurementPlanReference('off_plan'), false)
assert.equal(methodRequiresAnnualPlanReference('off_plan'), false)
assert.equal(annualPlanTypeForPurchaseMethod('off_plan'), null)

{
  assert.equal(PR_MAX_ATTACHMENT_SIZE_BYTES, 20 * 1024 * 1024)
  assert.deepEqual(
    validatePurchaseRequestAttachment({
      kind: 'tor',
      mimeType: 'application/pdf',
      sizeBytes: PR_MAX_ATTACHMENT_SIZE_BYTES,
    }),
    [],
  )
  assert.match(
    validatePurchaseRequestAttachment({
      kind: 'tor',
      mimeType: 'image/jpeg',
      sizeBytes: 1024,
    })[0] ?? '',
    /PDF/,
  )
  assert.match(
    validatePurchaseRequestAttachment({
      kind: 'quotation',
      mimeType: 'application/pdf',
      sizeBytes: PR_MAX_ATTACHMENT_SIZE_BYTES + 1,
    })[0] ?? '',
    /20 MB/,
  )
}

{
  const policy = derivePurchaseRequestChecklist('e_bidding', 1_000_000)
  const assignments = [
    { kind: 'specification' as const, seat: 1, profileId: 'a' },
    { kind: 'specification' as const, seat: 2, profileId: 'b' },
    { kind: 'specification' as const, seat: 3, profileId: 'c' },
    { kind: 'result' as const, seat: 1, profileId: 'd' },
    { kind: 'result' as const, seat: 2, profileId: 'e' },
    { kind: 'result' as const, seat: 3, profileId: 'i' },
    { kind: 'inspection' as const, seat: 1, profileId: 'f' },
    { kind: 'inspection' as const, seat: 2, profileId: 'g' },
    { kind: 'inspection' as const, seat: 3, profileId: 'h' },
  ]
  assert.deepEqual(validateCommitteeAssignments(policy, assignments), [])

  const specificationResultOverlap = assignments.map((assignment) =>
    assignment.kind === 'result' && assignment.seat === 1
      ? { ...assignment, profileId: 'a' }
      : assignment,
  )
  assert.deepEqual(validateCommitteeAssignments(policy, specificationResultOverlap), [])

  const specificationInspectionOverlap = assignments.map((assignment) =>
    assignment.kind === 'inspection' && assignment.seat === 1
      ? { ...assignment, profileId: 'a' }
      : assignment,
  )
  assert.deepEqual(validateCommitteeAssignments(policy, specificationInspectionOverlap), [])

  assert.match(
    validateCommitteeAssignments(policy, specificationInspectionOverlap.map((assignment) =>
      assignment.kind === 'result' && assignment.seat === 1
        ? { ...assignment, profileId: 'a' }
        : assignment,
    ))[0] ?? '',
    /ตรวจรับ/,
  )
}

{
  assert.deepEqual(committeePdfVariant({ subjectName: 'สัญญาทดสอบ', total: 120_000 }), {
    kind: 'contract',
    subjectName: 'สัญญาทดสอบ',
    budget: 120_000,
  })
  assert.deepEqual(committeePdfVariant({ subjectName: 'สัญญาเช่าเครื่อง', total: null }), {
    kind: 'contract',
    subjectName: 'สัญญาเช่าเครื่อง',
    budget: null,
  })
  assert.deepEqual(committeePdfVariant({ subjectName: null, total: 500_000 }), {
    kind: 'specific_under_500k',
    subjectName: null,
    budget: 500_000,
  })
  assert.deepEqual(committeePdfVariant({ subjectName: null, total: 500_000.01 }), {
    kind: 'specific_under_500k',
    subjectName: null,
    budget: 500_000.01,
  })
}

console.log('purchase request checklist domain: ok')
