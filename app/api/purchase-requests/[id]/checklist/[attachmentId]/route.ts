import { GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { NextResponse } from 'next/server'
import { getActor } from '@/lib/auth/actor'
import {
  getPurchaseRequestChecklistAttachment,
  PurchaseRequestChecklistAccessError,
} from '@/lib/pr/checklist-queries'
import { isPurchaseRequestChecklistStorageKey } from '@/lib/pr/checklist-storage'
import { contractFileUrl } from '@/lib/contracts/file-actions'
import { isContractFilePathAllowed } from '@/lib/contracts/files'
import { getR2BucketName, getR2Client } from '@/lib/r2/client'

interface RouteContext {
  params: Promise<{ id: string; attachmentId: string }>
}

function contentDisposition(fileName: string) {
  const ascii = fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'attachment'
  return `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const actor = await getActor()
    if (!actor) return NextResponse.json({ error: 'กรุณาเข้าสู่ระบบ' }, { status: 401 })
    const { id, attachmentId } = await context.params
    const attachment = await getPurchaseRequestChecklistAttachment(id, attachmentId, actor)
    if (attachment.storage_backend === 'supabase_storage') {
      if (
        attachment.source_contract_id === null ||
        !isContractFilePathAllowed(attachment.storage_key, Number(attachment.source_contract_id))
      ) {
        return NextResponse.json({ error: 'เส้นทางไฟล์หน้าสัญญาไม่ถูกต้อง' }, { status: 422 })
      }
      const signedUrl = await contractFileUrl(Number(attachment.source_contract_id), attachment.storage_key)
      return NextResponse.redirect(signedUrl)
    }
    if (!isPurchaseRequestChecklistStorageKey(attachment.storage_key)) {
      return NextResponse.json({ error: 'เส้นทางเอกสารไม่ถูกต้อง' }, { status: 422 })
    }
    const signedUrl = await getSignedUrl(
      getR2Client(),
      new GetObjectCommand({
        Bucket: getR2BucketName(),
        Key: attachment.storage_key,
        ResponseContentType: attachment.mime_type ?? undefined,
        ResponseContentDisposition: contentDisposition(attachment.file_name),
      }),
      { expiresIn: 300 },
    )
    return NextResponse.redirect(signedUrl)
  } catch (error) {
    const status = error instanceof PurchaseRequestChecklistAccessError ? 403 : 500
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'เปิดเอกสารไม่สำเร็จ' },
      { status },
    )
  }
}
