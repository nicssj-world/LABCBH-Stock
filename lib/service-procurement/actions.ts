'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireActor } from '@/lib/auth/actor'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { assertServicePlanManager, assertServiceRequester, assertServiceStockOperator } from './authorization'
import {
  serviceCancellationSchema,
  serviceClosePoSchema,
  serviceLabExpenseInputSchema,
  serviceLabExpenseAdjustmentSchema,
  servicePlanBudgetRevisionSchema,
  servicePlanExpenseAdjustmentSchema,
  servicePlanHistoricalExpenseSchema,
  servicePlanInputSchema,
  servicePurchaseRequestInputSchema,
  servicePurchaseRequestHeaderSchema,
  serviceUsageInputSchema,
  type ServicePurchaseRequestInput,
} from './schema'
import {
  SERVICE_FILE_BUCKET,
  SERVICE_PO_MAX_BYTES,
  checksumFor,
  isServiceDocumentMimeAllowed,
  isServiceFilePathAllowed,
  serviceFilePath,
  validateServiceAttachment,
} from './files'

function unwrap<T>(operation: string, result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new Error(`${operation}ไม่สำเร็จ: ${result.error.message}`)
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
  const actor = await requireActor()
  assertServicePlanManager(actor)
  const parsed = servicePlanInputSchema.parse(input)
  const result = await supabaseAdmin.rpc('create_service_procurement_plan', { p_actor_id: actor.id, p_payload: parsed })
  const plan = unwrap('สร้างแผนงานจ้าง', result)
  revalidatePlan(plan.id)
  return plan
}

export async function updateServicePlan(planId: string, input: unknown) {
  const actor = await requireActor()
  assertServicePlanManager(actor)
  const parsed = servicePlanInputSchema.extend({ expectedUpdatedAt: z.string().datetime({ offset: true }).nullable() }).parse(input)
  const result = await supabaseAdmin.rpc('update_service_procurement_plan', { p_actor_id: actor.id, p_plan_id: planId, p_payload: parsed })
  const plan = unwrap('แก้ไขแผนงานจ้าง', result)
  revalidatePlan(plan.id)
  return plan
}

export async function setServicePlanResponsibles(planId: string, profileIds: string[]) {
  const actor = await requireActor()
  assertServicePlanManager(actor)
  const result = await supabaseAdmin.rpc('set_service_plan_responsibles', { p_actor_id: actor.id, p_plan_id: planId, p_profile_ids: profileIds })
  const plan = unwrap('บันทึกผู้รับผิดชอบแผนงานจ้าง', result)
  revalidatePlan(plan.id)
  return plan
}

export async function reviseServicePlanBudget(input: unknown) {
  const actor = await requireActor()
  assertServicePlanManager(actor)
  const parsed = servicePlanBudgetRevisionSchema.parse(input)
  const result = await supabaseAdmin.rpc('revise_service_plan_budget', {
    p_actor_id: actor.id, p_plan_id: parsed.planId, p_next_budget: parsed.budget, p_reason: parsed.reason,
  })
  const plan = unwrap('ปรับวงเงินแผนงานจ้าง', result)
  revalidatePlan(plan.id)
  return plan
}

export async function recordServicePlanHistoricalExpense(input: unknown) {
  const actor = await requireActor()
  const parsed = servicePlanHistoricalExpenseSchema.parse(input)
  const result = await supabaseAdmin.rpc('record_service_plan_historical_expense', {
    p_actor_id: actor.id, p_plan_id: parsed.planId, p_amount: parsed.amount, p_expense_date: parsed.expenseDate,
    p_reason: parsed.reason ?? null, p_source_reference: parsed.sourceReference,
  })
  const entry = unwrap('บันทึกค่าใช้จ่าย', result)
  revalidatePlan(parsed.planId)
  return entry
}

export async function adjustServicePlanExpense(input: unknown) {
  const actor = await requireActor()
  const parsed = servicePlanExpenseAdjustmentSchema.parse(input)
  const result = await supabaseAdmin.rpc('adjust_service_plan_expense', {
    p_actor_id: actor.id, p_plan_id: parsed.planId, p_amount: parsed.amount, p_expense_date: parsed.expenseDate,
    p_reason: parsed.reason, p_source_reference: parsed.sourceReference, p_source_ledger_id: parsed.sourceLedgerId,
  })
  const entry = unwrap('ปรับยอดค่าใช้จ่าย', result)
  revalidatePlan(parsed.planId)
  return entry
}

export async function deleteServicePlan(planId: string) {
  const actor = await requireActor()
  assertServicePlanManager(actor)
  const result = await supabaseAdmin.rpc('delete_service_procurement_plan', { p_actor_id: actor.id, p_plan_id: planId })
  if (result.error) throw new Error(`ลบแผนงานจ้างไม่สำเร็จ: ${result.error.message}`)
  revalidatePlan()
}

