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
  const showOlder = first(params.showOlder) === '1'
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

  const thisFiscalYear = new Date().getFullYear() + (new Date().getMonth() >= 9 ? 544 : 543)
  const oldestDefaultFiscalYear = thisFiscalYear - 4
  const presentedContracts = contracts.map(presentContract)
  const endedContracts = presentedContracts.filter((contract) => contract.effectiveStatus === 'expired')
  const statusVisibleContracts = showEnded
    ? presentedContracts
    : presentedContracts.filter((contract) => contract.effectiveStatus !== 'expired')
  const olderContracts = statusVisibleContracts.filter((contract) => (
    contract.fiscalYear !== null && contract.fiscalYear < oldestDefaultFiscalYear
  ))
  const visibleContracts = showOlder || fiscalYear
    ? statusVisibleContracts
    : statusVisibleContracts.filter((contract) => (
      contract.fiscalYear === null || contract.fiscalYear >= oldestDefaultFiscalYear
    ))
  const grouped = new Map<string, ReturnType<typeof presentContract>[]>()
  for (const contract of visibleContracts) {
    const key = contract.fiscalYear ? String(contract.fiscalYear) : 'unknown'
    grouped.set(key, [...(grouped.get(key) ?? []), contract])
  }
  const fiscalYears = Array.from({ length: 7 }, (_, index) => thisFiscalYear + 1 - index)
  const activeParams = new URLSearchParams()
  if (fiscalYear) activeParams.set('fiscalYear', String(fiscalYear))
  if (contractType) activeParams.set('contractType', contractType)
  if (procurementStage) activeParams.set('stage', procurementStage)
  if (search) activeParams.set('search', search)
  if (showEnded) activeParams.set('showEnded', '1')
  if (showOlder) activeParams.set('showOlder', '1')
  const toggleHref = (params: URLSearchParams) => {
    const query = params.toString()
    return query ? `/contracts?${query}` : '/contracts'
  }
  const endedToggleParams = new URLSearchParams(activeParams)
  if (showEnded) endedToggleParams.delete('showEnded')
  else endedToggleParams.set('showEnded', '1')
  const endedContractsHref = toggleHref(endedToggleParams)
  const olderToggleParams = new URLSearchParams(activeParams)
  if (showOlder) olderToggleParams.delete('showOlder')
  else olderToggleParams.set('showOlder', '1')
  const olderContractsHref = toggleHref(olderToggleParams)

  return (
    <div className="route-stack">
      <header className="page-heading page-heading--actions">
        <div>
          <p className="section-kicker">CONTRACT REGISTER</p>
          <h1>รายการสัญญาทั้งหมด</h1>
          <p>ติดตามสัญญาตามปีงบประมาณ ประเภท และขั้นตอนจัดซื้อ</p>
        </div>
        <div className="page-heading__actions">
          {(showOlder || (!fiscalYear && olderContracts.length > 0)) && (
            <Link className="lab-link-button lab-link-button--secondary contracts-visibility-toggle" href={olderContractsHref}>
              {showOlder ? 'ซ่อนปีเก่า' : `แสดงปีเก่าทั้งหมด (${olderContracts.length})`}
            </Link>
          )}
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
        showOlder={showOlder}
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
          <h2>{showEnded ? 'ไม่พบสัญญาตามตัวกรอง' : !showOlder && !fiscalYear && olderContracts.length > 0 ? 'ไม่พบสัญญาใน 5 ปีล่าสุด' : 'ไม่พบสัญญาที่ยังไม่สิ้นสุด'}</h2>
          <p>{showEnded ? 'ลองล้างตัวกรอง หรือเพิ่มสัญญาใหม่เพื่อเริ่มต้นทะเบียน' : !showOlder && !fiscalYear && olderContracts.length > 0 ? 'เลือกแสดงปีเก่าทั้งหมด หากต้องการตรวจสอบสัญญาย้อนหลัง' : 'เลือกแสดงสัญญาที่สิ้นสุดแล้ว หากต้องการตรวจสอบข้อมูลย้อนหลัง'}</p>
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
