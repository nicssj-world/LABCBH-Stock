import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getActor } from '@/lib/auth/actor'
import { getExecutiveOverview } from '@/lib/dashboard/executive'
import { generateExecutivePdf } from '@/lib/dashboard/executive-pdf'
import { generateExecutiveWorkbook } from '@/lib/dashboard/executive-excel'

const querySchema = z.object({
  fiscalYear: z.coerce.number().int().min(2500).max(3000),
  format: z.enum(['pdf', 'xlsx']),
})

function attachmentDisposition(fileName: string) {
  const asciiName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_')
  return `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
}

export async function GET(request: Request) {
  try {
    const actor = await getActor()
    if (!actor) return NextResponse.json({ error: 'กรุณาเข้าสู่ระบบ' }, { status: 401 })
    if (actor.appRoles.length === 0) return NextResponse.json({ error: 'ไม่มีสิทธิ์ดูรายงานผู้บริหาร' }, { status: 403 })

    const url = new URL(request.url)
    const query = querySchema.parse({
      fiscalYear: url.searchParams.get('fiscalYear'),
      format: url.searchParams.get('format'),
    })
    const overview = await getExecutiveOverview({ fiscalYear: query.fiscalYear })

    if (query.format === 'pdf') {
      const pdf = await generateExecutivePdf(overview)
      return new Response(Buffer.from(pdf), {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': attachmentDisposition(`executive-dashboard-${query.fiscalYear}.pdf`),
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      })
    }

    const workbook = await generateExecutiveWorkbook(overview)
    return new Response(Buffer.from(workbook), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': attachmentDisposition(`executive-dashboard-${query.fiscalYear}.xlsx`),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'สร้างรายงานผู้บริหารไม่สำเร็จ' },
      { status: 422 },
    )
  }
}