function readJsonField(formData: FormData, field: string): unknown {
  const value = formData.get(field)
  if (typeof value !== 'string') throw new Error(`ไม่พบข้อมูล ${field}`)
  try { return JSON.parse(value) } catch { throw new Error(`ข้อมูล ${field} ไม่ถูกต้อง`) }
}

function readFile(formData: FormData, field: string): File {
  const value = formData.get(field)
  if (!(value instanceof File) || value.size === 0) throw new Error(`กรุณาแนบไฟล์ ${field}`)
  return value
}

async function uploadServiceFile(ownerId: string, kind: 'checklist' | 'po', file: File, attachmentKind?: 'tor' | 'quotation') {
  if (!isServiceDocumentMimeAllowed(file.type)) throw new Error('รองรับเฉพาะ PDF, JPG, PNG หรือ WEBP')
  if (file.size <= 0 || file.size > (kind === 'po' ? SERVICE_PO_MAX_BYTES : 20 * 1024 * 1024)) throw new Error(kind === 'po' ? 'ไฟล์ PO ต้องมีขนาดไม่เกิน 10 MB' : 'ไฟล์แนบแต่ละไฟล์ต้องมีขนาดไม่เกิน 20 MB')
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

export async function createServicePurchaseRequest(formData: FormData) {
  const actor = await requireActor()
  assertServiceRequester(actor)
  const draft = readJsonField(formData, 'payload') as Record<string, unknown>
  const committeeRows = Array.isArray(draft.committees) ? draft.committees : []
  const baseInput = {
    ...draft,
    requesterName: actor.name?.trim() || (actor.ephisId ? `E-Phis ${actor.ephisId}` : actor.id),
    checklist: { attachments: [], committees: committeeRows },
  }
  const parsed = servicePurchaseRequestInputSchema.parse(baseInput) as ServicePurchaseRequestInput
  const uploadedPaths: string[] = []
  try {
    const amount = parsed.amount
    const quoteCount = amount >= 50_000 ? 3 : 1
    const attachmentFiles: Array<{ kind: 'tor' | 'quotation'; slot: number; field: string }> = [
      { kind: 'tor', slot: 1, field: 'tor' },
      ...Array.from({ length: quoteCount }, (_, index) => ({ kind: 'quotation' as const, slot: index + 1, field: `quotation${index + 1}` })),
    ]
    const attachments: Array<Record<string, unknown>> = []
    for (const descriptor of attachmentFiles) {
      const uploaded = await uploadServiceFile(actor.id, 'checklist', readFile(formData, descriptor.field), descriptor.kind)
      uploadedPaths.push(uploaded.path)
      attachments.push({ kind: descriptor.kind, slot: descriptor.slot, storageKey: uploaded.path, fileName: uploaded.fileName, mimeType: uploaded.mimeType, sizeBytes: uploaded.sizeBytes })
    }
    const payload = { ...parsed, requestedPoMonth: parsed.requestedPoMonth ? `${parsed.requestedPoMonth}-01` : null, attachments, committees: parsed.checklist.committees }
    const result = await supabaseAdmin.rpc('create_service_purchase_request', { p_actor_id: actor.id, p_payload: payload })
    const request = unwrap('ส่งใบ PR งานจ้าง', result)
    revalidateRequest(request.id)
    return request
  } catch (error) {
    if (uploadedPaths.length) {
      const cleanup = await supabaseAdmin.storage.from(SERVICE_FILE_BUCKET).remove(uploadedPaths)
      if (cleanup.error) console.error('service checklist upload cleanup failed', cleanup.error)
    }
    throw error
  }
}

export async function updateServicePurchaseRequestHeader(requestId: string, input: { department: string; requestedDate: string; note: string | null }) {
  const actor = await requireActor()
  assertServiceRequester(actor)
  const parsed = servicePurchaseRequestHeaderSchema.parse(input)
  const result = await supabaseAdmin.rpc('update_service_purchase_request_header', { p_actor_id: actor.id, p_request_id: requestId, p_department: parsed.department, p_requested_date: parsed.requestedDate, p_note: parsed.note })
  const request = unwrap('แก้ไขใบ PR งานจ้าง', result)
  revalidateRequest(request.id)
  return request
}

export async function cancelServicePurchaseRequest(requestId: string, reason: string) {
  const actor = await requireActor()
  const parsed = serviceCancellationSchema.parse({ requestId, reason })
  const result = await supabaseAdmin.rpc('cancel_service_purchase_request', { p_actor_id: actor.id, p_request_id: parsed.requestId, p_reason: parsed.reason })
  const request = unwrap('ยกเลิกใบ PR งานจ้าง', result)
  revalidateRequest(request.id)
  return request
}

export async function confirmServicePurchaseRequest(requestId: string) {
  const actor = await requireActor()
  assertServiceStockOperator(actor)
  const result = await supabaseAdmin.rpc('confirm_service_purchase_request', { p_actor_id: actor.id, p_request_id: requestId })
  const request = unwrap('ยืนยันใบ PR งานจ้าง', result)
  revalidateRequest(request.id)
  return request
}

export async function setServiceEphisPrNumber(requestId: string, ephisPrNumber: string) {
  const actor = await requireActor()
  assertServiceStockOperator(actor)
  const result = await supabaseAdmin.rpc('set_service_purchase_request_ephis_number', { p_actor_id: actor.id, p_request_id: requestId, p_ephis_pr_number: ephisPrNumber })
  const request = unwrap('บันทึกเลข PR จาก E-Phis', result)
  revalidateRequest(request.id)
  return request
}

export async function setServicePoNumber(requestId: string, poNumber: string) {
  const actor = await requireActor()
  assertServiceStockOperator(actor)
  const result = await supabaseAdmin.rpc('set_service_purchase_request_po_number', { p_actor_id: actor.id, p_request_id: requestId, p_po_number: poNumber })
  const request = unwrap('บันทึกเลข PO', result)
  revalidateRequest(request.id)
  return request
}

export async function uploadServicePoFile(requestId: string, formData: FormData) {
  const actor = await requireActor()
  assertServiceStockOperator(actor)
  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) throw new Error('กรุณาเลือกไฟล์ PO')
  const uploaded = await uploadServiceFile(requestId, 'po', file)
  const result = await supabaseAdmin.rpc('set_service_purchase_request_po_file', { p_actor_id: actor.id, p_request_id: requestId, p_path: uploaded.path, p_file_name: uploaded.fileName, p_mime_type: uploaded.mimeType, p_size_bytes: uploaded.sizeBytes, p_checksum: uploaded.checksum })
  try {
    const request = unwrap('บันทึกไฟล์ PO', result)
    revalidateRequest(request.id)
    return request
  } catch (error) {
    await supabaseAdmin.storage.from(SERVICE_FILE_BUCKET).remove([uploaded.path])
    throw error
  }
}

