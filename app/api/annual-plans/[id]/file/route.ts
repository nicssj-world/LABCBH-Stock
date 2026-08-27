import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireActor } from '@/lib/auth/actor'
import { ANNUAL_PLAN_BUCKET, isAnnualPlanFilePathAllowed } from '@/lib/annual-plans/files'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

function inlineDisposition(fileName: string) {
  const ascii = fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'annual-plan.pdf'
  return `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireActor()
    const { id } = await params
    const planId = z.string().uuid().parse(id)
    const result = await supabaseAdmin
      .from('lab_stock_annual_plans')
      .select('file_path, file_name, file_mime_type')
      .eq('id', planId)
      .maybeSingle()
    if (result.error) {
      return NextResponse.json({ error: `อ่านไฟล์แผนประจำปีไม่สำเร็จ: ${result.error.message}` }, { status: 500 })
    }
    if (!result.data) return NextResponse.json({ error: 'ไม่พบไฟล์แผนประจำปี' }, { status: 404 })
    if (!isAnnualPlanFilePathAllowed(result.data.file_path)) {
      return NextResponse.json({ error: 'เส้นทางไฟล์แผนประจำปีไม่ถูกต้อง' }, { status: 422 })
    }

    const file = await supabaseAdmin.storage.from(ANNUAL_PLAN_BUCKET).download(result.data.file_path)
    if (file.error || !file.data) {
      return NextResponse.json({ error: 'อ่านไฟล์แผนประจำปีจากพื้นที่จัดเก็บไม่สำเร็จ' }, { status: 404 })
    }

    return new Response(file.data, {
      headers: {
        'Content-Type': result.data.file_mime_type || 'application/pdf',
        'Content-Disposition': inlineDisposition(result.data.file_name),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'เปิดไฟล์แผนประจำปีไม่สำเร็จ' },
      { status: 422 },
    )
  }
}
