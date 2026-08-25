import { NextResponse } from 'next/server'
import { requireActor } from '@/lib/auth/actor'
import { buildServicePlanWorkbook } from '@/lib/service-procurement/export'

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  await requireActor()
  const { id } = await context.params
  const workbook = await buildServicePlanWorkbook(id)
  if (!workbook) return NextResponse.json({ error: 'ไม่พบแผนงานจ้าง' }, { status: 404 })
  return new NextResponse(workbook as BodyInit, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="service-plan-${id}.xlsx"`,
      'Cache-Control': 'no-store',
    },
  })
}
