import { NextResponse } from 'next/server'
import { requireActor } from '@/lib/auth/actor'
import { CONTRACT_FILE_BUCKET, isContractFilePathAllowed } from '@/lib/contracts/files'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

function inlineDisposition(fileName: string) {
  const ascii = fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'contract-file'
  return `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
}

function fallbackFileName(path: string) {
  return path.split('/').pop() || 'contract-file'
}

function fallbackMimeType(fileName: string, mimeType: unknown) {
  if (typeof mimeType === 'string' && mimeType.trim()) return mimeType
  const lowerName = fileName.toLowerCase()
  if (lowerName.endsWith('.pdf')) return 'application/pdf'
  if (lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')) return 'image/jpeg'
  if (lowerName.endsWith('.png')) return 'image/png'
  if (lowerName.endsWith('.webp')) return 'image/webp'
  return 'application/octet-stream'
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireActor()
    const { id } = await params
    const contractId = Number(id)
    if (!Number.isInteger(contractId) || contractId <= 0) {
      return NextResponse.json({ error: 'สัญญาไม่ถูกต้อง' }, { status: 400 })
    }

    const result = await supabaseAdmin
      .from('contracts')
      .select('file_url, contract_file_name, contract_file_mime_type')
      .eq('id', contractId)
      .maybeSingle()
    if (result.error) {
      return NextResponse.json({ error: `อ่านไฟล์สัญญาไม่สำเร็จ: ${result.error.message}` }, { status: 500 })
    }

    const filePath = typeof result.data?.file_url === 'string' ? result.data.file_url : null
    if (!filePath) return NextResponse.json({ error: 'ไม่พบไฟล์สัญญา' }, { status: 404 })
    if (!isContractFilePathAllowed(filePath, contractId)) {
      return NextResponse.json({ error: 'เส้นทางไฟล์สัญญาไม่ถูกต้อง' }, { status: 422 })
    }

    const fileName = typeof result.data?.contract_file_name === 'string' && result.data.contract_file_name.trim()
      ? result.data.contract_file_name.trim()
      : fallbackFileName(filePath)
    const file = await supabaseAdmin.storage.from(CONTRACT_FILE_BUCKET).download(filePath)
    if (file.error || !file.data) {
      return NextResponse.json({ error: 'อ่านไฟล์สัญญาจากพื้นที่จัดเก็บไม่สำเร็จ' }, { status: 404 })
    }

    return new Response(file.data, {
      headers: {
        'Content-Type': fallbackMimeType(fileName, result.data?.contract_file_mime_type),
        'Content-Disposition': inlineDisposition(fileName),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'เปิดไฟล์สัญญาไม่สำเร็จ' },
      { status: 500 },
    )
  }
}
