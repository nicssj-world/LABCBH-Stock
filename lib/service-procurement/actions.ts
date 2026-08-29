'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireActor } from '@/lib/auth/actor'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { assertServicePlanManager, assertServiceRequester, assertServiceStockOperator } from './authorization'
import {
  serviceCancellationSchema,
  serviceClosePoSchema,
  serviceLabExpenseCancelSchema,
  serviceLabExpenseInputSchema,
  serviceLabExpenseUpdateSchema,
  servicePlanBudgetRevisionSchema,
  servicePlanExpenseAdjustmentSchema,
  servicePlanHistoricalExpenseSchema,
  servicePlanInputSchema,
  servicePlanUpdateSchema,
  servicePurchaseRequestInputSchema,
  servicePurchaseRequestHeaderSchema,
  serviceUsageInputSchema,
  type ServicePurchaseRequestInput,
} from './schema'
import {
  SERVICE_ATTACHMENT_MAX_BYTES,
  SERVICE_FILE_BUCKET,
  SERVICE_PO_MAX_BYTES,
  checksumFor,
  isServiceDocumentMimeAllowed,
  isServiceFilePathAllowed,
  serviceFilePath,
  validateServiceAttachment,
} from './files'
import { DUPLICATE_SERVICE_INVOICE_MESSAGE, isDuplicateServiceInvoiceError } from './invoice'
import { enqueueStorageCleanupJobBestEffort } from '@/lib/storage/cleanup-jobs'

type ServiceActionError = {
  code?: string | null
  message: string
  details?: string | null
  hint?: string | null
}

function unwrap<T>(operation: string, result: { data: T | null; error: ServiceActionError | null }): T {
  if (result.error) {
    if (isDuplicateServiceInvoiceError(result.error)) throw new Error(DUPLICATE_SERVICE_INVOICE_MESSAGE)
    throw new Error(`${operation}ไม่สำเร็จ: ${result.error.message}`)
  }
  if (result.data === null) throw new Error(`${operation}ไม่สำเร็จ: ไม่พบผลลัพธ์`)
  return result.data
}

function revalidatePlan(planId?: string | null) {
  revalidatePath('/service-procurement/plans')
  if (planId) revalidatePath(`/service-procurement/plans/${planId}`)
}
function revalidateRequest(requestId?: string | null) {
  revalidatePath('/service-procurement/purchase-requests')
  if (requestId) revalidatePath(`/service-procurement/purchase-requests/${requestId}`)
}

export async function createServicePlan(input: unknown) {
  const actor = await requireActor(); assertServicePlanManager(actor)
  const parsed = servicePlanInputSchema.parse(input)
  const result = await supabaseAdmin.rpc('create_service_procurement_plan', { p_actor_id: actor.id, p_payload: parsed })
  const plan = unwrap('สร้างแผนงานจ้าง', result); revalidatePlan(plan.id); return plan
}

export async function updateServicePlan(planId: string, input: unknown) {
  const actor = await requireActor(); assertServicePlanManager(actor)
  const parsed = servicePlanUpdateSchema.parse(input)
  const result = await supabaseAdmin.rpc('update_service_procurement_plan', { p_actor_id: actor.id, p_plan_id: planId, p_payload: parsed })
  const plan = unwrap('แก้ไขแผนงานจ้าง', result); revalidatePlan(plan.id); return plan
}

export async function setServicePlanResponsibles(planId: string, profileIds: string[]) {
  const actor = await requireActor(); assertServicePlanManager(actor)
  const result = await supabaseAdmin.rpc('set_service_plan_responsibles', { p_actor_id: actor.id, p_plan_id: planId, p_profile_ids: profileIds })
  const plan = unwrap('บันทึกผู้รับผิดชอบแผนงานจ้าง', result); revalidatePlan(plan.id); return plan
}

export async function reviseServicePlanBudget(input: unknown) {
  const actor = await requireActor(); assertServicePlanManager(actor)
  const parsed = servicePlanBudgetRevisionSchema.parse(input)
  const result = await supabaseAdmin.rpc('revise_service_plan_budget', { p_actor_id: actor.id, p_plan_id: parsed.planId, p_next_budget: parsed.budget, p_reason: parsed.reason })
  const plan = unwrap('ปรับวงเงินแผนงานจ้าง', result); revalidatePlan(plan.id); return plan
}

