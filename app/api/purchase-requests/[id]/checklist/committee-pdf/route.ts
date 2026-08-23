import { NextResponse } from 'next/server'
import { getActor } from '@/lib/auth/actor'
import { generatePurchaseRequestCommitteePdf } from '@/lib/pr/committee-pdf'
import { resolvePurchaseRequestCommitteePdfInput } from '@/lib/pr/committee-pdf-server'
import {
  PurchaseRequestChecklistAccessError,
} from '@/lib/pr/checklist-queries'

interface RouteContext { params: Promise<{ id: string }> }

function pdfFileName(documentNumber: string) {
  return `กรรมการ-${documentNumber.replace(/[^a-zA-Z0-9ก-๙._-]/g, '_')}.pdf`
}

function attachmentDisposition(fileName: string) {
  const ascii = fileName.replace(/[^a-zA-Z0-9._-]/g, '_')
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const actor = await getActor()
    if (!actor) return NextResponse.json({ error: 'กรุณาเข้าสู่ระบบ' }, { status: 401 })
    const { id } = await context.params
    const resolved = await resolvePurchaseRequestCommitteePdfInput(id, actor)
    const bytes = await generatePurchaseRequestCommitteePdf(resolved.input)
    const fileName = pdfFileName(resolved.documentNumber)
    return new Response(Buffer.from(bytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': attachmentDisposition(fileName),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error) {
    const status = error instanceof PurchaseRequestChecklistAccessError ? 403 : 422
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'สร้าง PDF รายชื่อกรรมการไม่สำเร็จ' },
      { status },
    )
  }
}
