'use server'

import { createHash } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireActor } from '@/lib/auth/actor'
import { assertStockOperator } from '@/lib/inventory/authorization'
import { assertPurchaseRequestOutsideStockReceiver } from '@/lib/pr/authorization'
import {
  isLegacyReceiptPoImagePathAllowed,
  isPoFileTypeAllowed,
  isPurchaseRequestPoFilePathAllowed,
  PO_IMAGE_BUCKET,
  PO_MAX_FILE_SIZE_BYTES,
  buildPurchaseRequestPoFilePath,
} from '@/lib/po/storage'
import { cleanupTerminalPurchaseRequestPoFile } from '@/lib/po/cleanup'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { enqueueStorageCleanupJobBestEffort } from '@/lib/storage/cleanup-jobs'

const purchaseRequestIdSchema = z.string().uuid()

const purchaseRequestFileRowSchema = z.object({
  id: z.string().uuid(),
  fiscal_year: z.number().int(),
  status: z.string(),
  po_number: z.string().nullable(),
  po_file_path: z.string().nullable(),
  requester_id: z.string().uuid().nullable(),
  outside_stock_received_at: z.string().nullable(),
})

const visiblePurchaseRequestRowSchema = z.object({ id: z.string().uuid() })

const purchaseRequestPoFileReadRowSchema = z.object({
  id: z.string().uuid(),
  fiscal_year: z.number().int(),
  po_file_path: z.string().nullable(),
  po_file_name: z.string().nullable(),
  po_file_mime_type: z.string().nullable(),
})

const legacyPathRowSchema = z.object({
  id: z.string().uuid(),
  fiscal_year: z.number().int(),
  po_image_path: z.string().nullable(),
})

const postedReceiptRowSchema = z.object({ id: z.string().uuid() })

function revalidatePurchaseRequest(purchaseRequestId: string) {
  revalidatePath(`/purchase-requests/${purchaseRequestId}`)
  revalidatePath('/purchase-requests')
}

function checksumFor(buffer: ArrayBuffer): string {
  return createHash('sha256').update(Buffer.from(buffer)).digest('hex')
}

function assertOpenPurchaseRequest(request: z.infer<typeof purchaseRequestFileRowSchema>) {
  if (!['completed', 'partially_received'].includes(request.status)) {
    throw new Error('แนบไฟล์ PO ได้เฉพาะใบ PR ที่ยังเปิดรับเข้า')
  }
  if (!request.po_number?.trim()) {
    throw new Error('กรุณาบันทึกเลขที่ใบสั่งซื้อ (PO) ก่อนแนบไฟล์')
  }
}

async function readPurchaseRequestFileRow(purchaseRequestId: string) {
  const { data, error } = await supabaseAdmin
    .from('purchase_requests')
    .select('id, fiscal_year, status, po_number, po_file_path, requester_id, outside_stock_received_at')
    .eq('id', purchaseRequestId)
    .maybeSingle()

  if (error) throw new Error(`อ่านข้อมูลใบ PR ไม่สำเร็จ: ${error.message}`)
  if (!data) throw new Error('ไม่พบใบ PR ที่ระบุ')
  return purchaseRequestFileRowSchema.parse(data)
}

export async function uploadPurchaseRequestPoFile(
  purchaseRequestId: string,
  formData: FormData,
): Promise<{ path: string }> {
  const actor = await requireActor()
  assertStockOperator(actor)
  const parsedId = purchaseRequestIdSchema.parse(purchaseRequestId)

  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) {
    throw new Error('กรุณาเลือกไฟล์ PO')
  }
  if (!isPoFileTypeAllowed(file.type)) {
    throw new Error('ไฟล์ PO ต้องเป็น JPG, PNG, WEBP หรือ PDF')
  }
  if (file.size > PO_MAX_FILE_SIZE_BYTES) {
    throw new Error('ไฟล์ PO ต้องมีขนาดไม่เกิน 10 MB')
  }

  const request = await readPurchaseRequestFileRow(parsedId)
  assertOpenPurchaseRequest(request)

  const path = buildPurchaseRequestPoFilePath({
    fiscalYear: request.fiscal_year,
    purchaseRequestId: parsedId,
    fileName: file.name,
  })
  if (!isPurchaseRequestPoFilePathAllowed(path, request.fiscal_year, parsedId)) {
    throw new Error('เส้นทางไฟล์ไม่ถูกต้อง')
  }

  const checksum = checksumFor(await file.arrayBuffer())
  const { error: uploadError } = await supabaseAdmin.storage
    .from(PO_IMAGE_BUCKET)
    .upload(path, file, { upsert: false, contentType: file.type })

  if (uploadError) throw new Error(`อัปโหลดไฟล์ PO ไม่สำเร็จ: ${uploadError.message}`)

  const result = await supabaseAdmin.rpc('set_purchase_request_po_file', {
    p_pr_id: parsedId,
    p_actor_id: actor.id,
    p_po_file_path: path,
    p_file_name: file.name,
    p_file_mime_type: file.type,
    p_file_size_bytes: file.size,
    p_file_checksum: checksum,
  })

  if (result.error) {
    const { error: cleanupError } = await supabaseAdmin.storage
      .from(PO_IMAGE_BUCKET)
      .remove([path])
    if (cleanupError) {
      console.error(`ล้างไฟล์ PO ที่บันทึกไม่สำเร็จไม่ได้: ${cleanupError.message}`, { path })
      await enqueueStorageCleanupJobBestEffort({
        storageBackend: 'supabase_storage',
        bucketName: PO_IMAGE_BUCKET,
        storageKey: path,
        jobKind: 'storage_upload_rollback',
      })
    }
    throw new Error(`บันทึกไฟล์ PO ไม่สำเร็จ: ${result.error.message}`)
  }

  revalidatePurchaseRequest(parsedId)
  return { path }
}

