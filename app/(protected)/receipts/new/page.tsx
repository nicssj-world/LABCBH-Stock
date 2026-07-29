import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ReceiptForm } from '@/components/receipts/ReceiptForm'
import { canOperateStock } from '@/lib/auth/access'
import { requireActor } from '@/lib/auth/actor'
import { listInventoryItems } from '@/lib/inventory/queries'
import { listReceivablePurchaseRequests } from '@/lib/receipts/queries'

export default async function NewReceiptPage() {
  const actor = await requireActor()
  if (!canOperateStock(actor)) redirect('/receipts')

  const [inventoryItems, purchaseRequests] = await Promise.all([
    listInventoryItems({}),
    listReceivablePurchaseRequests(),
  ])

  return (
    <div className="route-stack">
      <header className="page-heading">
        <div>
          <Link className="back-link" href="/receipts">← รับเข้าคลัง</Link>
          <p className="section-kicker">NEW RECEIPT</p>
          <h1>สร้างใบรับเข้า</h1>
          <p>บันทึกฉบับร่างก่อน จากนั้นแนบภาพใบสั่งซื้อและตรวจทานก่อนลงบัญชีคลัง</p>
        </div>
      </header>

      <ReceiptForm
        catalog={inventoryItems.map((item) => ({
          inventoryItemId: item.id,
          lsCode: item.lsCode,
          name: item.name,
          unit: item.baseUnit,
        }))}
        purchaseRequests={purchaseRequests}
        receiverName={actor.name ?? ''}
      />
    </div>
  )
}
