import { getActor } from '@/lib/auth/actor'
import { generateServiceInvoiceSummaryPdf } from '@/lib/service-procurement/invoice-summary'
import { getServicePurchaseRequest } from '@/lib/service-procurement/queries'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const requestIdSchema = z.string().uuid()
const numberPayloadSchema = z.object({
  requestedNumber: z.string().trim().max(32).nullable().optional(),
}).transform((payload) => ({ requestedNumber: payload.requestedNumber ?? null }))

function attachmentDisposition(fileName: string) {
  const asciiName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_')
  return `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
}

async function authorizeRequest(rawId: string) {
  const actor = await getActor()
  if (!actor) return { response: NextResponse.json({ error: 'กรุณาเข้าสู่ระบบ' }, { status: 401 }) }
  if (actor.appRoles.length === 0) {
    return { response: NextResponse.json({ error: 'ไม่มีสิทธิ์ดาวน์โหลดสรุปใบแจ้งหนี้' }, { status: 403 }) }
  }

  const parsedId = requestIdSchema.safeParse(rawId)
  if (!parsedId.success) return { response: NextResponse.json({ error: 'รหัสใบ PR ไม่ถูกต้อง' }, { status: 422 }) }

  const request = await getServicePurchaseRequest(parsedId.data)
  if (!request) return { response: NextResponse.json({ error: 'ไม่พบใบ PR งานจ้าง' }, { status: 404 }) }
  if (!request.isRedCross) {
    return { response: NextResponse.json({ error: 'สรุปใบแจ้งหนี้ได้เฉพาะ PR งานจ้างที่ติด tag สภากาชาดไทย' }, { status: 403 }) }
  }

  return { actor, request: { ...request, id: parsedId.data } }
}

function rpcErrorStatus(code: string | undefined) {
  if (code === '23505' || code === '55000') return 409
  if (code === '42501') return 403
  if (code === '23503') return 404
  return 422
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params
    const authorized = await authorizeRequest(id)
    if ('response' in authorized) return authorized.response

    if (new URL(request.url).searchParams.get('mode') !== 'number') {
      return NextResponse.json({ error: 'กรุณาเปิดหน้าต่างเพื่อระบุเลขสรุปใบแจ้งหนี้ก่อนส่งออก' }, { status: 400 })
    }

    const result = await supabaseAdmin.rpc('get_service_invoice_summary_number', {
      p_request_id: authorized.request.id,
    })
    if (result.error) {
      return NextResponse.json({ error: result.error.message }, { status: rpcErrorStatus(result.error.code) })
    }

    return NextResponse.json(result.data, {
      headers: { 'Cache-Control': 'private, no-store' },
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'อ่านเลขสรุปใบแจ้งหนี้ไม่สำเร็จ' },
      { status: 422 },
    )
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params
    const authorized = await authorizeRequest(id)
    if ('response' in authorized) return authorized.response

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'ข้อมูลเลขสรุปใบแจ้งหนี้ไม่ถูกต้อง' }, { status: 422 })
    }
    const parsedBody = numberPayloadSchema.safeParse(body)
    if (!parsedBody.success) {
      return NextResponse.json({ error: parsedBody.error.issues[0]?.message ?? 'ข้อมูลเลขสรุปใบแจ้งหนี้ไม่ถูกต้อง' }, { status: 422 })
    }

    const result = await supabaseAdmin.rpc('claim_service_invoice_summary_number', {
      p_request_id: authorized.request.id,
      p_actor_id: authorized.actor.id,
      p_requested_number: parsedBody.data.requestedNumber,
    })
    if (result.error) {
      return NextResponse.json({ error: result.error.message }, { status: rpcErrorStatus(result.error.code) })
    }

    const assignedNumber = result.data && typeof result.data === 'object' && 'number' in result.data
      ? result.data.number
      : null
    if (typeof assignedNumber !== 'string' || assignedNumber.length === 0) {
      return NextResponse.json({ error: 'ระบบไม่ได้รับเลขสรุปใบแจ้งหนี้' }, { status: 422 })
    }

    const pdf = await generateServiceInvoiceSummaryPdf({
      ...authorized.request,
      invoiceSummaryNumber: assignedNumber,
    })
    const fileName = `สรุปใบแจ้งหนี้-${authorized.request.documentNumber}.pdf`
    return new Response(Buffer.from(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': attachmentDisposition(fileName),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Service-Invoice-Summary-Number': assignedNumber,
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'สร้างสรุปใบแจ้งหนี้ไม่สำเร็จ' },
      { status: 422 },
    )
  }
}