export async function closeServicePo(requestId: string, reason: string | null = null) {
  const actor = await requireActor()
  assertServiceStockOperator(actor)
  const parsed = serviceClosePoSchema.parse({ requestId, reason })
  const result = await supabaseAdmin.rpc('close_service_purchase_request_po', { p_actor_id: actor.id, p_request_id: parsed.requestId, p_reason: parsed.reason })
  const request = unwrap('ปิด PO งานจ้าง', result)
  revalidateRequest(request.id)
  revalidatePlan(request.plan_id)
  return request
}

export async function cancelServicePo(requestId: string, reason: string) {
  const actor = await requireActor()
  assertServiceStockOperator(actor)
  const parsed = serviceCancellationSchema.parse({ requestId, reason })
  const result = await supabaseAdmin.rpc('cancel_service_purchase_request_po', { p_actor_id: actor.id, p_request_id: parsed.requestId, p_reason: parsed.reason })
  const request = unwrap('ยกเลิก PO งานจ้าง', result)
  revalidateRequest(request.id)
  revalidatePlan(request.plan_id)
  return request
}

export async function recordServiceUsage(input: unknown) {
  const actor = await requireActor()
  const parsed = serviceUsageInputSchema.parse(input)
  const result = await supabaseAdmin.rpc('record_service_purchase_request_usage', { p_actor_id: actor.id, p_request_id: parsed.requestId, p_usage_date: parsed.usageDate, p_items: parsed.items, p_note: parsed.note })
  const event = unwrap('บันทึกการใช้ใน PR งานจ้าง', result)
  revalidateRequest(parsed.requestId)
  return event
}

export async function recordServiceLabExpense(input: unknown) {
  const actor = await requireActor()
  const parsed = serviceLabExpenseInputSchema.parse(input)
  const result = await supabaseAdmin.rpc('record_service_purchase_request_lab_expense', { p_actor_id: actor.id, p_request_id: parsed.requestId, p_expense_date: parsed.expenseDate, p_amount: parsed.amount, p_note: parsed.note })
  const event = unwrap('บันทึกค่าใช้จ่ายงานตรวจห้องปฏิบัติการ', result)
  revalidateRequest(parsed.requestId)
  return event
}

export async function adjustServiceLabExpense(input: unknown) {
  const actor = await requireActor()
  const parsed = serviceLabExpenseAdjustmentSchema.parse(input)
  const result = await supabaseAdmin.rpc('adjust_service_purchase_request_lab_expense', {
    p_actor_id: actor.id,
    p_request_id: parsed.requestId,
    p_source_event_id: parsed.sourceEventId,
    p_expense_date: parsed.expenseDate,
    p_amount: parsed.amount,
    p_note: parsed.note,
  })
  const event = unwrap('ปรับยอดค่าใช้จ่ายงานตรวจห้องปฏิบัติการ', result)
  revalidateRequest(parsed.requestId)
  return event
}

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
