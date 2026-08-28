import { NextResponse } from 'next/server'
import { requireActor } from '@/lib/auth/actor'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { SERVICE_FILE_BUCKET, isServiceFilePathAllowed } from '@/lib/service-procurement/files'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; documentId: string }> }) {
  await requireActor()
  const { id, documentId } = await params
  const result = await supabaseAdmin.from('service_plan_documents').select('storage_key').eq('id', documentId).eq('plan_id', id).maybeSingle()
  if (result.error) return NextResponse.json({ error: 'อ่านเอกสารแผนไม่สำเร็จ' }, { status: 500 })
  const path = result.data?.storage_key as string | undefined
  if (!path || !isServiceFilePathAllowed(path, id, 'plan-document')) return NextResponse.json({ error: 'ไม่พบเอกสารแผน' }, { status: 404 })
  const signed = await supabaseAdmin.storage.from(SERVICE_FILE_BUCKET).createSignedUrl(path, 300)
  if (signed.error) return NextResponse.json({ error: 'สร้างลิงก์เอกสารแผนไม่สำเร็จ' }, { status: 500 })
  return NextResponse.redirect(signed.data.signedUrl)
}
