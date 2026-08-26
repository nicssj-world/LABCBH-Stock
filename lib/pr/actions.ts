'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireActor } from '@/lib/auth/actor'
import { currentFiscalYear, fiscalYearOfIsoDate } from '@/lib/annual-plans/fiscal'
import {
  getCurrentAnnualPlanForPurchaseRequest,
  readCurrentPlanVersionPdf,
  validateAnnualPlanReferenceForContract,
  validateAnnualPlanReferenceForLines,
} from '@/lib/annual-plans/pr'
import type { AnnualPlanReference } from '@/lib/annual-plans/pr-reference'
import { assertStockOperator } from '@/lib/inventory/authorization'
import {
  annualPlanTypeForPurchaseMethod,
  methodRequiresAnnualPlanReference,
} from '@/lib/pr/checklist'
import {
  assertPurchaseRequestOutsideStockReceiver,
  assertPurchaseRequestManager,
  assertPurchaseRequester,
} from '@/lib/pr/authorization'
import {
  ephisPrNumberSchema,
  purchaseOrderNumberSchema,
  purchaseOrderNumberReleaseSchema,
  purchaseRequestInputSchema,
  purchaseRequestReversalSchema,
  purchaseRequestShortCloseSchema,
} from '@/lib/pr/schema'
import { purchaseRequestChecklistSubmissionSchema } from '@/lib/pr/checklist-schema'
import { verifyPurchaseRequestChecklistUploads } from '@/lib/pr/checklist-server'
import { isoDateSchema } from '@/lib/validation/date'
import { cleanupTerminalPurchaseRequestPoFile } from '@/lib/po/cleanup'
import type {
  EphisPrNumberInput,
  PurchaseOrderNumberInput,
  PurchaseOrderNumberReleaseInput,
  PurchaseRequestInput,
  PurchaseRequestReversalInput,
  PurchaseRequestShortCloseInput,
} from '@/lib/pr/types'
import type { PurchaseRequestChecklistSubmission } from '@/lib/pr/checklist-schema'
import { getPurchaseRequest } from '@/lib/pr/queries'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { omitNullishProperties } from '@/lib/validation/json'
import { formatPurchaseRequestMutationError } from './errors'
import { cleanupPurchaseRequestChecklistObjects } from './checklist-cleanup'

const purchaseRequestIdSchema = z.string().uuid()

function unwrapMutation(
  operation: string,
  result: { data: unknown; error: { message: string } | null },
) {
  if (result.error) throw new Error(formatPurchaseRequestMutationError(operation, result.error.message))
  return z.object({ id: z.string().uuid() }).passthrough().parse(result.data)
}

function revalidatePurchaseRequest(id?: string) {
  revalidatePath('/purchase-requests')
  revalidatePath('/purchase-requests/new')
  if (id) revalidatePath(`/purchase-requests/${id}`)
  revalidatePath('/dashboard')
  revalidatePath('/contracts')
  // A manually entered PR line may have created a new catalogue row in the
  // same transaction. Keep every downstream picker/list in sync immediately.
  revalidatePath('/inventory')
  revalidatePath('/receipts/new')
  revalidatePath('/requisitions/new')
}

/** The Thai fiscal year rolls on 1 October. */
function thaiFiscalYear(isoDate: string): number {
  return fiscalYearOfIsoDate(isoDate)
}

async function validateCurrentAnnualPlanSubmission(
  parsed: PurchaseRequestInput,
  referenceInput: unknown,
) {
  const planType = annualPlanTypeForPurchaseMethod(parsed.method.kind)
  if (!planType) {
    return { method: parsed.method, reference: null }
  }

  const fiscalYear = currentFiscalYear()
  if (fiscalYearOfIsoDate(parsed.requestedDate) !== fiscalYear) {
    throw new Error(`วันที่ขอซื้อของ PR ที่อ้างอิงแผน${planType === 'hiring' ? 'จัดจ้าง' : 'จัดซื้อ'}ต้องอยู่ในปีงบประมาณปัจจุบัน (${fiscalYear})`)
  }
  const plan = await getCurrentAnnualPlanForPurchaseRequest(planType)
  const validated = planType === 'hiring' && parsed.method.kind === 'equipment_lease'
    ? validateAnnualPlanReferenceForContract(referenceInput, parsed.method.contractDraft.displayName, plan)
    : validateAnnualPlanReferenceForLines(referenceInput, parsed.items, plan)
  // The source PDF is immutable evidence, not only a row index. Recheck its
  // size/checksum immediately before the PR transaction so a storage object
  // changed in place cannot make a cached highlight look current.
  await readCurrentPlanVersionPdf(validated.reference.planVersionId, planType)
  return {
    method: parsed.method.kind === 'annual_plan'
      ? {
          ...parsed.method,
          fiscalYear,
          planSequence: validated.selectedRows.map((row) => row.planSequence).join(', '),
        }
      : parsed.method,
    reference: validated.reference as AnnualPlanReference,
  }
}

