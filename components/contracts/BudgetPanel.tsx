import { BudgetGauge } from '@/components/contracts/BudgetGauge'
import { ContractFileCard } from '@/components/contracts/ContractFileCard'
import { ExpenseForm } from '@/components/contracts/ExpenseForm'
import { ExpenseHistory } from '@/components/contracts/ExpenseHistory'
import { ResponsibleUserPicker } from '@/components/contracts/ResponsibleUserPicker'
import { isLowBudget } from '@/lib/contracts/budget'
import {
  fetchContractBudget,
  fetchResponsibleCandidates,
} from '@/lib/contracts/budget-queries'

interface BudgetPanelProps {
  contractId: number
  contractNumber: string | null
  displayName: string | null
  total: number | null
  startDate: string | null
  endDate: string | null
  filePath: string | null
  responsibleUserIds: string[]
  canRecord: boolean
  canEdit: boolean
}

/**
 * Budget mode: an equipment lease is drawn down in baht per month against the
 * contract value, with no line items. Rendered only for that contract type.
 */
export async function BudgetPanel({
  contractId,
  contractNumber,
  displayName,
  total,
  startDate,
  endDate,
  filePath,
  responsibleUserIds,
  canRecord,
  canEdit,
}: BudgetPanelProps) {
  const { entries, snapshot } = await fetchContractBudget(contractId, total)
  const lowBudget = isLowBudget(total, snapshot.used)
  const candidates = canEdit ? await fetchResponsibleCandidates() : []

  return (
    <>
      <section className="bench-panel" aria-labelledby="contract-budget-title">
        <div className="bench-panel__header">
          <div>
            <p className="section-kicker">LEASE BUDGET</p>
            <h2 id="contract-budget-title">งบประมาณตามสัญญาเช่า</h2>
          </div>
          <p>
            {entries.length} รายการบันทึก
          </p>
        </div>

        <BudgetGauge total={total} snapshot={snapshot} lowBudget={lowBudget} />

        {canRecord && (
          <ExpenseForm
            contractId={contractId}
            startDate={startDate}
            endDate={endDate}
            remaining={snapshot.remaining}
          />
        )}
      </section>

      <section className="bench-panel" aria-labelledby="contract-expense-title">
        <div className="bench-panel__header">
          <div>
            <p className="section-kicker">MONTHLY DRAWDOWN</p>
            <h2 id="contract-expense-title">ประวัติการใช้จ่ายรายเดือน</h2>
          </div>
        </div>
        <ExpenseHistory
          contractId={contractId}
          contractNumber={contractNumber}
          displayName={displayName}
          entries={entries}
          canRecord={canRecord}
        />
      </section>

      <section className="bench-panel" aria-labelledby="contract-responsible-title">
        <div className="bench-panel__header">
          <div>
            <p className="section-kicker">ACCOUNTABILITY</p>
            <h2 id="contract-responsible-title">ผู้รับผิดชอบสัญญา</h2>
          </div>
          <p>บันทึกค่าใช้จ่ายของสัญญานี้ได้ แม้ไม่มีสิทธิ์แก้ไขสัญญา</p>
        </div>
        <ResponsibleUserPicker
          contractId={contractId}
          candidates={candidates}
          selected={responsibleUserIds}
          canEdit={canEdit}
        />
      </section>

      <section className="bench-panel" aria-labelledby="contract-file-title">
        <div className="bench-panel__header">
          <div>
            <p className="section-kicker">CONTRACT DOCUMENT</p>
            <h2 id="contract-file-title">ไฟล์สัญญา</h2>
          </div>
        </div>
        <ContractFileCard contractId={contractId} filePath={filePath} canEdit={canEdit} />
      </section>
    </>
  )
}
