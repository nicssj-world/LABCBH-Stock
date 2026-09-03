'use server'

import { DeleteObjectCommand } from '@aws-sdk/client-s3'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { isAdministrator } from '@/lib/auth/access'
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
import { canRecordPurchaseRequestExpense } from '@/lib/pr/expense'
import {
  DUPLICATE_PURCHASE_REQUEST_INVOICE_MESSAGE,
  PURCHASE_CREDIT_NOTE_AMOUNT_EXCEEDS_SOURCE_MESSAGE,
  PURCHASE_CREDIT_NOTE_NUMBER_REQUIRED_MESSAGE,
  PURCHASE_CREDIT_NOTE_SOURCE_INVALID_MESSAGE,
  PURCHASE_EXPENSE_CEILING_MESSAGE,
  PURCHASE_EXPENSE_REQUIRES_PO_MESSAGE,
  PURCHASE_INVOICE_BELOW_ACTIVE_CREDITS_MESSAGE,
  PURCHASE_INVOICE_HAS_ACTIVE_CREDIT_NOTES_MESSAGE,
  isPurchaseRequestExpenseDuplicateError,
  purchaseRequestExpenseCancelSchema,
  purchaseRequestExpenseInputSchema,
  purchaseRequestExpenseUpdateSchema,
} from '@/lib/pr/expense'
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
import { PO_IMAGE_BUCKET, isPurchaseRequestPoFilePathAllowed } from '@/lib/po/storage'
import { isPurchaseRequestChecklistStorageKey } from '@/lib/pr/checklist-storage'
import { getR2BucketName, getR2Client } from '@/lib/r2/client'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { enqueueStorageCleanupJobBestEffort } from '@/lib/storage/cleanup-jobs'
import { omitNullishProperties } from '@/lib/validation/json'
import { formatPurchaseRequestMutationError, type PurchaseRequestActionError } from './errors'
import { cleanupPurchaseRequestChecklistObjects } from './checklist-cleanup'

const purchaseRequestIdSchema = z.string().uuid()

interface PurchaseRequestHardDeleteFile {
  storageBackend: 'r2' | 'supabase_storage'
  bucketName: string
  storageKey: string
}

