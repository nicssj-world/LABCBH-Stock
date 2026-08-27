import { NextResponse } from 'next/server'
import { getPurchaseRequestPoFileMetadata } from '@/lib/pr/po-file-actions'
import { PO_IMAGE_BUCKET } from '@/lib/po/storage'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

function inlineDisposition(fileName: string) {
  const ascii = fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'po-file'
  return `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
}

function fallbackMimeType(fileName: string, mimeType: string | null) {
  if (mimeType?.trim()) return mimeType
  const lowerName = fileName.toLowerCase()
  if (lowerName.endsWith('.pdf')) return 'application/pdf'
  if (lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')) return 'image/jpeg'
  if (lowerName.endsWith('.png')) return 'image/png'
  if (lowerName.endsWith('.webp')) return 'image/webp'
  return 'application/octet-stream'
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const file = await getPurchaseRequestPoFileMetadata(id)
    if (!file) return NextResponse.json({ error: 'ไม่พบไฟล์ PO' }, { status: 404 })

    const fileName = file.fileName?.trim() || file.path.split('/').pop() || 'po-file'
    const downloaded = await supabaseAdmin.storage.from(PO_IMAGE_BUCKET).download(file.path)
    if (downloaded.error || !downloaded.data) {
      return NextResponse.json({ error: 'อ่านไฟล์ PO จากพื้นที่จัดเก็บไม่สำเร็จ' }, { status: 404 })
    }

    return new Response(downloaded.data, {
      headers: {
        'Content-Type': fallbackMimeType(fileName, file.mimeType),
        'Content-Disposition': inlineDisposition(fileName),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'เปิดไฟล์ PO ไม่สำเร็จ' },
      { status: 500 },
    )
  }
}
