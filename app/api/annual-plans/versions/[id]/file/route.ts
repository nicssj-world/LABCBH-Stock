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
    const versionId = z.string().uuid().parse(id)
    const versionResult = await supabaseAdmin
      .from('lab_stock_annual_plan_versions')
      .select('annual_plan_id, file_path, file_name, file_mime_type')
      .eq('id', versionId)
      .maybeSingle()
    if (versionResult.error) {
      return NextResponse.json({ error: `อ่านไฟล์แผนประจำปีไม่สำเร็จ: ${versionResult.error.message}` }, { status: 500 })
    }
    if (!versionResult.data) return NextResponse.json({ error: 'ไม่พบไฟล์แผนประจำปีเวอร์ชันนี้' }, { status: 404 })

    const currentResult = await supabaseAdmin
      .from('lab_stock_annual_plans')
      .select('current_version_id')
      .eq('id', versionResult.data.annual_plan_id)
      .maybeSingle()
    if (currentResult.error) {
      return NextResponse.json({ error: `อ่านเวอร์ชันปัจจุบันของแผนไม่สำเร็จ: ${currentResult.error.message}` }, { status: 500 })
    }
    if (!currentResult.data || currentResult.data.current_version_id !== versionId) {
      return NextResponse.json({ error: 'ไฟล์แผนประจำปีเวอร์ชันนี้ไม่ใช่เวอร์ชันปัจจุบัน' }, { status: 409 })
    }
    if (!isAnnualPlanFilePathAllowed(versionResult.data.file_path)) {
      return NextResponse.json({ error: 'เส้นทางไฟล์แผนประจำปีไม่ถูกต้อง' }, { status: 422 })
    }

    const file = await supabaseAdmin.storage.from(ANNUAL_PLAN_BUCKET).download(versionResult.data.file_path)
    if (file.error || !file.data) {
      return NextResponse.json({ error: 'อ่านไฟล์แผนประจำปีจากพื้นที่จัดเก็บไม่สำเร็จ' }, { status: 404 })
    }

    return new Response(file.data, {
      headers: {
        'Content-Type': versionResult.data.file_mime_type || 'application/pdf',
        'Content-Disposition': inlineDisposition(versionResult.data.file_name),
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