export async function createPurchaseRequest(
  input: PurchaseRequestInput,
  checklist: PurchaseRequestChecklistSubmission,
  annualPlanReferenceInput?: unknown,
) {
  const actor = await requireActor()
  assertPurchaseRequester(actor)
  const parsed = purchaseRequestInputSchema.parse(input)
  const annualPlanSubmission = await validateCurrentAnnualPlanSubmission(parsed, annualPlanReferenceInput)
  const parsedChecklist = await verifyPurchaseRequestChecklistUploads({
    actor,
    method: parsed.method.kind,
    contractId: parsed.method.kind === 'contract' ? parsed.method.contractId : null,
    items: parsed.items,
    submission: purchaseRequestChecklistSubmissionSchema.parse(checklist),
    allowExistingAttachments: false,
  })
  const { items, ...request } = parsed
  const requestMethod = annualPlanSubmission.method

  // The legacy create_purchase_request_with_checklist RPC remains available
  // (supabaseAdmin.rpc('create_purchase_request_with_checklist', ...))
  // for old integrations; new submissions use the reference-aware wrapper.
  const result = await supabaseAdmin.rpc('create_purchase_request_with_annual_plan_checklist', {
    p_actor_id: actor.id,
    // headName always names the actor creating the PR — never trust a
    // client-supplied value, which a direct call to this action could set
    // to anyone's name.
    p_request: { ...request, method: requestMethod, headName: actor.name ?? request.headName, fiscalYear: thaiFiscalYear(parsed.requestedDate) },
    // Usage and on-hand snapshots are taken inside the transaction, not here,
    // so a stale browser value can never be recorded as fact.
    p_items: items.map(omitNullishProperties),
    p_upload_session_id: parsedChecklist.uploadSessionId,
    p_attachments: parsedChecklist.attachments,
    p_committees: parsedChecklist.committees,
    p_annual_plan_reference: annualPlanSubmission.reference,
  })

  const created = unwrapMutation('สร้างใบ PR', result)
  revalidatePurchaseRequest()
  return created
}

/**
 * A submitted PR can only be changed while it is still pending. The RPC locks
 * the row and repeats every contract/item check so an old browser cannot
 * rewrite a PR after a stock officer has already acted on it.
 */
export async function updatePurchaseRequest(
  purchaseRequestId: string,
  input: PurchaseRequestInput,
  checklist?: PurchaseRequestChecklistSubmission,
  annualPlanReferenceInput?: unknown,
) {
  const actor = await requireActor()
  const parsedId = purchaseRequestIdSchema.parse(purchaseRequestId)
  const parsed = purchaseRequestInputSchema.parse(input)
  const existing = await getPurchaseRequest(parsedId)
  if (!existing) throw new Error('ไม่พบใบ PR ที่ต้องการแก้ไข')
  assertPurchaseRequestManager(actor, existing.requesterId)
  const { items, ...request } = parsed

  const legacyAnnualPlan = methodRequiresAnnualPlanReference(existing.purchaseMethod)
    && methodRequiresAnnualPlanReference(parsed.method.kind)
    && existing.purchaseMethod === parsed.method.kind
    && !existing.annualPlanReferenceRequired
  if (existing.checklistPolicyVersion === null || legacyAnnualPlan) {
    const legacyResult = await supabaseAdmin.rpc('update_purchase_request', {
      p_pr_id: parsedId,
      p_actor_id: actor.id,
      p_request: { ...request, headName: actor.name ?? request.headName, fiscalYear: thaiFiscalYear(parsed.requestedDate) },
      p_items: items.map(omitNullishProperties),
    })
    const legacyUpdated = unwrapMutation('แก้ไขใบ PR', legacyResult)
    revalidatePurchaseRequest(parsedId)
    return legacyUpdated
  }

  const annualPlanSubmission = await validateCurrentAnnualPlanSubmission(parsed, annualPlanReferenceInput)
  const parsedChecklist = await verifyPurchaseRequestChecklistUploads({
    actor,
    method: parsed.method.kind,
    contractId: parsed.method.kind === 'contract' ? parsed.method.contractId : null,
    items: parsed.items,
    submission: purchaseRequestChecklistSubmissionSchema.parse(checklist),
    allowExistingAttachments: true,
  })

  // The legacy update_purchase_request_with_checklist RPC remains available
  // (supabaseAdmin.rpc('update_purchase_request_with_checklist', ...))
  // for old integrations; new submissions use the reference-aware wrapper.
  const result = await supabaseAdmin.rpc('update_purchase_request_with_annual_plan_checklist', {
    p_pr_id: parsedId,
    p_actor_id: actor.id,
    p_request: { ...request, method: annualPlanSubmission.method, headName: actor.name ?? request.headName, fiscalYear: thaiFiscalYear(parsed.requestedDate) },
    p_items: items.map(omitNullishProperties),
    p_upload_session_id: parsedChecklist.uploadSessionId,
    p_attachments: parsedChecklist.attachments,
    p_committees: parsedChecklist.committees,
    p_annual_plan_reference: annualPlanSubmission.reference,
  })

  const updated = unwrapMutation('แก้ไขใบ PR', result)
  try {
    await cleanupPurchaseRequestChecklistObjects(parsedId, actor.id, 'edit_removed')
  } catch (error) {
    revalidatePurchaseRequest(parsedId)
    const message = error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ'
    throw new Error(`แก้ไขใบ PR สำเร็จ แต่ล้างไฟล์ที่เปลี่ยนออกไม่สำเร็จ: ${message}`)
  }
  revalidatePurchaseRequest(parsedId)
  return updated
}

