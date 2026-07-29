import Link from 'next/link'
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

  const grouped = new Map<string, ReturnType<typeof presentContract>[]>()
  for (const contract of contracts.map(presentContract)) {
    const key = contract.fiscalYear ? String(contract.fiscalYear) : 'unknown'
    grouped.set(key, [...(grouped.get(key) ?? []), contract])
  }
  const thisFiscalYear = new Date().getFullYear() + (new Date().getMonth() >= 9 ? 544 : 543)
  const fiscalYears = Array.from({ length: 7 }, (_, index) => thisFiscalYear + 1 - index)

  return (
    <div className="route-stack">
      <header className="page-heading page-heading--actions">
        <div>
          <p className="section-kicker">CONTRACT REGISTER</p>
          <h1>รายการสัญญาทั้งหมด</h1>
          <p>ติดตามสัญญาตามปีงบประมาณ ประเภท และขั้นตอนจัดซื้อ</p>
        </div>
        <Link className="lab-link-button lab-link-button--primary" href="/contracts/new">เพิ่มสัญญา</Link>
      </header>

      <form className="filter-bench" method="get" aria-label="ตัวกรองรายการสัญญา">
        <label className="filter-bench__search">
          ค้นหา
          <input type="search" name="search" defaultValue={search} placeholder="ชื่อสัญญา คู่สัญญา หรือเลขที่" />
        </label>
        <label>
          ปีงบประมาณ
          <select name="fiscalYear" defaultValue={fiscalYearValue ?? ''}>
            <option value="">ทุกปีงบประมาณ</option>
            {fiscalYears.map((year) => <option value={year} key={year}>{year}</option>)}
          </select>
        </label>
        <label>
          ประเภท
          <select name="contractType" defaultValue={contractType ?? ''}>
            <option value="">ทุกประเภท</option>
            {CONTRACT_TYPES.map((type) => <option value={type} key={type}>{CONTRACT_TYPE_LABELS[type]}</option>)}
          </select>
        </label>
        <label>
          ขั้นตอน
          <select name="stage" defaultValue={procurementStage ?? ''}>
            <option value="">ทุกขั้นตอน</option>
            {PROCUREMENT_STAGES.map((stage) => <option value={stage} key={stage}>{PROCUREMENT_STAGE_LABELS[stage]}</option>)}
          </select>
        </label>
        <button className="lab-button lab-button--primary" type="submit">แสดงผล</button>
        <Link className="lab-link-button lab-link-button--secondary" href="/contracts">ล้างตัวกรอง</Link>
      </form>

      {error ? (
        <section className="error-state" role="alert">
          <h2>ไม่สามารถแสดงรายการสัญญาได้</h2>
          <p>{error}</p>
          <Link className="text-link" href="/contracts">ลองโหลดข้อมูลอีกครั้ง</Link>
        </section>
      ) : grouped.size === 0 ? (
        <section className="empty-state empty-state--panel">
          <h2>ไม่พบสัญญาตามตัวกรอง</h2>
          <p>ลองล้างตัวกรอง หรือเพิ่มสัญญาใหม่เพื่อเริ่มต้นทะเบียน</p>
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
