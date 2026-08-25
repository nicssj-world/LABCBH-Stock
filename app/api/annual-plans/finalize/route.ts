import { NextResponse } from 'next/server'
import { ZodError } from 'zod'
import { finalizeAnnualPlanUpload } from '@/lib/annual-plans/actions'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  try {
    const result = await finalizeAnnualPlanUpload(await request.json())
    return NextResponse.json({ planId: result.planId }, { status: 201 })
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message ?? 'ข้อมูลไฟล์ไม่ถูกต้อง' },
        { status: 422 },
      )
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'บันทึกแผนประจำปีไม่สำเร็จ' },
      { status: 500 },
    )
  }
}
