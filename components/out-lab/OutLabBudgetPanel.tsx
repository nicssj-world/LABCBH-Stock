import { BudgetGauge } from '@/components/contracts/BudgetGauge'
import { ExpenseMonthlyChart } from '@/components/contracts/ExpenseMonthlyChart'
import { FiscalYearBreakdown } from '@/components/out-lab/FiscalYearBreakdown'
import { MissingPeriodNotice } from '@/components/out-lab/MissingPeriodNotice'
import { MonthlyUsageForm } from '@/components/out-lab/MonthlyUsageForm'
import { MonthlyUsageHistory } from '@/components/out-lab/MonthlyUsageHistory'
import { expenseMonthlySeries, isLowBudget } from '@/lib/contracts/budget'
import { missingUsagePeriods, usageByFiscalYear } from '@/lib/out-lab/fiscal'
import { OUT_LAB_CADENCE_LABELS, outLabBudgetNotice } from '@/lib/out-lab/presenter'
import { fetchOutLabUsage } from '@/lib/out-lab/queries'
import type { OutLabContractRecord } from '@/lib/out-lab/types'

interface OutLabBudgetPanelProps {
  contract: OutLabContractRecord
  canRecord: boolean
}

export async function OutLabBudgetPanel({ contract, canRecord }: OutLabBudgetPanelProps) {
  const { entries, snapshot } = await fetchOutLabUsage(contract.id, contract.total)
  const lowBudget = isLowBudget(contract.total, snapshot.used)
  const monthlySeries = expenseMonthlySeries(contract.startDate, contract.endDate, entries)
  const notice = outLabBudgetNotice(contract.kind, snapshot)
  const missing = missingUsagePeriods({
    cadence: contract.entryCadence,
    startDate: contract.startDate,
    endDate: contract.endDate,
    entries,
  })
  const isPlan = contract.kind === 'annual_plan'

  return (
    <>
      <section className="bench-panel contract-budget-panel" aria-labelledby="out-lab-budget-title">
        <div className="bench-panel__header">
          <div>
            <p className="section-kicker">{isPlan ? 'ANNUAL PLAN' : 'CONTRACT CEILING'}</p>
            <h2 id="out-lab-budget-title">
              {isPlan ? `งบตามแผน ปีงบประมาณ ${contract.fiscalYear}` : 'งบตามมูลค่าสัญญา'}
            </h2>
          </div>
          <p>{entries.length} เดือนที่บันทึกแล้ว</p>
        </div>

        <BudgetGauge total={contract.total} snapshot={snapshot} lowBudget={lowBudget} />

        {/* An annual plan may legitimately be spent past — the testing already
            happened — so the overrun is reported here rather than refused at
            the write. A contract ceiling can only reach this state through a
            value that was revised downwards afterwards. */}
        {notice && notice.tone === 'over' && (
          <p className="expense-form__budget-alert" role="alert">
            <strong>{notice.label}</strong> {notice.description}
          </p>
        )}

        <MissingPeriodNotice
          periods={missing}
          cadenceLabel={OUT_LAB_CADENCE_LABELS[contract.entryCadence]}
        />

        {canRecord && (
          <MonthlyUsageForm
            contractId={contract.id}
            kind={contract.kind}
            startDate={contract.startDate}
            endDate={contract.endDate}
            remaining={snapshot.remaining}
            entries={entries}
          />
        )}
      </section>

      <section className="bench-panel contract-expense-panel" aria-labelledby="out-lab-usage-title">
        <div className="bench-panel__header">
          <div>
            <p className="section-kicker">MONTHLY DRAWDOWN</p>
            <h2 id="out-lab-usage-title">ยอดใช้จ่ายรายเดือน</h2>
          </div>
        </div>
        <ExpenseMonthlyChart series={monthlySeries} />
        <MonthlyUsageHistory
          contractId={contract.id}
          contractNumber={contract.contractNumber}
          displayName={contract.displayName}
          entries={entries}
          series={monthlySeries}
          canRecord={canRecord}
        />
      </section>

      {/* Only a contract can span more than one fiscal year; an annual plan is
          re-registered each year, so its own page already is the breakdown. */}
      {!isPlan && (
        <section className="bench-panel" aria-labelledby="out-lab-fiscal-title">
          <div className="bench-panel__header">
            <div>
              <p className="section-kicker">BY FISCAL YEAR</p>
              <h2 id="out-lab-fiscal-title">ยอดใช้จ่ายแยกตามปีงบประมาณ</h2>
            </div>
            <p>ข้อมูลประกอบ ไม่ใช่เพดานงบ</p>
          </div>
          <FiscalYearBreakdown usage={usageByFiscalYear(entries)} />
        </section>
      )}
    </>
  )
}
