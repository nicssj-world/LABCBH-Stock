import { NextResponse } from 'next/server'
import { getActor } from '@/lib/auth/actor'
import { buildInventoryAnnualReportModel, generateInventoryAnnualReportWorkbook } from '@/lib/inventory/annual-report'
import { bangkokToday, getInventoryAnnualReportData } from '@/lib/inventory/queries'
import { inventoryAnnualReportFiltersSchema } from '@/lib/inventory/schema'

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
    const filters = inventoryAnnualReportFiltersSchema.parse({
      fiscalYear: url.searchParams.get('fiscalYear'),
      department: url.searchParams.get('department') || undefined,
    })
    const data = await getInventoryAnnualReportData(filters)
    const model = buildInventoryAnnualReportModel({
      ...data,
      fiscalYear: filters.fiscalYear,
      department: filters.department ?? null,
      generatedOn: bangkokToday(),
    })
    const workbook = await generateInventoryAnnualReportWorkbook(model)
    const fileName = `inventory-annual-report-${filters.fiscalYear}.xlsx`

    return new Response(Buffer.from(workbook), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': attachmentDisposition(fileName),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'สร้างรายงานประจำปีไม่สำเร็จ' },
      { status: 422 },
    )
  }
}
