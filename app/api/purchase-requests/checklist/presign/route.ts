import { PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { NextResponse } from 'next/server'
import { ZodError } from 'zod'
import { getActor } from '@/lib/auth/actor'
import {
  derivePurchaseRequestChecklist,
  purchaseRequestAttachmentSlotKey,
  validatePurchaseRequestAttachment,
} from '@/lib/pr/checklist'
import { purchaseRequestChecklistPresignSchema } from '@/lib/pr/checklist-schema'
import { buildPurchaseRequestChecklistUploadKey } from '@/lib/pr/checklist-storage'
import { canUploadPurchaseRequestChecklist } from '@/lib/pr/authorization'
import { getR2BucketName, getR2Client } from '@/lib/r2/client'
import { supabaseAdmin } from '@/lib/supabase/admin'

const SIGNED_UPLOAD_TTL_SECONDS = 300
const UPLOAD_TICKET_TTL_MS = 60 * 60 * 1000

export async function POST(request: Request) {
  try {
    const actor = await getActor()
    if (!actor) return NextResponse.json({ error: 'กรุณาเข้าสู่ระบบ' }, { status: 401 })
    if (!canUploadPurchaseRequestChecklist(actor)) {
      return NextResponse.json({ error: 'ไม่มีสิทธิ์อัปโหลดเอกสารใบ PR' }, { status: 403 })
    }

    const input = purchaseRequestChecklistPresignSchema.parse(await request.json())
    const policy = derivePurchaseRequestChecklist(input.method, input.total)
    const slotKey = purchaseRequestAttachmentSlotKey(input.kind, input.slot)
    if (!policy.attachments.some((requirement) => purchaseRequestAttachmentSlotKey(requirement.kind, requirement.slot) === slotKey)) {
      return NextResponse.json({ error: 'ช่องเอกสารนี้ไม่ตรงกับวิธีจัดซื้อและยอดรวมปัจจุบัน' }, { status: 422 })
    }

    const validationErrors = validatePurchaseRequestAttachment({
      kind: input.kind,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
    })
    if (validationErrors.length > 0) {
      return NextResponse.json({ error: validationErrors.join(' · ') }, { status: 422 })
    }

    const storageKey = buildPurchaseRequestChecklistUploadKey({
      actorId: actor.id,
      sessionId: input.uploadSessionId,
      fileName: input.fileName,
    })
    const ticketExpiresAt = new Date(Date.now() + UPLOAD_TICKET_TTL_MS).toISOString()
    const ticketResult = await supabaseAdmin.rpc('register_purchase_request_checklist_upload', {
      p_actor_id: actor.id,
      p_upload_session_id: input.uploadSessionId,
      p_attachment_kind: input.kind,
      p_slot: input.slot,
      p_storage_key: storageKey,
      p_file_name: input.fileName,
      p_mime_type: input.mimeType,
      p_size_bytes: input.sizeBytes,
      p_expires_at: ticketExpiresAt,
    })
    if (ticketResult.error) throw new Error(ticketResult.error.message)

    const ticket = ticketResult.data as { id?: unknown }
    if (typeof ticket?.id !== 'string') throw new Error('ระบบไม่ได้รับเลขอ้างอิงการอัปโหลด')

    const uploadUrl = await getSignedUrl(
      getR2Client(),
      new PutObjectCommand({
        Bucket: getR2BucketName(),
        Key: storageKey,
        ContentType: input.mimeType,
        IfNoneMatch: '*',
      }),
      { expiresIn: 300 },
    )

    return NextResponse.json({
      uploadId: ticket.id,
      uploadUrl,
      storageKey,
      headers: { 'Content-Type': input.mimeType, 'If-None-Match': '*' },
      signedUrlExpiresAt: new Date(Date.now() + SIGNED_UPLOAD_TTL_SECONDS * 1000).toISOString(),
      ticketExpiresAt,
    })
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message ?? 'ข้อมูลไฟล์ไม่ถูกต้อง' }, { status: 422 })
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'สร้างลิงก์อัปโหลดไม่สำเร็จ' },
      { status: 500 },
    )
  }
}