/**
 * "ยกเลิก" ในหน้าจอ PR คือการยกเลิกแบบเก็บประวัติไว้ ไม่ลบแถวหรือรายการสินค้า
 * จริง เพื่อให้เลขเอกสารและการตรวจสอบย้อนหลังยังเชื่อถือได้
 */
export async function cancelPurchaseRequest(purchaseRequestId: string) {
  const actor = await requireActor()
  const parsedId = purchaseRequestIdSchema.parse(purchaseRequestId)
  const existing = await getPurchaseRequest(parsedId)
  if (!existing) throw new Error('ไม่พบใบ PR ที่ต้องการยกเลิก')
  assertPurchaseRequestManager(actor, existing.requesterId)

  const result = await supabaseAdmin.rpc('cancel_purchase_request', {
    p_pr_id: parsedId,
    p_actor_id: actor.id,
  })

  const cancelled = unwrapMutation('ยกเลิก PR', result)
  revalidatePurchaseRequest(parsedId)
  return cancelled
}

/**
 * `sentToProcurementDate` is required only when confirming a PR whose method
 * opens a new contract (specific_contract/e_bidding) — it becomes that
 * contract's stage-1 (ส่งพัสดุ) date. An ordinary drawdown PR must not send one;
 * the database rejects it either way, but validating here keeps the caller
 * from mistaking a required field for an optional one.
 */
export async function confirmPurchaseRequest(purchaseRequestId: string, sentToProcurementDate?: string | null) {
  const actor = await requireActor()
  assertStockOperator(actor)
  const parsedId = purchaseRequestIdSchema.parse(purchaseRequestId)
  const parsedDate = sentToProcurementDate ? isoDateSchema.parse(sentToProcurementDate) : null

  const result = await supabaseAdmin.rpc('confirm_purchase_request_with_committees', {
    p_pr_id: parsedId,
    p_actor_id: actor.id,
    p_sent_to_procurement_date: parsedDate,
  })

  const confirmed = unwrapMutation('ยืนยันใบ PR', result)
  revalidatePurchaseRequest(parsedId)
  return confirmed
}

export async function reversePurchaseRequest(
  purchaseRequestId: string,
  input: PurchaseRequestReversalInput,
) {
  const actor = await requireActor()
  assertStockOperator(actor)
  const parsedId = purchaseRequestIdSchema.parse(purchaseRequestId)
  const parsed = purchaseRequestReversalSchema.parse(input)

  const result = await supabaseAdmin.rpc('reverse_purchase_request', {
    p_pr_id: parsedId,
    p_actor_id: actor.id,
    p_reason: parsed.reason,
  })

  const reversed = unwrapMutation('ยกเลิก PR', result)
  revalidatePurchaseRequest(parsedId)
  return reversed
}

