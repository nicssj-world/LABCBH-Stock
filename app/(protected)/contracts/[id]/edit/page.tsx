import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ContractForm } from '@/components/contracts/ContractForm'
import { hasAppRole } from '@/lib/auth/access'
import { requireActor } from '@/lib/auth/actor'
import { getContract } from '@/lib/contracts/queries'

interface EditContractPageProps {
  params: Promise<{ id: string }>
}

export default async function EditContractPage({ params }: EditContractPageProps) {
  const actor = await requireActor()
  if (!hasAppRole(actor, 'admin', 'head')) redirect('/access-denied')
  const { id } = await params
  const contractId = Number(id)
  if (!Number.isInteger(contractId) || contractId <= 0) notFound()
  const contract = await getContract(contractId)
  if (!contract) notFound()

  return (
    <div className="route-stack">
      <header className="page-heading page-heading--actions">
        <div>
          <p className="section-kicker">EDIT CONTRACT</p>
          <h1>แก้ไขข้อมูลสัญญา</h1>
          <p>{contract.displayName?.trim() || contract.product}</p>
        </div>
        <Link className="lab-link-button lab-link-button--secondary" href={`/contracts/${contract.id}`}>กลับรายละเอียด</Link>
      </header>
      <ContractForm mode="edit" contract={contract} />
    </div>
  )
}
