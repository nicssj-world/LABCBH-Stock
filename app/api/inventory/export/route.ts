import { getActor } from '@/lib/auth/actor'
import { bangkokToday, listInventoryExportItems } from '@/lib/inventory/queries'
import { inventoryExportFiltersSchema } from '@/lib/inventory/schema'
import { generateInventoryPdf } from '@/lib/inventory/export'
import { NextResponse } from 'next/server'

function attachmentDisposition(fileName: string) {
  const asciiName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_')
  return `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
}

export async function GET(request: Request) {
  try {
    const actor = await getActor()
    if (!actor) return NextResponse.json({ error: 'กรุณาเข้าสู่ระบบ' }, { status: 401 })
    if (actor.appRoles.length === 0) return NextResponse.json({ error: 'ไม่มีสิทธิ์ดูรายงานคลัง' }, { status: 403 })

    const url = new URL(request.url)
    const filters = inventoryExportFiltersSchema.parse({
      department: url.searchParams.get('department') || undefined,
      onlyInStock: url.searchParams.get('onlyInStock') === '1',
    })
    const generatedOn = bangkokToday()
    const items = await listInventoryExportItems(filters)
    const pdf = await generateInventoryPdf({
      items,
      department: filters.department ?? null,
      onlyInStock: filters.onlyInStock,
      generatedOn,
    })
    const fileName = `inventory-stock-${generatedOn}.pdf`

    return new Response(Buffer.from(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': attachmentDisposition(fileName),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'สร้างรายงานคงคลังไม่สำเร็จ' },
      { status: 422 },
    )
  }
}