export async function closePurchaseRequestRemaining(
  purchaseRequestId: string,
  input: PurchaseRequestShortCloseInput,
) {
  const actor = await requireActor()
  assertStockOperator(actor)
  const parsedId = purchaseRequestIdSchema.parse(purchaseRequestId)
  const parsed = purchaseRequestShortCloseSchema.parse(input)

  const result = await supabaseAdmin.rpc('close_purchase_request_remaining', {
    p_pr_id: parsedId,
    p_actor_id: actor.id,
    p_reason: parsed.reason,
  })

  const closed = unwrapMutation('ปิดยอดคงเหลือของใบ PR', result)
  try {
    // The short-close RPC is already committed. Cleanup failure must remain
    // retryable and must never make the caller believe the PR was reopened.
    await Promise.all([
      cleanupTerminalPurchaseRequestPoFile(parsedId, actor.id, {
        reason: 'closed_short',
        receiptId: null,
      }),
      cleanupPurchaseRequestChecklistObjects(parsedId, actor.id, 'closed_short'),
    ])
  } catch (error) {
    revalidatePurchaseRequest(parsedId)
    const message = error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ'
    throw new Error(`ปิดยอดคงเหลือสำเร็จ แต่การล้างเอกสารหลังปิดยอดไม่สำเร็จ: ${message}`)
  }
  revalidatePurchaseRequest(parsedId)
  return closed
}

export async function receivePurchaseRequestOutsideStock(purchaseRequestId: string) {
  const actor = await requireActor()
  const parsedId = purchaseRequestIdSchema.parse(purchaseRequestId)
  const existing = await getPurchaseRequest(parsedId)
  if (!existing) throw new Error('ไม่พบใบ PR ของหน่วยงาน')
  assertPurchaseRequestOutsideStockReceiver(actor, existing.requesterId)

  const result = await supabaseAdmin.rpc('mark_purchase_request_received_outside_stock', {
    p_pr_id: parsedId,
    p_actor_id: actor.id,
  })

  const received = unwrapMutation('รับของโดยหน่วยงาน', result)
  try {
    await Promise.all([
      cleanupTerminalPurchaseRequestPoFile(parsedId, actor.id, {
        reason: 'received',
        receiptId: null,
      }),
      cleanupPurchaseRequestChecklistObjects(parsedId, actor.id, 'received'),
    ])
  } catch (error) {
    revalidatePurchaseRequest(parsedId)
    const message = error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ'
    throw new Error(`รับของโดยหน่วยงานสำเร็จ แต่การล้างเอกสารหลังรับของไม่สำเร็จ: ${message}`)
  }

  revalidatePurchaseRequest(parsedId)
  return received
}

export async function setPurchaseOrderNumber(
  purchaseRequestId: string,
  input: PurchaseOrderNumberInput,
) {
  const actor = await requireActor()
  assertStockOperator(actor)
  const parsedId = purchaseRequestIdSchema.parse(purchaseRequestId)
  const parsed = purchaseOrderNumberSchema.parse(input)

  const result = await supabaseAdmin.rpc('set_purchase_order_number', {
    p_pr_id: parsedId,
    p_actor_id: actor.id,
    p_po_number: parsed.poNumber,
  })

  if (result.error) {
    return {
      ok: false as const,
      message: formatPurchaseRequestMutationError('บันทึกเลขที่ใบสั่งซื้อ (PO)', result.error.message),
    }
  }

  const updated = unwrapMutation('บันทึกเลขที่ใบสั่งซื้อ (PO)', result)
  revalidatePurchaseRequest(parsedId)
  return { ok: true as const, data: updated }
}

export async function releasePurchaseOrderNumber(
  purchaseRequestId: string,
  input: PurchaseOrderNumberReleaseInput,
) {
  const actor = await requireActor()
  assertStockOperator(actor)
  const parsedId = purchaseRequestIdSchema.parse(purchaseRequestId)
  const parsed = purchaseOrderNumberReleaseSchema.parse(input)

  const result = await supabaseAdmin.rpc('release_purchase_order_number', {
    p_pr_id: parsedId,
    p_actor_id: actor.id,
    p_reason: parsed.reason,
  })

  if (result.error) {
    return {
      ok: false as const,
      message: formatPurchaseRequestMutationError('ปลดเลข PO', result.error.message),
    }
  }

  const released = unwrapMutation('ปลดเลข PO', result)
  revalidatePurchaseRequest(parsedId)
  return { ok: true as const, data: released }
}

export async function setEphisPrNumber(
  purchaseRequestId: string,
  input: EphisPrNumberInput,
) {
  const actor = await requireActor()
  assertStockOperator(actor)
  const parsedId = purchaseRequestIdSchema.parse(purchaseRequestId)
  const parsed = ephisPrNumberSchema.parse(input)

  const result = await supabaseAdmin.rpc('set_ephis_pr_number', {
    p_pr_id: parsedId,
    p_actor_id: actor.id,
    p_ephis_pr_number: parsed.ephisPrNumber,
  })

  const updated = unwrapMutation('บันทึกเลข PR จาก E-Phis', result)
  revalidatePurchaseRequest(parsedId)
  return updated
}
