import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PurchaseRequestPrint } from '@/components/pr/PurchaseRequestPrint'
import { requireActor } from '@/lib/auth/actor'
import { getPurchaseRequest } from '@/lib/pr/queries'

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

  return (
    <div className="print-route">
      <div className="print-route__toolbar">
        <Link className="back-link" href={`/purchase-requests/${request.id}`}>← กลับไปหน้าใบ PR</Link>
        <p>ใช้คำสั่งพิมพ์ของเบราว์เซอร์ (Ctrl+P) เอกสารจัดหน้าสำหรับกระดาษ A4 ไว้แล้ว</p>
      </div>
      <PurchaseRequestPrint request={request} />
    </div>
  )
}
