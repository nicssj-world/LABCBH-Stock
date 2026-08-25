import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ReceiptForm } from '@/components/receipts/ReceiptForm'
import { canCreateGoodsReceipt } from '@/lib/auth/access'
import { requireActor } from '@/lib/auth/actor'
import { listInventoryCatalog } from '@/lib/inventory/queries'
import { DEPARTMENTS } from '@/lib/organization/departments'
import { listReceivablePurchaseRequests } from '@/lib/receipts/queries'

interface NewReceiptPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)

export default async function NewReceiptPage({ searchParams }: NewReceiptPageProps) {
  const actor = await requireActor()
  if (!canCreateGoodsReceipt(actor)) redirect('/receipts')

  const params = await searchParams
  const initialPurchaseRequestId = first(params.purchaseRequestId)?.trim() || undefined
  const initialDepartment = first(params.department)?.trim() || undefined

  const [inventoryItems, purchaseRequests] = await Promise.all([
    listInventoryCatalog(),
    listReceivablePurchaseRequests(),
  ])

  return (
    <div className="route-stack">
      <header className="page-heading">
        <div>
          <Link className="back-link" href="/receipts">← รับเข้าคลัง</Link>
          <p className="section-kicker">NEW RECEIPT</p>
          <h1>สร้างใบรับเข้า</h1>
          <p>เลือกใบ PR ที่เกี่ยวข้องเพื่อดึงเลข PO จาก PR แล้วตรวจทานก่อนลงบัญชีคลัง</p>
        </div>
      </header>

      <ReceiptForm
        catalog={inventoryItems.map((item) => ({
          inventoryItemId: item.id,
          lsCode: item.lsCode,
          name: item.name,
          unit: item.baseUnit,
        }))}
        departments={DEPARTMENTS}
        purchaseRequests={purchaseRequests}
        receiverName={actor.name ?? ''}
        initialPurchaseRequestId={initialPurchaseRequestId}
        initialDepartment={initialDepartment}
      />
    </div>
  )
}
