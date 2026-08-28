import Link from 'next/link'
import { notFound } from 'next/navigation'
import { RequisitionPrint } from '@/components/requisitions/RequisitionPrint'
import { requireActor } from '@/lib/auth/actor'
import { getRequisition } from '@/lib/requisitions/queries'
import { loadPortalSignatureDataUri } from '@/lib/requisitions/signature'

interface RequisitionPrintPageProps {
  params: Promise<{ id: string }>
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function RequisitionPrintPage({ params }: RequisitionPrintPageProps) {
  await requireActor()
  const { id } = await params
  if (!UUID_PATTERN.test(id)) notFound()

  const requisition = await getRequisition(id)
  if (!requisition) notFound()

  // The issuer is the stock profile recorded at fulfilment, not the person
  // currently viewing the print page. Keep this lookup server-side because
  // the Portal signature bucket is private.
  let fulfilledBySignature: string | null = null
  if (requisition.fulfilledBy && requisition.fulfilledByName) {
    try {
      fulfilledBySignature = await loadPortalSignatureDataUri({
        id: requisition.fulfilledBy,
        ephisId: null,
        name: requisition.fulfilledByName,
      })
    } catch (error) {
      console.error('[requisition.print] unable to load fulfiller signature', {
        requisitionId: requisition.id,
        fulfilledBy: requisition.fulfilledBy,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return (
    <div className="print-route">
      <div className="print-route__toolbar">
        <Link className="back-link" href={`/requisitions/${requisition.id}`}>← กลับไปหน้าใบเบิก</Link>
        <p>ใช้คำสั่งพิมพ์ของเบราว์เซอร์ (Ctrl+P) เอกสารจัดหน้าสำหรับกระดาษ A4 ไว้แล้ว</p>
      </div>
      <RequisitionPrint requisition={requisition} fulfilledBySignature={fulfilledBySignature} />
    </div>
  )
}
