import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  PurchaseRequestChecklistFields,
  type ChecklistFileSelections,
} from '@/components/pr/PurchaseRequestChecklistFields'
import type { PurchaseMethodKind } from '@/lib/pr/schema'
import type { PurchaseRequestChecklistAttachmentRecord } from '@/lib/pr/types'

function renderChecklist(input: {
  method?: PurchaseMethodKind
  total?: number | null
  files?: ChecklistFileSelections
  existingAttachments?: PurchaseRequestChecklistAttachmentRecord[]
} = {}) {
  return renderToStaticMarkup(
    <PurchaseRequestChecklistFields
      method={input.method ?? 'off_plan'}
      total={input.total ?? 10_000}
      candidates={[]}
      files={input.files ?? {}}
      existingAttachments={input.existingAttachments ?? []}
      assignments={[]}
      contractRosterReady={false}
      checklistComplete={false}
      overallProgress={null}
      onFileChange={() => undefined}
      onAssignmentsChange={() => undefined}
    />,
  )
}

function attachment(
  kind: PurchaseRequestChecklistAttachmentRecord['kind'],
  slot: number,
): PurchaseRequestChecklistAttachmentRecord {
  return {
    id: `${kind}-${slot}`,
    kind,
    slot,
    fileName: `${kind}-${slot}.pdf`,
    mimeType: 'application/pdf',
    sizeBytes: 128,
    uploadedAt: '2026-08-24T00:00:00.000Z',
    uploadedByName: 'ผู้ทดสอบ',
    deletedAt: null,
    deletedByName: null,
    deletionReason: null,
    objectDeletedAt: null,
    storageBackend: 'r2',
    sourceContractId: null,
  }
}

const oneQuotation = renderChecklist()
assert.match(oneQuotation, /แนบแล้ว 0\/2 ไฟล์/)
assert.equal((oneQuotation.match(/>บริษัทที่ 1</g) ?? []).length, 1)
assert.doesNotMatch(oneQuotation, /แผนที่มีลำดับรายการที่ต้องการซื้อ/)

const threeQuotationsWithPlan = renderChecklist({ method: 'specific_contract' })
assert.match(threeQuotationsWithPlan, /แนบแล้ว 0\/5 ไฟล์/)
assert.equal((threeQuotationsWithPlan.match(/>บริษัทที่ [123]</g) ?? []).length, 3)
assert.match(threeQuotationsWithPlan, /แผนที่มีลำดับรายการที่ต้องการซื้อ/)
assert.equal((threeQuotationsWithPlan.match(/type="file"/g) ?? []).length, 4, 'the plan-page checklist item must not render a second upload input')
assert.match(threeQuotationsWithPlan, /ไฟล์นี้สร้างและแนบเข้าใบ PR โดยระบบเมื่อกดส่ง/)
assert.ok(
  threeQuotationsWithPlan.indexOf('รายละเอียดคุณลักษณะเฉพาะ (TOR)')
    < threeQuotationsWithPlan.indexOf('ใบเสนอราคาจากบริษัท'),
  'primary documents must precede quotations in DOM order',
)

const leaseWithHiringPlan = renderToStaticMarkup(
  <PurchaseRequestChecklistFields
    method="equipment_lease"
    total={null}
    candidates={[]}
    files={{}}
    existingAttachments={[]}
    assignments={[]}
    contractRosterReady={false}
    checklistComplete={false}
    annualPlanReferenceReady={true}
    annualPlanFileName="แผนจัดจ้าง-ไฮไลท์-2569.pdf"
    overallProgress={null}
    onFileChange={() => undefined}
    onAssignmentsChange={() => undefined}
  />,
)
assert.match(leaseWithHiringPlan, /แผนจัดจ้างที่มีลำดับสัญญา/)
assert.match(leaseWithHiringPlan, /แผนจัดจ้าง-ไฮไลท์-2569\.pdf/)
assert.equal((leaseWithHiringPlan.match(/type="file"/g) ?? []).length, 4, 'lease plan evidence must be generated, not uploaded by the requester')
assert.doesNotMatch(leaseWithHiringPlan, /แนบไฟล์ตามเดิม/)
assert.ok(
  threeQuotationsWithPlan.indexOf('>บริษัทที่ 1<')
    < threeQuotationsWithPlan.indexOf('>บริษัทที่ 2<')
    && threeQuotationsWithPlan.indexOf('>บริษัทที่ 2<')
    < threeQuotationsWithPlan.indexOf('>บริษัทที่ 3<'),
  'quotation slots must follow company order',
)

const validTor = new File(['valid'], 'tor.pdf', { type: 'application/pdf', lastModified: 1 })
const validSelected = renderChecklist({ files: { 'tor:1': validTor } })
assert.match(validSelected, /แนบแล้ว 1\/2 ไฟล์/)
assert.match(validSelected, /แนบแล้ว<\/span>/)
assert.doesNotMatch(validSelected, /aria-invalid="true"/)

const invalidTor = new File(['invalid'], 'tor.txt', { type: 'text/plain', lastModified: 1 })
const invalidSelected = renderChecklist({ files: { 'tor:1': invalidTor } })
assert.match(invalidSelected, /แนบแล้ว 0\/2 ไฟล์/)
assert.match(invalidSelected, /aria-invalid="true"/)
assert.match(invalidSelected, /aria-describedby="pr-checklist-tor-1-hint pr-checklist-tor-1-error"/)
assert.match(invalidSelected, /id="pr-checklist-tor-1-error"[^>]*aria-live="polite"/)
assert.match(invalidSelected, /เอกสาร TOR ต้องเป็นไฟล์ PDF เท่านั้น/)

const existingTor = attachment('tor', 1)
const existingSelected = renderChecklist({ existingAttachments: [existingTor] })
assert.match(existingSelected, /แนบแล้ว 1\/2 ไฟล์/)

const invalidReplacement = renderChecklist({
  files: { 'tor:1': invalidTor },
  existingAttachments: [existingTor],
})
assert.match(invalidReplacement, /แนบแล้ว 0\/2 ไฟล์/)
assert.match(invalidReplacement, /aria-invalid="true"/)

const validReplacement = renderChecklist({
  files: { 'tor:1': validTor },
  existingAttachments: [existingTor],
})
assert.match(validReplacement, /แนบแล้ว 1\/2 ไฟล์/)
assert.match(validReplacement, /จะแทนที่ไฟล์เดิมเมื่อบันทึก/)

console.log('purchase request checklist grouping UI: ok')
