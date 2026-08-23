import 'server-only'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import {
  isLegacyReceiptPoImagePathAllowed,
  isPurchaseRequestPoFilePathAllowed,
  PO_IMAGE_BUCKET,
} from './storage'
import { supabaseAdmin } from '@/lib/supabase/admin'

const purchaseRequestCleanupRowSchema = z.object({
  id: z.string().uuid(),
  fiscal_year: z.number().int(),
  status: z.string(),
  po_file_path: z.string().nullable(),
  po_file_deleted_at: z.string().nullable(),
})

const legacyReceiptPathRowSchema = z.object({
  id: z.string().uuid(),
  fiscal_year: z.number().int(),
  po_image_path: z.string().nullable(),
})

const postedReceiptRowSchema = z.object({
  id: z.string().uuid(),
  purchase_request_id: z.string().uuid().nullable(),
})

function isMissingStorageObject(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const candidate = error as { statusCode?: number | string; message?: string }
  return (
    String(candidate.statusCode ?? '') === '404' ||
    /not found|does not exist|object not found|no such object/i.test(candidate.message ?? '')
  )
}

function revalidateCleanupPaths(purchaseRequestId: string, receiptId: string | null) {
  revalidatePath(`/purchase-requests/${purchaseRequestId}`)
  revalidatePath('/purchase-requests')
  revalidatePath('/receipts')
  revalidatePath('/dashboard')
  revalidatePath('/inventory')
  if (receiptId) revalidatePath(`/receipts/${receiptId}`)
}

async function readCleanupRows(purchaseRequestId: string) {
  const [{ data: request, error: requestError }, { data: receipts, error: receiptsError }] = await Promise.all([
    supabaseAdmin
      .from('purchase_requests')
      .select('id, fiscal_year, status, po_file_path, po_file_deleted_at')
      .eq('id', purchaseRequestId)
      .maybeSingle(),
    supabaseAdmin
      .from('goods_receipts')
      .select('id, fiscal_year, po_image_path')
      .eq('purchase_request_id', purchaseRequestId)
      .not('po_image_path', 'is', null),
  ])

  if (requestError) throw new Error(`อ่านข้อมูลไฟล์ PO ของใบ PR ไม่สำเร็จ: ${requestError.message}`)
  if (receiptsError) throw new Error(`อ่านไฟล์ PO เดิมของใบรับเข้าไม่สำเร็จ: ${receiptsError.message}`)
  if (!request) throw new Error('ไม่พบใบ PR ที่ระบุ')

  return {
    request: purchaseRequestCleanupRowSchema.parse(request),
    receipts: legacyReceiptPathRowSchema.array().parse(receipts ?? []),
  }
}

function validateCleanupPaths(
  purchaseRequestId: string,
  request: z.infer<typeof purchaseRequestCleanupRowSchema>,
  receipts: z.infer<typeof legacyReceiptPathRowSchema>[],
): string[] {
  const paths = new Set<string>()

  if (request.po_file_path) {
    const isPrPath = isPurchaseRequestPoFilePathAllowed(
      request.po_file_path,
      request.fiscal_year,
      purchaseRequestId,
    )
    const legacyOwner = receipts.find(
      (receipt) => receipt.po_image_path === request.po_file_path,
    )
    const isLegacyPath = Boolean(
      legacyOwner &&
        isLegacyReceiptPoImagePathAllowed(request.po_file_path, legacyOwner.fiscal_year, legacyOwner.id),
    )
    if (!isPrPath && !isLegacyPath) {
      throw new Error('เส้นทางไฟล์ PO ของใบ PR ไม่ถูกต้อง')
    }
    paths.add(request.po_file_path)
  }

  for (const receipt of receipts) {
    if (!receipt.po_image_path) continue
    if (!isLegacyReceiptPoImagePathAllowed(receipt.po_image_path, receipt.fiscal_year, receipt.id)) {
      throw new Error('เส้นทางไฟล์ PO ของใบรับเข้าไม่ถูกต้อง')
    }
    paths.add(receipt.po_image_path)
  }

  return [...paths]
}

export async function cleanupTerminalPurchaseRequestPoFile(
  purchaseRequestId: string,
  actorId: string,
  input: {
    reason: 'received' | 'closed_short'
    receiptId: string | null
  },
): Promise<void> {
  const { request, receipts } = await readCleanupRows(purchaseRequestId)
  if (!['received', 'closed_short'].includes(request.status)) return
  if (request.status !== input.reason) return

  const paths = validateCleanupPaths(purchaseRequestId, request, receipts)
  if (paths.length > 0) {
    const { error } = await supabaseAdmin.storage.from(PO_IMAGE_BUCKET).remove(paths)
    if (error && !isMissingStorageObject(error)) {
      throw new Error(`ล้างไฟล์ PO ไม่สำเร็จ: ${error.message}`)
    }
  }

  const { error: clearError } = await supabaseAdmin.rpc('clear_purchase_request_po_file', {
    p_pr_id: purchaseRequestId,
    p_actor_id: actorId,
    p_deletion_reason: input.reason,
    p_receipt_id: input.receiptId,
  })
  if (clearError) throw new Error(`บันทึกประวัติการล้างไฟล์ PO ไม่สำเร็จ: ${clearError.message}`)

  revalidateCleanupPaths(purchaseRequestId, input.receiptId)
}

export async function cleanupPoFileAfterPostedReceipt(
  receiptId: string,
  actorId: string,
): Promise<void> {
  const { data: receipt, error: receiptError } = await supabaseAdmin
    .from('goods_receipts')
    .select('id, purchase_request_id')
    .eq('id', receiptId)
    .maybeSingle()

  if (receiptError) throw new Error(`อ่านใบรับเข้าเพื่อดูแลไฟล์ PO ไม่สำเร็จ: ${receiptError.message}`)
  if (!receipt) throw new Error('ไม่พบใบรับเข้าที่ระบุ')

  const parsedReceipt = postedReceiptRowSchema.parse(receipt)
  if (!parsedReceipt.purchase_request_id) return

  const { data: request, error: requestError } = await supabaseAdmin
    .from('purchase_requests')
    .select('status')
    .eq('id', parsedReceipt.purchase_request_id)
    .maybeSingle()

  if (requestError) throw new Error(`อ่านสถานะใบ PR เพื่อดูแลไฟล์ PO ไม่สำเร็จ: ${requestError.message}`)
  if (request?.status !== 'received') return

  await cleanupTerminalPurchaseRequestPoFile(parsedReceipt.purchase_request_id, actorId, {
    reason: 'received',
    receiptId,
  })
}