// Kept for old audit/report routes. The plan detail UI no longer exposes a
// manual expense form; actual expenses are posted only by close PO.
export async function recordServicePlanHistoricalExpense(input: unknown) {
  const actor = await requireActor(); const parsed = servicePlanHistoricalExpenseSchema.parse(input)
  const result = await supabaseAdmin.rpc('record_service_plan_historical_expense', { p_actor_id: actor.id, p_plan_id: parsed.planId, p_amount: parsed.amount, p_expense_date: parsed.expenseDate, p_reason: parsed.reason ?? null, p_source_reference: parsed.sourceReference })
  const entry = unwrap('บันทึกค่าใช้จ่าย', result); revalidatePlan(parsed.planId); return entry
}
export async function adjustServicePlanExpense(input: unknown) {
  const actor = await requireActor(); const parsed = servicePlanExpenseAdjustmentSchema.parse(input)
  const result = await supabaseAdmin.rpc('adjust_service_plan_expense', { p_actor_id: actor.id, p_plan_id: parsed.planId, p_amount: parsed.amount, p_expense_date: parsed.expenseDate, p_reason: parsed.reason, p_source_reference: parsed.sourceReference, p_source_ledger_id: parsed.sourceLedgerId })
  const entry = unwrap('ปรับยอดค่าใช้จ่าย', result); revalidatePlan(parsed.planId); return entry
}
export async function deleteServicePlan(planId: string) {
  const actor = await requireActor(); assertServicePlanManager(actor)
  const result = await supabaseAdmin.rpc('delete_service_procurement_plan', { p_actor_id: actor.id, p_plan_id: planId })
  if (result.error) throw new Error(`ลบแผนงานจ้างไม่สำเร็จ: ${result.error.message}`); revalidatePlan()
}

function readJsonField(formData: FormData, field: string): unknown {
  const value = formData.get(field)
  if (typeof value !== 'string') throw new Error(`ไม่พบข้อมูล ${field}`)
  try { return JSON.parse(value) } catch { throw new Error(`ข้อมูล ${field} ไม่ถูกต้อง`) }
}
function readRequiredFile(formData: FormData, field: string): File {
  const value = formData.get(field)
  if (!(value instanceof File) || value.size === 0) throw new Error(`กรุณาแนบไฟล์ ${field}`)
  return value
}
function readOptionalFile(formData: FormData, field: string): File | null {
  const value = formData.get(field)
  return value instanceof File && value.size > 0 ? value : null
}

async function uploadServiceFile(ownerId: string, kind: 'checklist' | 'po' | 'plan-document', file: File, attachmentKind?: 'tor' | 'quotation') {
  if (!isServiceDocumentMimeAllowed(file.type)) throw new Error('รองรับเฉพาะ PDF, JPG, PNG หรือ WEBP')
  const max = kind === 'po' ? SERVICE_PO_MAX_BYTES : SERVICE_ATTACHMENT_MAX_BYTES
  if (file.size <= 0 || file.size > max) throw new Error(kind === 'po' ? 'ไฟล์ PO ต้องมีขนาดไม่เกิน 10 MB' : 'ไฟล์แนบแต่ละไฟล์ต้องมีขนาดไม่เกิน 20 MB')
  if (attachmentKind) {
    const errors = validateServiceAttachment({ kind: attachmentKind, mimeType: file.type, sizeBytes: file.size })
    if (errors.length) throw new Error(errors[0])
  }
  const path = serviceFilePath(ownerId, file.name, kind)
  if (!isServiceFilePathAllowed(path, ownerId, kind)) throw new Error('เส้นทางไฟล์ไม่ถูกต้อง')
  const upload = await supabaseAdmin.storage.from(SERVICE_FILE_BUCKET).upload(path, file, { upsert: false, contentType: file.type })
  if (upload.error) throw new Error(`อัปโหลดไฟล์ไม่สำเร็จ: ${upload.error.message}`)
  return { path, fileName: file.name, mimeType: file.type, sizeBytes: file.size, checksum: checksumFor(await file.arrayBuffer()) }
}

