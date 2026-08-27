import { NextResponse } from 'next/server'
import { getPurchaseRequestPoFileMetadata, getPurchaseRequestPoFileUrl } from '@/lib/pr/po-file-actions'

export const dynamic = 'force-dynamic'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  try {
    const [url, file] = await Promise.all([
      getPurchaseRequestPoFileUrl(id),
      getPurchaseRequestPoFileMetadata(id),
    ])
    if (!url || !file) {
      return NextResponse.json({ error: 'ไม่พบไฟล์ PO ที่เปิดดูได้' }, { status: 404 })
    }

    return NextResponse.json(
      { url, fileName: file.fileName, mimeType: file.mimeType },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : 'เปิดไฟล์ PO ไม่สำเร็จ'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
