import Link from 'next/link'
import { redirect } from 'next/navigation'
import { OutLabContractForm } from '@/components/out-lab/OutLabContractForm'
import { hasAppRole, isAdministrator } from '@/lib/auth/access'
import { requireActor } from '@/lib/auth/actor'

export default async function NewOutLabContractPage() {
  const actor = await requireActor()
  if (!hasAppRole(actor, 'admin', 'head')) redirect('/access-denied')

  return (
    <div className="route-stack">
      <header className="page-heading page-heading--actions">
        <div>
          <p className="section-kicker">NEW OUT LAB CONTRACT</p>
          <h1>เพิ่มสัญญา Out Lab</h1>
          <p>เลือกรูปแบบงบก่อน เพราะเป็นตัวกำหนดว่าระบบจะคุมเพดานอย่างไรและมีขั้นตอนจัดซื้อหรือไม่</p>
        </div>
        <Link className="lab-link-button lab-link-button--secondary" href="/out-lab">กลับทะเบียน Out Lab</Link>
      </header>
      <OutLabContractForm mode="create" isAdmin={isAdministrator(actor)} />
    </div>
  )
}