async function upsertPlanDocument(actorId: string, planId: string, kind: 'quotation' | 'contract_page', file: File) {
  const uploaded = await uploadServiceFile(planId, 'plan-document', file)
  const result = await supabaseAdmin.rpc('upsert_service_plan_document', {
    p_actor_id: actorId, p_plan_id: planId, p_document_kind: kind, p_storage_key: uploaded.path,
    p_file_name: uploaded.fileName, p_mime_type: uploaded.mimeType, p_size_bytes: uploaded.sizeBytes, p_checksum: uploaded.checksum,
  })
  if (result.error) {
    const rollback = await supabaseAdmin.storage.from(SERVICE_FILE_BUCKET).remove([uploaded.path])
    if (rollback.error) await enqueueStorageCleanupJobBestEffort({ storageBackend: 'supabase_storage', bucketName: SERVICE_FILE_BUCKET, storageKey: uploaded.path, jobKind: 'storage_upload_rollback' })
    throw new Error(`บันทึกเอกสารระดับแผนไม่สำเร็จ: ${result.error.message}`)
  }
  const response = result.data as { oldStorageKey?: string | null } | null
  const oldStorageKey = response?.oldStorageKey
  if (oldStorageKey && isServiceFilePathAllowed(oldStorageKey, planId, 'plan-document')) {
    const removed = await supabaseAdmin.storage.from(SERVICE_FILE_BUCKET).remove([oldStorageKey])
    if (removed.error) await enqueueStorageCleanupJobBestEffort({ storageBackend: 'supabase_storage', bucketName: SERVICE_FILE_BUCKET, storageKey: oldStorageKey, jobKind: 'storage_upload_rollback' })
  }
}

export async function createServicePurchaseRequest(formData: FormData) {
  const actor = await requireActor(); assertServiceRequester(actor)
  const draft = readJsonField(formData, 'payload') as Record<string, unknown>
  const { committees: rawCommittees, ...draftWithoutCommittees } = draft
  const committees = Array.isArray(rawCommittees) ? rawCommittees : []
  const parsed = servicePurchaseRequestInputSchema.parse({
    ...draftWithoutCommittees,
    requesterName: actor.name?.trim() || (actor.ephisId ? `E-Phis ${actor.ephisId}` : actor.id),
    checklist: { attachments: [], committees },
  }) as ServicePurchaseRequestInput
  const tor = readRequiredFile(formData, 'tor')
  const torUpload = await uploadServiceFile(actor.id, 'checklist', tor, 'tor')
  const attachment = [{ kind: 'tor', slot: 1, storageKey: torUpload.path, fileName: torUpload.fileName, mimeType: torUpload.mimeType, sizeBytes: torUpload.sizeBytes }]
  const quotation = readOptionalFile(formData, 'quotation')
  const contractPage = readOptionalFile(formData, 'contractPage')
  try {
    if (quotation) await upsertPlanDocument(actor.id, parsed.planId, 'quotation', quotation)
    if (contractPage) await upsertPlanDocument(actor.id, parsed.planId, 'contract_page', contractPage)
  } catch (error) {
    const rollback = await supabaseAdmin.storage.from(SERVICE_FILE_BUCKET).remove([torUpload.path])
    if (rollback.error) await enqueueStorageCleanupJobBestEffort({ storageBackend: 'supabase_storage', bucketName: SERVICE_FILE_BUCKET, storageKey: torUpload.path, jobKind: 'storage_upload_rollback' })
    throw error
  }
  const payload = {
    ...parsed,
    checklist: undefined,
    attachments: attachment,
    committees: parsed.checklist.committees,
    documentChoices: { replaceQuotation: Boolean(quotation), replaceContractPage: Boolean(contractPage) },
  }
  try {
    const result = await supabaseAdmin.rpc('create_service_purchase_request', { p_actor_id: actor.id, p_payload: payload })
    const request = unwrap('ส่งใบ PR งานจ้าง', result); revalidateRequest(request.id); return request
  } catch (error) {
    const rollback = await supabaseAdmin.storage.from(SERVICE_FILE_BUCKET).remove([torUpload.path])
    if (rollback.error) await enqueueStorageCleanupJobBestEffort({ storageBackend: 'supabase_storage', bucketName: SERVICE_FILE_BUCKET, storageKey: torUpload.path, jobKind: 'storage_upload_rollback' })
    throw error
  }
}

