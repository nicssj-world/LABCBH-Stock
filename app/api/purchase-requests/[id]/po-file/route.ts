import { NextResponse } from 'next/server'
import { getPurchaseRequestPoFileUrl } from '@/lib/pr/po-file-actions'

export const dynamic = 'force-dynamic'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  try {
    const url = await getPurchaseRequestPoFileUrl(id)
    if (!url) {
      return NextResponse.json({ error: 'ไม่พบไฟล์ PO ที่เปิดดูได้' }, { status: 404 })
    }

    return NextResponse.json(
      { url },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : 'เปิดไฟล์ PO ไม่สำเร็จ'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