async function assertPurchaseRequestVisible(purchaseRequestId: string) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('purchase_requests')
    .select('id')
    .eq('id', purchaseRequestId)
    .maybeSingle()

  if (error) throw new Error(`อ่านสิทธิ์การดูไฟล์ PO ไม่สำเร็จ: ${error.message}`)
  if (!data) throw new Error('ไม่พบใบ PR ที่ระบุ')
  return visiblePurchaseRequestRowSchema.parse(data)
}

async function isAllowedStoredPath(purchaseRequestId: string, path: string, fiscalYear: number) {
  if (isPurchaseRequestPoFilePathAllowed(path, fiscalYear, purchaseRequestId)) return true

  const { data, error } = await supabaseAdmin
    .from('goods_receipts')
    .select('id, fiscal_year, po_image_path')
    .eq('purchase_request_id', purchaseRequestId)
    .not('po_image_path', 'is', null)

  if (error) throw new Error(`ตรวจสอบเส้นทางไฟล์ PO เดิมไม่สำเร็จ: ${error.message}`)
  return legacyPathRowSchema.array().parse(data ?? []).some(
    (receipt) => receipt.po_image_path === path && isLegacyReceiptPoImagePathAllowed(path, receipt.fiscal_year, receipt.id),
  )
}

async function readPurchaseRequestPoFile(purchaseRequestId: string) {
  const parsedId = purchaseRequestIdSchema.parse(purchaseRequestId)
  await assertPurchaseRequestVisible(parsedId)

  const { data, error } = await supabaseAdmin
    .from('purchase_requests')
    .select('id, fiscal_year, po_file_path, po_file_name, po_file_mime_type')
    .eq('id', parsedId)
    .maybeSingle()
  if (error) throw new Error(`อ่านไฟล์ PO ไม่สำเร็จ: ${error.message}`)

  const row = purchaseRequestPoFileReadRowSchema.nullable().parse(data)
  if (!row?.po_file_path) return null
  if (!(await isAllowedStoredPath(parsedId, row.po_file_path, row.fiscal_year))) {
    throw new Error('เส้นทางไฟล์ PO ไม่ถูกต้อง')
  }

  return {
    purchaseRequestId: parsedId,
    path: row.po_file_path,
    fileName: row.po_file_name,
    mimeType: row.po_file_mime_type,
  }
}

export async function getPurchaseRequestPoFileMetadata(purchaseRequestId: string) {
  await requireActor()
  return readPurchaseRequestPoFile(purchaseRequestId)
}

export async function getPurchaseRequestPoFileUrl(
  purchaseRequestId: string,
): Promise<string | null> {
  await requireActor()
  const parsedId = purchaseRequestIdSchema.parse(purchaseRequestId)
  await assertPurchaseRequestVisible(parsedId)

  const { data, error } = await supabaseAdmin
    .from('purchase_requests')
    .select('id, fiscal_year, po_file_path')
    .eq('id', parsedId)
    .maybeSingle()

  if (error) throw new Error(`อ่านไฟล์ PO ไม่สำเร็จ: ${error.message}`)
  const row = z.object({ id: z.string().uuid(), fiscal_year: z.number().int(), po_file_path: z.string().nullable() }).nullable().parse(data)
  if (!row?.po_file_path) return null
  if (!(await isAllowedStoredPath(parsedId, row.po_file_path, row.fiscal_year))) {
    throw new Error('เส้นทางไฟล์ไม่ถูกต้อง')
  }

  const { data: signed, error: signError } = await supabaseAdmin.storage
    .from(PO_IMAGE_BUCKET)
    .createSignedUrl(row.po_file_path, 300)
  if (signError) throw new Error(`สร้างลิงก์ดูไฟล์ PO ไม่สำเร็จ: ${signError.message}`)
  return signed?.signedUrl ?? null
}

export async function retryPurchaseRequestPoFileCleanup(
  purchaseRequestId: string,
): Promise<void> {
  const actor = await requireActor()
  const parsedId = purchaseRequestIdSchema.parse(purchaseRequestId)
  const request = await readPurchaseRequestFileRow(parsedId)

  if (request.outside_stock_received_at) {
    assertPurchaseRequestOutsideStockReceiver(actor, request.requester_id)
  } else {
    assertStockOperator(actor)
  }

  if (!['received', 'closed_short'].includes(request.status)) {
    throw new Error('ใบ PR ยังไม่อยู่ในสถานะสิ้นสุดสำหรับการล้างไฟล์ PO')
  }

  let receiptId: string | null = null
  if (request.status === 'received') {
    const { data, error } = await supabaseAdmin
      .from('goods_receipts')
      .select('id')
      .eq('purchase_request_id', parsedId)
      .eq('status', 'posted')
      .order('received_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) throw new Error(`อ่านใบรับเข้าที่ปิด PR ไม่สำเร็จ: ${error.message}`)
    receiptId = data ? postedReceiptRowSchema.parse(data).id : null
  }

  const reason: 'received' | 'closed_short' = request.status === 'received' ? 'received' : 'closed_short'
  await cleanupTerminalPurchaseRequestPoFile(parsedId, actor.id, {
    reason,
    receiptId,
  })
  revalidatePurchaseRequest(parsedId)
}
