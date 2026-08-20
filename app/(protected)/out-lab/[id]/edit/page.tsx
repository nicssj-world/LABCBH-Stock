import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { OutLabContractForm } from '@/components/out-lab/OutLabContractForm'
import { hasAppRole, isAdministrator } from '@/lib/auth/access'
import { requireActor } from '@/lib/auth/actor'
import { getOutLabContract } from '@/lib/out-lab/queries'

interface EditOutLabContractPageProps {
  params: Promise<{ id: string }>
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function EditOutLabContractPage({ params }: EditOutLabContractPageProps) {
  const [actor, { id }] = await Promise.all([requireActor(), params])
  if (!hasAppRole(actor, 'admin', 'head')) redirect('/access-denied')
  if (!UUID.test(id)) notFound()

  // An archived row is deliberately not editable; restore it first.
  const record = await getOutLabContract(id)
  if (!record) notFound()

  return (
    <div className="route-stack">
      <header className="page-heading page-heading--actions">
        <div>
          <p className="section-kicker">EDIT OUT LAB CONTRACT</p>
          <h1>แก้ไขสัญญา Out Lab</h1>
          <p>{record.displayName}</p>
        </div>
        <Link className="lab-link-button lab-link-button--secondary" href={`/out-lab/${record.id}`}>
          กลับหน้ารายละเอียด
        </Link>
      </header>
      <OutLabContractForm mode="edit" contract={record} isAdmin={isAdministrator(actor)} />
    </div>
  )
}
