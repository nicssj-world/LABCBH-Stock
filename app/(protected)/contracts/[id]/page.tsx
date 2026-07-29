import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArchiveContractControl } from '@/components/contracts/ArchiveContractControl'
import { StageAdvanceControl } from '@/components/contracts/StageAdvanceControl'
import { StageTimeline } from '@/components/contracts/StageTimeline'
import { StatusChip } from '@/components/ui/StatusChip'
import { hasAppRole } from '@/lib/auth/access'
import { requireActor } from '@/lib/auth/actor'
import { presentContract } from '@/lib/contracts/presenter'
import { getContract } from '@/lib/contracts/queries'

interface ContractDetailPageProps {
  params: Promise<{ id: string }>
}

const money = new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB', minimumFractionDigits: 2 })
const thaiDate = new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium' })
const displayDate = (value: string | null) => value
  ? thaiDate.format(new Date(`${value}T00:00:00+07:00`))
  : 'ไม่ระบุ'

export default async function ContractDetailPage({ params }: ContractDetailPageProps) {
  const actor = await requireActor()
  const { id } = await params
  const contractId = Number(id)
  if (!Number.isInteger(contractId) || contractId <= 0) notFound()
  const record = await getContract(contractId)
  if (!record) notFound()
  const contract = presentContract(record)
  const canEdit = hasAppRole(actor, 'admin', 'head')
  const total = contract.items.reduce((sum, item) => sum + item.lineTotal, 0)

  return (
    <div className="route-stack">
      <header className="contract-detail-heading">
        <div>
          <Link className="back-link" href="/contracts">← รายการสัญญา</Link>
          <div className="contract-detail-heading__status">
            <StatusChip tone={contract.status === 'active' ? 'success' : 'attention'}>{contract.procurementStageLabel}</StatusChip>
            <span>{contract.contractTypeLabel}</span>
          </div>
          <h1>{contract.resolvedDisplayName}</h1>
          <p className="identifier">{contract.contractNumberLabel}</p>
        </div>
        {canEdit && <Link className="lab-link-button lab-link-button--secondary" href={`/contracts/${contract.id}/edit`}>แก้ไขข้อมูล</Link>}
      </header>

      <section className="contract-facts" aria-label="ข้อมูลสรุปสัญญา">
        <dl>
          <div><dt>ปีงบประมาณ</dt><dd>{contract.fiscalYear ?? 'ไม่ระบุ'}</dd></div>
          <div><dt>คู่สัญญา</dt><dd>{contract.vendor || 'ไม่ระบุ'}</dd></div>
          <div><dt>ระยะเวลา</dt><dd>{displayDate(contract.startDate)} – {displayDate(contract.endDate)}</dd></div>
          <div><dt>มูลค่ารวม</dt><dd className="identifier">{money.format(total)}</dd></div>
        </dl>
      </section>

      <div className="contract-detail-grid">
        <section className="bench-panel contract-history" aria-labelledby="stage-history-title">
          <div className="bench-panel__header">
            <div>
              <p className="section-kicker">PROCUREMENT TRACK</p>
              <h2 id="stage-history-title">ประวัติขั้นตอนสัญญา</h2>
            </div>
            <p>บันทึกตามวันที่มีผลของแต่ละขั้นตอน</p>
          </div>
          <StageTimeline contract={contract} />
        </section>

        {canEdit && contract.procurementStage && (
          <aside className="bench-panel next-action" aria-labelledby="next-action-title">
            <div className="bench-panel__header">
              <div>
                <p className="section-kicker">NEXT ACTION</p>
                <h2 id="next-action-title">ดำเนินการขั้นถัดไป</h2>
              </div>
            </div>
            <StageAdvanceControl contractId={contract.id} currentStage={contract.procurementStage} />
          </aside>
        )}
      </div>

      <section className="bench-panel" aria-labelledby="contract-lines-title">
        <div className="bench-panel__header">
          <div>
            <p className="section-kicker">CONTRACT LINES</p>
            <h2 id="contract-lines-title">รายการน้ำยาในสัญญา</h2>
          </div>
          <p>{contract.items.length} รายการ · {money.format(total)}</p>
        </div>
        {contract.items.length === 0 ? <p className="empty-state">ยังไม่มีรายการน้ำยา</p> : (
          <div className="detail-items-table">
            <table className="data-table">
              <thead><tr><th>รหัส LS</th><th>ชื่อน้ำยา</th><th className="numeric-cell">จำนวน</th><th>หน่วย</th><th className="numeric-cell">ราคาต่อหน่วย</th><th className="numeric-cell">รวม</th></tr></thead>
              <tbody>
                {contract.items.map((item) => (
                  <tr key={item.id}>
                    <td className="identifier">{item.lsCode}</td>
                    <td>{item.name}</td>
                    <td className="numeric-cell identifier">{item.quantity.toLocaleString('th-TH')}</td>
                    <td>{item.unit}</td>
                    <td className="numeric-cell identifier">{money.format(item.unitPrice)}</td>
                    <td className="numeric-cell identifier"><strong>{money.format(item.lineTotal)}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {canEdit && <ArchiveContractControl contractId={contract.id} />}
    </div>
  )
}