export async function updateServicePurchaseRequest(requestId: string, formData: FormData) {
  const actor = await requireActor(); assertServiceRequester(actor)
  const parsedRequestId = z.string().uuid().parse(requestId)
  const draft = readJsonField(formData, 'payload') as Record<string, unknown>
  const { committees: rawCommittees, ...draftWithoutCommittees } = draft
  const committees = Array.isArray(rawCommittees) ? rawCommittees : []
  const parsed = servicePurchaseRequestInputSchema.parse({
    ...draftWithoutCommittees,
    requesterName: actor.name?.trim() || (actor.ephisId ? `E-Phis ${actor.ephisId}` : actor.id),
    checklist: { attachments: [], committees },
  }) as ServicePurchaseRequestInput

  const previousAttachment = await supabaseAdmin
    .from('service_purchase_request_attachments')
    .select('storage_key')
    .eq('purchase_request_id', parsedRequestId)
    .eq('attachment_kind', 'tor')
    .eq('slot', 1)
    .maybeSingle()
  if (previousAttachment.error) throw new Error(`อ่านไฟล์ TOR เดิมไม่สำเร็จ: ${previousAttachment.error.message}`)

  const tor = readOptionalFile(formData, 'tor')
  const torUpload = tor ? await uploadServiceFile(actor.id, 'checklist', tor, 'tor') : null
  const attachment = torUpload
    ? [{ kind: 'tor', slot: 1, storageKey: torUpload.path, fileName: torUpload.fileName, mimeType: torUpload.mimeType, sizeBytes: torUpload.sizeBytes }]
    : []
  const quotation = readOptionalFile(formData, 'quotation')
  const contractPage = readOptionalFile(formData, 'contractPage')

  try {
    if (quotation) await upsertPlanDocument(actor.id, parsed.planId, 'quotation', quotation)
    if (contractPage) await upsertPlanDocument(actor.id, parsed.planId, 'contract_page', contractPage)

    const payload = {
      ...parsed,
      checklist: undefined,
      attachments: attachment,
      committees: parsed.checklist.committees,
      documentChoices: { replaceQuotation: Boolean(quotation), replaceContractPage: Boolean(contractPage) },
    }
    const result = await supabaseAdmin.rpc('update_service_purchase_request', {
      p_actor_id: actor.id,
      p_request_id: parsedRequestId,
      p_payload: payload,
    })
    const request = unwrap('แก้ไขใบ PR งานจ้าง', result)

    const oldStorageKey = previousAttachment.data?.storage_key
    if (
      torUpload && oldStorageKey &&
      oldStorageKey.startsWith('service-procurement/checklist/') &&
      !oldStorageKey.includes('..')
    ) {
      const removed = await supabaseAdmin.storage.from(SERVICE_FILE_BUCKET).remove([oldStorageKey])
      if (removed.error) {
        await enqueueStorageCleanupJobBestEffort({
          storageBackend: 'supabase_storage',
          bucketName: SERVICE_FILE_BUCKET,
          storageKey: oldStorageKey,
          jobKind: 'storage_upload_rollback',
        })
      }
    }

    revalidateRequest(request.id)
    const updatedPlanId = (request as unknown as { plan_id?: string | null }).plan_id
    if (updatedPlanId) revalidatePlan(updatedPlanId)
    return request
  } catch (error) {
    if (torUpload) {
      const rollback = await supabaseAdmin.storage.from(SERVICE_FILE_BUCKET).remove([torUpload.path])
      if (rollback.error) {
        await enqueueStorageCleanupJobBestEffort({
          storageBackend: 'supabase_storage',
          bucketName: SERVICE_FILE_BUCKET,
          storageKey: torUpload.path,
          jobKind: 'storage_upload_rollback',
        })
      }
    }
    throw error
  }
}

