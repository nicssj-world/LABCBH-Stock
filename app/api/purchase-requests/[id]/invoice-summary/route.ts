import { getActor } from '@/lib/auth/actor'
import { generatePurchaseRequestInvoiceSummaryPdf } from '@/lib/pr/invoice-summary'
import { getPurchaseRequest } from '@/lib/pr/queries'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const requestIdSchema = z.string().uuid()

function attachmentDisposition(fileName: string) {
  const asciiName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_')
  return `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await getActor()
    if (!actor) return NextResponse.json({ error: 'กรุณาเข้าสู่ระบบ' }, { status: 401 })
    if (actor.appRoles.length === 0) return NextResponse.json({ error: 'ไม่มีสิทธิ์ดาวน์โหลดสรุปใบแจ้งหนี้' }, { status: 403 })

    const { id } = await context.params
    const parsedId = requestIdSchema.safeParse(id)
    if (!parsedId.success) return NextResponse.json({ error: 'รหัสใบ PR ไม่ถูกต้อง' }, { status: 422 })

    const purchaseRequest = await getPurchaseRequest(parsedId.data)
    if (!purchaseRequest) return NextResponse.json({ error: 'ไม่พบใบ PR จัดซื้อ' }, { status: 404 })
    if (purchaseRequest.purchaseMethod !== 'red_cross') {
      return NextResponse.json({ error: 'เอกสารสรุปใบแจ้งหนี้นี้ใช้เฉพาะ PR จัดซื้อสภากาชาดไทย' }, { status: 403 })
    }

    const pdf = await generatePurchaseRequestInvoiceSummaryPdf({
      documentNumber: purchaseRequest.documentNumber,
      poNumber: purchaseRequest.poNumber,
      ephisPrNumber: purchaseRequest.ephisPrNumber,
      items: purchaseRequest.items,
      expenseEvents: purchaseRequest.expenseEvents,
    })
    const fileName = `สรุปใบแจ้งหนี้-${purchaseRequest.documentNumber}.pdf`
    return new Response(Buffer.from(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': attachmentDisposition(fileName),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'สร้างสรุปใบแจ้งหนี้ไม่สำเร็จ' },
      { status: 422 },
    )
  }
}
