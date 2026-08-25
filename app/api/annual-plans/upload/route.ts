import { NextResponse } from 'next/server'
import { storeAnnualPlan } from '@/lib/annual-plans/actions'
import { annualPlanInputSchema } from '@/lib/annual-plans/schema'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  try {
    const formData: FormData = await request.formData()
    const file = formData.get('file')
    if (!(file instanceof File)) throw new Error('กรุณาเลือกไฟล์แผนประจำปี')
    const input = annualPlanInputSchema.parse({
      fiscalYear: Number(formData.get('fiscalYear')),
      planType: formData.get('planType'),
    })
    const result = await storeAnnualPlan(input.fiscalYear, input.planType, file)
    return NextResponse.json({ planId: result.planId }, { status: 201 })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'อัปโหลดแผนประจำปีไม่สำเร็จ' },
      { status: 400 },
    )
  }
}
