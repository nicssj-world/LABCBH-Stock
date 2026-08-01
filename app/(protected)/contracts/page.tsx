import Link from 'next/link'
import { ContractFilters } from '@/components/contracts/ContractFilters'
import { ContractTable } from '@/components/contracts/ContractTable'
import { CONTRACT_TYPE_LABELS, PROCUREMENT_STAGE_LABELS, presentContract } from '@/lib/contracts/presenter'
import { CONTRACT_TYPES } from '@/lib/contracts/schema'
import { listContracts } from '@/lib/contracts/queries'
import { PROCUREMENT_STAGES } from '@/lib/contracts/stages'

interface ContractsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value

export default async function ContractsPage({ searchParams }: ContractsPageProps) {
  const params = await searchParams
  const fiscalYearValue = first(params.fiscalYear)
  const contractTypeValue = first(params.contractType)
  const stageValue = first(params.stage)
  const search = first(params.search)?.trim() ?? ''
  const showEnded = first(params.showEnded) === '1'
  const fiscalYear = fiscalYearValue && /^\d{4}$/.test(fiscalYearValue) ? Number(fiscalYearValue) : undefined
  const contractType = CONTRACT_TYPES.find((type) => type === contractTypeValue)
  const procurementStage = PROCUREMENT_STAGES.find((stage) => stage === stageValue)

  let contracts: Awaited<ReturnType<typeof listContracts>> = []
  let error: string | null = null
  try {
    contracts = await listContracts({ fiscalYear, contractType, procurementStage, search })
  } catch (caught) {
    error = caught instanceof Error ? caught.message : 'อ่านรายการสัญญาไม่สำเร็จ'
  }

  const presentedContracts = contracts.map(presentContract)
  const endedContracts = presentedContracts.filter((contract) => contract.effectiveStatus === 'expired')
  const visibleContracts = showEnded
    ? presentedContracts
    : presentedContracts.filter((contract) => contract.effectiveStatus !== 'expired')
  const grouped = new Map<string, ReturnType<typeof presentContract>[]>()
  for (const contract of visibleContracts) {
    const key = contract.fiscalYear ? String(contract.fiscalYear) : 'unknown'
    grouped.set(key, [...(grouped.get(key) ?? []), contract])
  }
  const thisFiscalYear = new Date().getFullYear() + (new Date().getMonth() >= 9 ? 544 : 543)
  const fiscalYears = Array.from({ length: 7 }, (_, index) => thisFiscalYear + 1 - index)
  const preservedFilters = new URLSearchParams()
  if (fiscalYear) preservedFilters.set('fiscalYear', String(fiscalYear))
  if (contractType) preservedFilters.set('contractType', contractType)
  if (procurementStage) preservedFilters.set('stage', procurementStage)
  if (search) preservedFilters.set('search', search)
  if (!showEnded) preservedFilters.set('showEnded', '1')
  const toggleQuery = preservedFilters.toString()
  const endedContractsHref = toggleQuery ? `/contracts?${toggleQuery}` : '/contracts'

  return (
    <div className="route-stack">
      <header className="page-heading page-heading--actions">
        <div>
          <p className="section-kicker">CONTRACT REGISTER</p>
          <h1>รายการสัญญาทั้งหมด</h1>
          <p>ติดตามสัญญาตามปีงบประมาณ ประเภท และขั้นตอนจัดซื้อ</p>
        </div>
        <div className="page-heading__actions">
          {(showEnded || endedContracts.length > 0) && (
            <Link className="lab-link-button lab-link-button--secondary contracts-visibility-toggle" href={endedContractsHref}>
              {showEnded ? 'ซ่อนสัญญาที่สิ้นสุดแล้ว' : `แสดงสัญญาที่สิ้นสุดแล้ว (${endedContracts.length})`}
            </Link>
          )}
          <Link className="lab-link-button lab-link-button--primary" href="/contracts/new">เพิ่มสัญญา</Link>
        </div>
      </header>

      <ContractFilters
        search={search}
        fiscalYear={fiscalYear ? String(fiscalYear) : ''}
        contractType={contractType ?? ''}
        procurementStage={procurementStage ?? ''}
        showEnded={showEnded}
        fiscalYears={fiscalYears}
        contractTypes={CONTRACT_TYPES.map((type) => ({ value: type, label: CONTRACT_TYPE_LABELS[type] }))}
        procurementStages={PROCUREMENT_STAGES.map((stage) => ({ value: stage, label: PROCUREMENT_STAGE_LABELS[stage] }))}
      />

      {error ? (
        <section className="error-state" role="alert">
          <h2>ไม่สามารถแสดงรายการสัญญาได้</h2>
          <p>{error}</p>
          <Link className="text-link" href="/contracts">ลองโหลดข้อมูลอีกครั้ง</Link>
        </section>
      ) : grouped.size === 0 ? (
        <section className="empty-state empty-state--panel">
          <h2>{showEnded ? 'ไม่พบสัญญาตามตัวกรอง' : 'ไม่พบสัญญาที่ยังไม่สิ้นสุด'}</h2>
          <p>{showEnded ? 'ลองล้างตัวกรอง หรือเพิ่มสัญญาใหม่เพื่อเริ่มต้นทะเบียน' : 'เลือกแสดงสัญญาที่สิ้นสุดแล้ว หากต้องการตรวจสอบข้อมูลย้อนหลัง'}</p>
        </section>
      ) : (
        Array.from(grouped.entries()).map(([year, yearContracts]) => (
          <section className="bench-panel contract-year-group" key={year} aria-labelledby={`fiscal-year-${year}`}>
            <div className="bench-panel__header">
              <div>
                <p className="section-kicker">FISCAL GROUP</p>
                <h2 id={`fiscal-year-${year}`}>{year === 'unknown' ? 'ไม่ระบุปี' : `ปีงบประมาณ ${year}`}</h2>
              </div>
              <p>{yearContracts.length} สัญญา</p>
            </div>
            <ContractTable contracts={yearContracts} />
          </section>
        ))
      )}
    </div>
  )
}
