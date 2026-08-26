import { NextResponse } from 'next/server'
import { prepareAnnualPlanUpload } from '@/lib/annual-plans/actions'
import { ZodError } from 'zod'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  try {
    const ticket = await prepareAnnualPlanUpload(await request.json())
    return NextResponse.json(ticket, { status: 201 })
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message ?? 'ข้อมูลไฟล์ไม่ถูกต้อง' },
        { status: 422 },
      )
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'เตรียมอัปโหลดแผนประจำปีไม่สำเร็จ' },
      { status: 500 },
    )
  }
}