export async function updateServicePurchaseRequestHeader(requestId: string, input: { department: string; requestedDate: string; note: string | null }) {
  const actor = await requireActor(); assertServiceRequester(actor)
  const parsed = servicePurchaseRequestHeaderSchema.parse(input)
  const result = await supabaseAdmin.rpc('update_service_purchase_request_header', { p_actor_id: actor.id, p_request_id: requestId, p_department: parsed.department, p_requested_date: parsed.requestedDate, p_note: parsed.note })
  const request = unwrap('แก้ไขใบ PR งานจ้าง', result); revalidateRequest(request.id); return request
}
export async function cancelServicePurchaseRequest(requestId: string, reason: string) {
  const actor = await requireActor(); const parsed = serviceCancellationSchema.parse({ requestId, reason })
  const result = await supabaseAdmin.rpc('cancel_service_purchase_request', { p_actor_id: actor.id, p_request_id: parsed.requestId, p_reason: parsed.reason })
  const request = unwrap('ยกเลิกใบ PR งานจ้าง', result); revalidateRequest(request.id); return request
}
export async function confirmServicePurchaseRequest(requestId: string) {
  const actor = await requireActor(); assertServiceStockOperator(actor)
  const result = await supabaseAdmin.rpc('confirm_service_purchase_request', { p_actor_id: actor.id, p_request_id: requestId })
  const request = unwrap('ยืนยันใบ PR งานจ้าง', result); revalidateRequest(request.id); return request
}
export async function setServiceEphisPrNumber(requestId: string, ephisPrNumber: string) {
  const actor = await requireActor(); assertServiceStockOperator(actor)
  const result = await supabaseAdmin.rpc('set_service_purchase_request_ephis_number', { p_actor_id: actor.id, p_request_id: requestId, p_ephis_pr_number: ephisPrNumber })
  const request = unwrap('บันทึกเลข PR จาก E-Phis', result); revalidateRequest(request.id); return request
}
export async function setServicePoNumber(requestId: string, poNumber: string) {
  const actor = await requireActor(); assertServiceStockOperator(actor)
  const result = await supabaseAdmin.rpc('set_service_purchase_request_po_number', { p_actor_id: actor.id, p_request_id: requestId, p_po_number: poNumber })
  const request = unwrap('บันทึกเลข PO', result); revalidateRequest(request.id); return request
}
export async function uploadServicePoFile(requestId: string, formData: FormData) {
  const actor = await requireActor(); assertServiceStockOperator(actor)
  const file = readRequiredFile(formData, 'file')
  const uploaded = await uploadServiceFile(requestId, 'po', file)
  const result = await supabaseAdmin.rpc('set_service_purchase_request_po_file', { p_actor_id: actor.id, p_request_id: requestId, p_path: uploaded.path, p_file_name: uploaded.fileName, p_mime_type: uploaded.mimeType, p_size_bytes: uploaded.sizeBytes, p_checksum: uploaded.checksum })
  try { const request = unwrap('บันทึกไฟล์ PO', result); revalidateRequest(request.id); return request } catch (error) {
    const rollback = await supabaseAdmin.storage.from(SERVICE_FILE_BUCKET).remove([uploaded.path])
    if (rollback.error) await enqueueStorageCleanupJobBestEffort({ storageBackend: 'supabase_storage', bucketName: SERVICE_FILE_BUCKET, storageKey: uploaded.path, jobKind: 'storage_upload_rollback' })
    throw error
  }
}

export async function closeServicePo(requestId: string, reason: string | null = null) {
  const actor = await requireActor(); const parsed = serviceClosePoSchema.parse({ requestId, reason })
  const result = await supabaseAdmin.rpc('close_service_purchase_request_po', { p_actor_id: actor.id, p_request_id: parsed.requestId, p_reason: parsed.reason })
  const request = unwrap('ปิด PO งานจ้าง', result); revalidateRequest(request.id); revalidatePlan(request.plan_id); return request
}
export async function cancelServicePo(requestId: string, reason: string) {
  const actor = await requireActor(); const parsed = serviceCancellationSchema.parse({ requestId, reason })
  const result = await supabaseAdmin.rpc('cancel_service_purchase_request_po', { p_actor_id: actor.id, p_request_id: parsed.requestId, p_reason: parsed.reason })
  const request = unwrap('ยกเลิก PO งานจ้าง', result); revalidateRequest(request.id); revalidatePlan(request.plan_id); return request
}