async function removeHardDeletedPurchaseRequestFiles({
  purchaseRequestId,
  fiscalYear,
  r2Paths,
  supabaseStoragePaths,
}: {
  purchaseRequestId: string
  fiscalYear: number
  r2Paths: string[]
  supabaseStoragePaths: string[]
}) {
  const uniqueR2Paths = [...new Set(r2Paths)]
  const uniqueSupabaseStoragePaths = [...new Set(supabaseStoragePaths)]

  if (uniqueR2Paths.some((path) => !isPurchaseRequestChecklistStorageKey(path))) {
    throw new Error('พบเส้นทางไฟล์ checklist ของ PR ที่ไม่ถูกต้อง จึงหยุดการลบไฟล์เพื่อความปลอดภัย')
  }
  if (uniqueSupabaseStoragePaths.some((path) => !isPurchaseRequestPoFilePathAllowed(path, fiscalYear, purchaseRequestId))) {
    throw new Error('พบเส้นทางไฟล์ PO ของ PR ที่ไม่ถูกต้อง จึงหยุดการลบไฟล์เพื่อความปลอดภัย')
  }

  const r2Files: PurchaseRequestHardDeleteFile[] = uniqueR2Paths.map((storageKey) => ({
    storageBackend: 'r2',
    bucketName: '__r2__',
    storageKey,
  }))
  const supabaseStorageFiles: PurchaseRequestHardDeleteFile[] = uniqueSupabaseStoragePaths.map((storageKey) => ({
    storageBackend: 'supabase_storage',
    bucketName: PO_IMAGE_BUCKET,
    storageKey,
  }))
  const failedFiles: PurchaseRequestHardDeleteFile[] = []

  for (const file of r2Files) {
    try {
      await getR2Client().send(new DeleteObjectCommand({
        Bucket: getR2BucketName(),
        Key: file.storageKey,
      }))
    } catch (error) {
      failedFiles.push(file)
      console.error('ลบไฟล์ checklist ของ PR หลัง hard delete ไม่สำเร็จ', {
        purchaseRequestId,
        storageKey: file.storageKey,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  for (let index = 0; index < supabaseStorageFiles.length; index += 100) {
    const batch = supabaseStorageFiles.slice(index, index + 100)
    try {
      const removed = await supabaseAdmin.storage
        .from(PO_IMAGE_BUCKET)
        .remove(batch.map((file) => file.storageKey))
      if (removed.error) {
        failedFiles.push(...batch)
        console.error('ลบไฟล์ PO ของ PR หลัง hard delete ไม่สำเร็จ', {
          purchaseRequestId,
          paths: batch.map((file) => file.storageKey),
          error: removed.error.message,
        })
      }
    } catch (error) {
      failedFiles.push(...batch)
      console.error('ลบไฟล์ PO ของ PR หลัง hard delete ไม่สำเร็จ', {
        purchaseRequestId,
        paths: batch.map((file) => file.storageKey),
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  for (const file of failedFiles) {
    await enqueueStorageCleanupJobBestEffort({
      storageBackend: file.storageBackend,
      bucketName: file.bucketName,
      storageKey: file.storageKey,
      jobKind: 'storage_upload_rollback',
    })
  }

  return failedFiles
}

function unwrapMutation(
  operation: string,
  result: {
    data: unknown
    error: { code?: string | null; message: string; details?: string | null; hint?: string | null } | null
  },
  context: { actionRequestId?: string } = {},
) {
  if (result.error) {
    // Keep the complete Supabase error in the server log. The client only
    // receives the safe Thai copy below, while code/details/hint make the
    // recurring production failures diagnosable.
    console.error('Purchase request RPC mutation failed', {
      operation,
      actionRequestId: context.actionRequestId ?? null,
      data: result.data,
      error: result.error,
    })
    throw new Error(formatPurchaseRequestMutationError(operation, result.error.message))
  }
  return z.object({ id: z.string().uuid() }).passthrough().parse(result.data)
}

function describePurchaseRequestActionError(error: unknown) {
  if (error instanceof z.ZodError) {
    return {
      name: error.name,
      message: error.message,
      issues: error.issues,
    }
  }
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    }
  }
  if (error && typeof error === 'object') {
    const value = error as Record<string, unknown>
    return {
      name: typeof value.name === 'string' ? value.name : 'UnknownError',
      message: typeof value.message === 'string' ? value.message : String(error),
      code: value.code ?? null,
      details: value.details ?? null,
      hint: value.hint ?? null,
    }
  }
  return { name: 'UnknownError', message: String(error) }
}

function purchaseRequestActionError(
  operation: string,
  actionRequestId: string,
  error: unknown,
  context: { actorId?: string | null; methodKind?: string | null; purchaseRequestId?: string } = {},
): PurchaseRequestActionError {
  const details = describePurchaseRequestActionError(error)
  console.error('Purchase request action failed', {
    operation,
    actionRequestId,
    ...context,
    error: details,
  })
  const message = error instanceof z.ZodError
    ? `${operation}ไม่สำเร็จ กรุณาตรวจสอบข้อมูลที่กรอกและเอกสารแนบแล้วลองใหม่`
    : error instanceof Error && error.message.trim()
      ? error.message
      : `${operation}ไม่สำเร็จ กรุณาลองใหม่`
  return { ok: false, message }
}

function unwrapPurchaseRequestExpenseMutation(
  operation: string,
  result: { data: unknown; error: { code?: string | null; message: string; details?: string | null; hint?: string | null } | null },
) {
  if (result.error) {
    if (isPurchaseRequestExpenseDuplicateError(result.error)) throw new Error(DUPLICATE_PURCHASE_REQUEST_INVOICE_MESSAGE)
    const message = result.error.message ?? ''
    if (message.includes('credit note number is required')) throw new Error(PURCHASE_CREDIT_NOTE_NUMBER_REQUIRED_MESSAGE)
    if (message.includes('credit note source invoice not found or inactive')) throw new Error(PURCHASE_CREDIT_NOTE_SOURCE_INVALID_MESSAGE)
    if (message.includes('credit note exceeds remaining source invoice amount')) throw new Error(PURCHASE_CREDIT_NOTE_AMOUNT_EXCEEDS_SOURCE_MESSAGE)
    if (message.includes('active expenses exceed PR ceiling')) throw new Error(PURCHASE_EXPENSE_CEILING_MESSAGE)
    if (message.includes('purchase PR must be confirmed and have PO evidence')) throw new Error(PURCHASE_EXPENSE_REQUIRES_PO_MESSAGE)
    if (message.includes('invoice cannot be reduced below active credit notes')) throw new Error(PURCHASE_INVOICE_BELOW_ACTIVE_CREDITS_MESSAGE)
    if (message.includes('invoice with active credit notes cannot be cancelled')) throw new Error(PURCHASE_INVOICE_HAS_ACTIVE_CREDIT_NOTES_MESSAGE)
    throw new Error(`${operation}ไม่สำเร็จ: ${result.error.message}`)
  }
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
  const actionRequestId = crypto.randomUUID()
  let actorId: string | null = null
  let methodKind: string | null = null
  try {
    const actor = await requireActor()
    actorId = actor.id
    assertPurchaseRequester(actor)
    const parsed = purchaseRequestInputSchema.parse(input)
    methodKind = parsed.method.kind
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

    const created = unwrapMutation('สร้างใบ PR', result, { actionRequestId })
    revalidatePurchaseRequest()
    return created
  } catch (error) {
    return purchaseRequestActionError('สร้างใบ PR', actionRequestId, error, { actorId, methodKind })
  }
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
  const actionRequestId = crypto.randomUUID()
  let actorId: string | null = null
  let methodKind: string | null = null
  let parsedId: string | null = null
  try {
    const actor = await requireActor()
    actorId = actor.id
    parsedId = purchaseRequestIdSchema.parse(purchaseRequestId)
    const parsed = purchaseRequestInputSchema.parse(input)
    methodKind = parsed.method.kind
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
      const legacyUpdated = unwrapMutation('แก้ไขใบ PR', legacyResult, { actionRequestId })
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

    const updated = unwrapMutation('แก้ไขใบ PR', result, { actionRequestId })
    try {
      await cleanupPurchaseRequestChecklistObjects(parsedId, actor.id, 'edit_removed')
    } catch (error) {
      revalidatePurchaseRequest(parsedId)
      const message = error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ'
      throw new Error(`แก้ไขใบ PR สำเร็จ แต่ล้างไฟล์ที่เปลี่ยนออกไม่สำเร็จ: ${message}`)
    }
    revalidatePurchaseRequest(parsedId)
    return updated
  } catch (error) {
    return purchaseRequestActionError('แก้ไขใบ PR', actionRequestId, error, {
      actorId,
      methodKind,
      purchaseRequestId: parsedId ?? undefined,
    })
  }
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
 * Hard deletion is intentionally a separate administrator-only operation.
 * The database removes the PR graph atomically; storage objects are removed
 * immediately afterwards and queued for retry if an external storage call
 * fails.
 */
export async function hardDeletePurchaseRequest(purchaseRequestId: string) {
  const actor = await requireActor()
  if (!isAdministrator(actor)) throw new Error('เฉพาะผู้ดูแลระบบเท่านั้นที่ลบใบ PR ถาวรได้')

  const parsedId = purchaseRequestIdSchema.parse(purchaseRequestId)
  const result = await supabaseAdmin.rpc('hard_delete_purchase_request', {
    p_pr_id: parsedId,
    p_actor_id: actor.id,
  })
  if (result.error) {
    return {
      ok: false as const,
      message: formatPurchaseRequestMutationError('ลบใบ PR ถาวร', result.error.message),
    }
  }

  const deleted = z.object({
    id: z.string().uuid(),
    deleted: z.literal(true),
    fiscalYear: z.number().int(),
    r2Paths: z.array(z.string()),
    supabaseStoragePaths: z.array(z.string()),
  }).parse(result.data)

  // Refresh the list as soon as the transaction has committed. Storage cleanup
  // is an external side effect and may need the durable retry queue.
  revalidatePurchaseRequest(parsedId)
  const failedFiles = await removeHardDeletedPurchaseRequestFiles({
    purchaseRequestId: deleted.id,
    fiscalYear: deleted.fiscalYear,
    r2Paths: deleted.r2Paths,
    supabaseStoragePaths: deleted.supabaseStoragePaths,
  })
  if (failedFiles.length > 0) {
    return {
      ok: false as const,
      message: `ลบใบ PR ถาวรแล้ว แต่ยังรอลบไฟล์ ${failedFiles.length} รายการ ระบบจะลองลบให้อัตโนมัติอีกครั้ง`,
    }
  }

  return {
    ok: true as const,
    data: {
      id: deleted.id,
      deleted: true,
      deletedFileCount: deleted.r2Paths.length + deleted.supabaseStoragePaths.length,
    },
  }
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

export async function recordPurchaseRequestExpense(input: unknown) {
  const actor = await requireActor()
  const parsed = purchaseRequestExpenseInputSchema.parse(input)
  const request = await getPurchaseRequest(parsed.requestId)
  if (!request) throw new Error('ไม่พบใบ PR ที่ต้องการบันทึกค่าใช้จ่าย')
  assertPurchaseRequestManager(actor, request.requesterId)
  if (!canRecordPurchaseRequestExpense({
    status: request.status,
    purchaseMethod: request.purchaseMethod,
    poNumber: request.poNumber,
    poFileName: request.poFile.fileName,
  })) {
    throw new Error(PURCHASE_EXPENSE_REQUIRES_PO_MESSAGE)
  }

  const result = await supabaseAdmin.rpc('record_purchase_request_expense', {
    p_actor_id: actor.id,
    p_request_id: parsed.requestId,
    p_expense_date: parsed.expenseDate,
    p_amount: parsed.amount,
    p_invoice_number: parsed.invoiceNumber,
    p_note: parsed.note,
    p_document_kind: parsed.documentType,
    p_source_expense_id: parsed.sourceExpenseId,
  })
  const expense = unwrapPurchaseRequestExpenseMutation('บันทึกค่าใช้จ่าย PR จัดซื้อ', result)
  revalidatePurchaseRequest(parsed.requestId)
  return expense
}

export async function updatePurchaseRequestExpense(input: unknown) {
  const actor = await requireActor()
  const parsed = purchaseRequestExpenseUpdateSchema.parse(input)
  const request = await getPurchaseRequest(parsed.requestId)
  if (!request) throw new Error('ไม่พบใบ PR ที่ต้องการแก้ไขค่าใช้จ่าย')
  assertPurchaseRequestManager(actor, request.requesterId)
  if (!canRecordPurchaseRequestExpense({
    status: request.status,
    purchaseMethod: request.purchaseMethod,
    poNumber: request.poNumber,
    poFileName: request.poFile.fileName,
  })) {
    throw new Error(PURCHASE_EXPENSE_REQUIRES_PO_MESSAGE)
  }
  const existing = request.expenseEvents.find((event) => event.id === parsed.expenseId)
  if (!existing) throw new Error('ไม่พบรายการค่าใช้จ่ายที่ต้องการแก้ไข')
  if (existing.documentType !== parsed.documentType || existing.sourceExpenseId !== parsed.sourceExpenseId) {
    throw new Error('ประเภทเอกสารและ Invoice ต้นทางแก้ไขไม่ได้')
  }

  const result = await supabaseAdmin.rpc('update_purchase_request_expense', {
    p_actor_id: actor.id,
    p_request_id: parsed.requestId,
    p_expense_id: parsed.expenseId,
    p_expense_date: parsed.expenseDate,
    p_amount: parsed.amount,
    p_invoice_number: parsed.invoiceNumber,
    p_note: parsed.note,
    p_reason: parsed.reason,
  })
  const expense = unwrapPurchaseRequestExpenseMutation('แก้ไขค่าใช้จ่าย PR จัดซื้อ', result)
  revalidatePurchaseRequest(parsed.requestId)
  return expense
}

export async function cancelPurchaseRequestExpense(input: unknown) {
  const actor = await requireActor()
  const parsed = purchaseRequestExpenseCancelSchema.parse(input)
  const request = await getPurchaseRequest(parsed.requestId)
  if (!request) throw new Error('ไม่พบใบ PR ที่ต้องการยกเลิกค่าใช้จ่าย')
  assertPurchaseRequestManager(actor, request.requesterId)
  if (!canRecordPurchaseRequestExpense({
    status: request.status,
    purchaseMethod: request.purchaseMethod,
    poNumber: request.poNumber,
    poFileName: request.poFile.fileName,
  })) {
    throw new Error(PURCHASE_EXPENSE_REQUIRES_PO_MESSAGE)
  }

  const result = await supabaseAdmin.rpc('cancel_purchase_request_expense', {
    p_actor_id: actor.id,
    p_request_id: parsed.requestId,
    p_expense_id: parsed.expenseId,
    p_reason: parsed.reason,
  })
  const expense = unwrapPurchaseRequestExpenseMutation('ยกเลิกค่าใช้จ่าย PR จัดซื้อ', result)
  revalidatePurchaseRequest(parsed.requestId)
  return expense
}
