import { GetObjectCommand } from '@aws-sdk/client-s3'
import archiver from 'archiver'
import { PassThrough, Readable } from 'node:stream'
import { NextResponse } from 'next/server'
import { getActor } from '@/lib/auth/actor'
import { generatePurchaseRequestCommitteePdf } from '@/lib/pr/committee-pdf'
import { resolvePurchaseRequestCommitteePdfInput } from '@/lib/pr/committee-pdf-server'
import {
  assertPurchaseRequestChecklistStockAccess,
  getPurchaseRequestChecklist,
  listPurchaseRequestChecklistDownloadObjects,
  PurchaseRequestChecklistAccessError,
} from '@/lib/pr/checklist-queries'
import { PR_ATTACHMENT_KIND_LABELS } from '@/lib/pr/checklist'
import { isPurchaseRequestChecklistStorageKey } from '@/lib/pr/checklist-storage'
import { getR2BucketName, getR2Client } from '@/lib/r2/client'

interface RouteContext { params: Promise<{ id: string }> }

function safeZipPart(value: string) {
  return value.replace(/[\\/:*?"<>|]/g, '_').replace(/\.{2,}/g, '_').trim() || 'document'
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const actor = await getActor()
    if (!actor) return NextResponse.json({ error: 'กรุณาเข้าสู่ระบบ' }, { status: 401 })
    const { id } = await context.params
    await assertPurchaseRequestChecklistStockAccess(id, actor)
    const [objects, checklist] = await Promise.all([
      listPurchaseRequestChecklistDownloadObjects(id, actor),
      getPurchaseRequestChecklist(id, actor),
    ])

    const output = new PassThrough()
    const archive = archiver('zip', { zlib: { level: 6 } })
    archive.on('error', (error) => output.destroy(error))
    archive.pipe(output)

    for (const object of objects) {
      if (!isPurchaseRequestChecklistStorageKey(object.storage_key)) {
        throw new Error('พบเส้นทางเอกสารที่อยู่นอกพื้นที่ PR')
      }
      const response = await getR2Client().send(new GetObjectCommand({
        Bucket: getR2BucketName(),
        Key: object.storage_key,
      }))
      if (!response.Body) throw new Error(`อ่านไฟล์ ${object.file_name} จาก R2 ไม่สำเร็จ`)
      const label = PR_ATTACHMENT_KIND_LABELS[object.attachment_kind as keyof typeof PR_ATTACHMENT_KIND_LABELS]
      archive.append(response.Body as Readable, {
        name: `${safeZipPart(label)}-${object.slot}-${safeZipPart(object.file_name)}`,
      })
    }

    let documentNumber = `PR-${id}`
    if (checklist.canDownloadCommitteePdf) {
      const resolved = await resolvePurchaseRequestCommitteePdfInput(id, actor)
      documentNumber = resolved.documentNumber
      const committeePdf = await generatePurchaseRequestCommitteePdf(resolved.input)
      archive.append(Buffer.from(committeePdf), { name: `กรรมการ-${safeZipPart(documentNumber)}.pdf` })
    }
    void archive.finalize()

    return new Response(Readable.toWeb(output) as ReadableStream, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="PR-checklist-${safeZipPart(documentNumber)}.zip"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error) {
    const status = error instanceof PurchaseRequestChecklistAccessError ? 403 : 500
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'ดาวน์โหลดเอกสารทั้งหมดไม่สำเร็จ' },
      { status },
    )
  }
}
