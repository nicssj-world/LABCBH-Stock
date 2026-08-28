import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PurchaseRequestPrint } from '@/components/pr/PurchaseRequestPrint'
import { requireActor } from '@/lib/auth/actor'
import { getPurchaseRequest } from '@/lib/pr/queries'
import { loadPortalSignatureDataUri } from '@/lib/requisitions/signature'

interface PurchaseRequestPrintPageProps {
  params: Promise<{ id: string }>
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function PurchaseRequestPrintPage({ params }: PurchaseRequestPrintPageProps) {
  await requireActor()
  const { id } = await params
  if (!UUID_PATTERN.test(id)) notFound()

  const request = await getPurchaseRequest(id)
  if (!request) notFound()

  // The confirming officer is the actor recorded on the PR, not the person
  // currently viewing the print page. Keep the Portal signature lookup
  // server-side because the signature bucket is private.
  let acknowledgedBySignature: string | null = null
  if (request.acknowledgedBy) {
    try {
      acknowledgedBySignature = await loadPortalSignatureDataUri({
        id: request.acknowledgedBy,
        ephisId: request.acknowledgedByEphisId,
        name: request.acknowledgedByName,
      })
    } catch (error) {
      console.error('[purchase-request.print] unable to load acknowledger signature', {
        purchaseRequestId: request.id,
        acknowledgedBy: request.acknowledgedBy,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return (
    <div className="print-route">
      <div className="print-route__toolbar">
        <Link className="back-link" href={`/purchase-requests/${request.id}`}>← กลับไปหน้าใบ PR</Link>
        <p>ใช้คำสั่งพิมพ์ของเบราว์เซอร์ (Ctrl+P) เอกสารจัดหน้าสำหรับกระดาษ A4 ไว้แล้ว</p>
      </div>
      <PurchaseRequestPrint request={request} acknowledgedBySignature={acknowledgedBySignature} />
    </div>
  )
}
