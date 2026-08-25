import { NextResponse } from 'next/server'
import { requireActor } from '@/lib/auth/actor'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { SERVICE_FILE_BUCKET, isServiceFilePathAllowed } from '@/lib/service-procurement/files'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; fileId: string }> },
) {
  await requireActor()
  const { id, fileId } = await params
  let path: string | null = null
  if (fileId === 'po') {
    const result = await supabaseAdmin.from('service_purchase_requests').select('po_file_path').eq('id', id).maybeSingle()
    if (result.error) return NextResponse.json({ error: result.error.message }, { status: 404 })
    path = (result.data?.po_file_path as string | null | undefined) ?? null
    if (path && !isServiceFilePathAllowed(path, id, 'po')) path = null
  } else {
    const result = await supabaseAdmin
      .from('service_purchase_request_attachments')
      .select('storage_key')
      .eq('id', fileId)
      .eq('purchase_request_id', id)
      .maybeSingle()
    if (result.error) return NextResponse.json({ error: result.error.message }, { status: 404 })
    path = (result.data?.storage_key as string | null | undefined) ?? null
    if (path && !/^service-procurement\/checklist\/[0-9a-f-]{36}\/[^/]+$/i.test(path)) path = null
  }
  if (!path) return NextResponse.json({ error: 'ไม่พบไฟล์' }, { status: 404 })
  const signed = await supabaseAdmin.storage.from(SERVICE_FILE_BUCKET).createSignedUrl(path, 300)
  if (signed.error) return NextResponse.json({ error: 'สร้างลิงก์ไฟล์ไม่สำเร็จ' }, { status: 404 })
  return NextResponse.redirect(signed.data.signedUrl)
}