export async function recordServiceLabExpense(input: unknown) {
  const actor = await requireActor(); const parsed = serviceLabExpenseInputSchema.parse(input)
  const result = await supabaseAdmin.rpc('record_service_purchase_request_expense', { p_actor_id: actor.id, p_request_id: parsed.requestId, p_expense_date: parsed.expenseDate, p_amount: parsed.amount, p_invoice_number: parsed.invoiceNumber, p_note: parsed.note })
  const expense = unwrap('บันทึกค่าใช้จ่ายงานจ้าง', result)
  revalidateRequest(parsed.requestId)
  // Contract-backed PRs close the PO and post the plan ledger inside the RPC.
  // Invalidate the plan list as well so its available balance is fresh.
  revalidatePlan()
  return expense
}
export async function updateServiceLabExpense(input: unknown) {
  const actor = await requireActor(); const parsed = serviceLabExpenseUpdateSchema.parse(input)
  const result = await supabaseAdmin.rpc('update_service_purchase_request_expense', { p_actor_id: actor.id, p_expense_id: parsed.expenseId, p_expense_date: parsed.expenseDate, p_amount: parsed.amount, p_invoice_number: parsed.invoiceNumber, p_note: parsed.note, p_reason: parsed.reason })
  const expense = unwrap('แก้ไขค่าใช้จ่ายงานจ้าง', result); revalidateRequest(parsed.requestId); return expense
}
export async function cancelServiceLabExpense(input: unknown) {
  const actor = await requireActor(); const parsed = serviceLabExpenseCancelSchema.parse(input)
  const result = await supabaseAdmin.rpc('cancel_service_purchase_request_expense', { p_actor_id: actor.id, p_expense_id: parsed.expenseId, p_reason: parsed.reason })
  const expense = unwrap('ยกเลิกค่าใช้จ่ายงานจ้าง', result); revalidateRequest(parsed.requestId); return expense
}

/** Legacy exports intentionally fail at the RPC boundary; annual-item usage is retired. */
export async function recordServiceUsage(input: unknown) { serviceUsageInputSchema.parse(input); throw new Error('งานจ้างไม่มีการบันทึกการใช้รายรายการแบบเดิม') }
export async function adjustServiceLabExpense(input: unknown) { z.any().parse(input); throw new Error('ใช้ปุ่มแก้ไขหรือยกเลิกรายการค่าใช้จ่ายแทน') }

export async function getServicePoFileUrl(requestId: string): Promise<string | null> {
  await requireActor()
  const request = await supabaseAdmin.from('service_purchase_requests').select('po_file_path').eq('id', requestId).maybeSingle()
  if (request.error) throw new Error(`อ่านไฟล์ PO งานจ้างไม่สำเร็จ: ${request.error.message}`)
  const path = request.data?.po_file_path as string | null | undefined
  if (!path) return null
  if (!isServiceFilePathAllowed(path, requestId, 'po')) throw new Error('เส้นทางไฟล์ PO ไม่ถูกต้อง')
  const signed = await supabaseAdmin.storage.from(SERVICE_FILE_BUCKET).createSignedUrl(path, 300)
  if (signed.error) throw new Error(`สร้างลิงก์ไฟล์ PO ไม่สำเร็จ: ${signed.error.message}`)
  return signed.data.signedUrl
}

export async function advanceServicePlanLifecycle() {
  const actor = await requireActor(); assertServicePlanManager(actor)
  const result = await supabaseAdmin.rpc('advance_service_procurement_plan_lifecycle', { p_actor_id: actor.id })
  const rows = unwrap('ปิดแผนงานจ้างสิ้นปี', result); revalidatePlan(); return rows
}
