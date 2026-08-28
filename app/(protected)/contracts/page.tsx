import Link from 'next/link'
import { ContractFilters } from '@/components/contracts/ContractFilters'
import { ContractTable } from '@/components/contracts/ContractTable'
import { ListPagination } from '@/components/ui/ListPagination'
import { canOperateStock, hasAppRole } from '@/lib/auth/access'
import { requireActor } from '@/lib/auth/actor'
import { CONTRACT_TYPE_LABELS, PROCUREMENT_STAGE_LABELS, contractNeedsWatch, presentContract } from '@/lib/contracts/presenter'
import type { PresentedContract } from '@/lib/contracts/presenter'
import { CONTRACT_DEPARTMENTS, CONTRACT_DURATION_YEARS, CONTRACT_TYPES } from '@/lib/contracts/schema'
import { listContracts } from '@/lib/contracts/queries'
import { PROCUREMENT_STAGES } from '@/lib/contracts/stages'
import { bangkokIsoDate } from '@/lib/date/thai'
import {
  contractMatchesExecutiveFollowUp,
  executiveFollowUpCategoryLabel,
  isExecutiveContractFollowUpCategory,
  type ExecutiveContractFollowUpCategory,
} from '@/lib/dashboard/follow-up'
import { LIST_PAGE_SIZE, paginate, parsePage } from '@/lib/pagination'

interface ContractsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value

function matchesExecutiveIssue(
  contract: PresentedContract,
  issue: ExecutiveContractFollowUpCategory,
  fiscalYear: number,
): boolean {
  return contractMatchesExecutiveFollowUp({
    contractType: contract.contractType,
    fiscalYear: contract.fiscalYear,
    durationYears: contract.contractDurationYears,
    status: contract.status,
    total: contract.total,
    startDate: contract.startDate,
    endDate: contract.endDate,
    usages: contract.usage ?? [],
  }, issue, fiscalYear)
}

export default async function ContractsPage({ searchParams }: ContractsPageProps) {
  const actor = await requireActor()
  const isAdmin = hasAppRole(actor, 'admin')
  const canCreateContract = canOperateStock(actor)
  const params = await searchParams
  const fiscalYearValue = first(params.fiscalYear)
  const contractTypeValue = first(params.contractType)
  const contractDurationYearsValue = first(params.contractDurationYears)
  const departmentValue = first(params.department)
  const stageValue = first(params.stage)
  const issueValue = first(params.issue)
  const followUpYearValue = first(params.followUpYear)
  const search = first(params.search)?.trim() ?? ''
  const showEnded = first(params.showEnded) === '1'
  const showOlder = first(params.showOlder) === '1'
  const page = parsePage(first(params.page))
  // Ended contracts and the watchlist are separate views. If an older URL
  // contains both flags, ended contracts must win because contractNeedsWatch
  // intentionally excludes them.
  const showWatchlist = !showEnded && first(params.watchlist) === '1'
  const showArchived = isAdmin && first(params.showArchived) === '1'
  const fiscalYear = fiscalYearValue && /^\d{4}$/.test(fiscalYearValue) ? Number(fiscalYearValue) : undefined
  const issue = isExecutiveContractFollowUpCategory(issueValue) ? issueValue : undefined
  const parsedFollowUpYear = followUpYearValue && /^\d{4}$/.test(followUpYearValue) ? Number(followUpYearValue) : undefined
  const contractType = CONTRACT_TYPES.find((type) => type === contractTypeValue)
  const contractDurationYears = CONTRACT_DURATION_YEARS.find((years) => String(years) === contractDurationYearsValue)
  const department = CONTRACT_DEPARTMENTS.find((dept) => dept === departmentValue)
  const procurementStage = PROCUREMENT_STAGES.find((stage) => stage === stageValue)

  // Archived is a distinct admin-only recovery view (find a mistakenly
  // archived contract to restore), not another filter on the normal
  // register, so it bypasses the fiscal-year grouping entirely.
  if (showArchived) {
    let archivedContracts: Awaited<ReturnType<typeof listContracts>> = []
    let archivedError: string | null = null
    try {
      archivedContracts = await listContracts({ includeArchived: true })
    } catch (caught) {
      archivedError = caught instanceof Error ? caught.message : 'อ่านรายการสัญญาที่ถูกลบไม่สำเร็จ'
    }
    const presentedArchived = archivedContracts.map(presentContract)
    const paginatedArchived = paginate(presentedArchived, page, LIST_PAGE_SIZE)
    const buildArchivedPageHref = (nextPage: number) => `/contracts?showArchived=1${nextPage > 1 ? `&page=${nextPage}` : ''}`

    return (
      <div className="route-stack">
        <header className="page-heading page-heading--actions">
          <div>
            <p className="section-kicker">ADMIN CLEANUP</p>
            <h1>สัญญาที่ถูกลบออกจากรายการใช้งาน</h1>
            <p>สัญญาที่ถูกลบด้วยเหตุผลสร้างผิดหรือซ้ำ กู้คืนได้จากหน้ารายละเอียดของสัญญานั้น</p>
          </div>
          <div className="page-heading__actions">
            <Link className="lab-link-button lab-link-button--secondary contracts-visibility-toggle" href="/contracts">
              กลับไปรายการสัญญาปกติ
            </Link>
          </div>
        </header>

        {archivedError ? (
          <section className="error-state" role="alert">
            <h2>ไม่สามารถแสดงรายการสัญญาที่ถูกลบได้</h2>
            <p>{archivedError}</p>
          </section>
        ) : presentedArchived.length === 0 ? (
          <section className="empty-state empty-state--panel">
            <h2>ไม่มีสัญญาที่ถูกลบ</h2>
            <p>ยังไม่มีสัญญาใดถูกลบออกจากรายการใช้งานในระบบนี้</p>
          </section>
        ) : (
          <section className="bench-panel contract-year-group" aria-labelledby="archived-contracts-title">
            <div className="bench-panel__header">
              <div>
                <p className="section-kicker">ARCHIVED</p>
                <h2 id="archived-contracts-title">สัญญาที่ถูกลบ</h2>
              </div>
              <p>{presentedArchived.length} สัญญา</p>
            </div>
            <ContractTable contracts={paginatedArchived.items} />
            <ListPagination
              currentPage={paginatedArchived.currentPage}
              pageCount={paginatedArchived.pageCount}
              totalCount={paginatedArchived.totalCount}
              startIndex={paginatedArchived.startIndex}
              pageSize={LIST_PAGE_SIZE}
              itemLabel="สัญญา"
              buildHref={buildArchivedPageHref}
            />
          </section>
        )}
      </div>
    )
  }

  let contracts: Awaited<ReturnType<typeof listContracts>> = []
  let error: string | null = null
  try {
    contracts = await listContracts({ fiscalYear, contractType, contractDurationYears, department, procurementStage, search })
  } catch (caught) {
    error = caught instanceof Error ? caught.message : 'อ่านรายการสัญญาไม่สำเร็จ'
  }

  const [currentYear, currentMonth] = bangkokIsoDate().split('-').map(Number)
  const thisFiscalYear = currentYear + (currentMonth >= 10 ? 544 : 543)
  const oldestDefaultFiscalYear = thisFiscalYear - 4
  const presentedContracts = contracts.map(presentContract)
  const endedContracts = presentedContracts.filter((contract) => contract.effectiveStatus === 'expired')
  const statusVisibleContracts = showEnded
    ? presentedContracts.filter((contract) => contract.effectiveStatus === 'expired')
    : presentedContracts.filter((contract) => contract.effectiveStatus !== 'expired')
  const olderContracts = statusVisibleContracts.filter((contract) => (
    contract.fiscalYear !== null && contract.fiscalYear < oldestDefaultFiscalYear
  ))
  const watchlistContracts = statusVisibleContracts.filter(contractNeedsWatch)
  const issueFiscalYear = parsedFollowUpYear ?? thisFiscalYear
  const issueContracts = issue
    ? presentedContracts.filter((contract) => matchesExecutiveIssue(contract, issue, issueFiscalYear))
    : []
  // A contract needing attention must surface even if its fiscal year would
  // otherwise be hidden behind the default 5-year window.
  const visibleContracts = issue
    ? issueContracts
    : showWatchlist
      ? watchlistContracts
      : showOlder || fiscalYear
        ? statusVisibleContracts
        : statusVisibleContracts.filter((contract) => (
          contract.fiscalYear === null || contract.fiscalYear >= oldestDefaultFiscalYear
        ))
  const paginatedContracts = paginate(visibleContracts, page, LIST_PAGE_SIZE)
  const grouped = new Map<string, ReturnType<typeof presentContract>[]>()
  for (const contract of paginatedContracts.items) {
    const key = contract.fiscalYear ? String(contract.fiscalYear) : 'unknown'
    grouped.set(key, [...(grouped.get(key) ?? []), contract])
  }
  const fiscalYears = Array.from({ length: 7 }, (_, index) => thisFiscalYear + 1 - index)
  const activeParams = new URLSearchParams()
  if (fiscalYear) activeParams.set('fiscalYear', String(fiscalYear))
  if (contractType) activeParams.set('contractType', contractType)
  if (contractDurationYears) activeParams.set('contractDurationYears', String(contractDurationYears))
  if (department) activeParams.set('department', department)
  if (procurementStage) activeParams.set('stage', procurementStage)
  if (search) activeParams.set('search', search)
  if (showEnded) activeParams.set('showEnded', '1')
  if (showOlder) activeParams.set('showOlder', '1')
  if (showWatchlist) activeParams.set('watchlist', '1')
  if (issue) activeParams.set('issue', issue)
  if (parsedFollowUpYear) activeParams.set('followUpYear', String(parsedFollowUpYear))
  const toggleHref = (params: URLSearchParams) => {
    const query = params.toString()
    return query ? `/contracts?${query}` : '/contracts'
  }
  const endedToggleParams = new URLSearchParams(activeParams)
  if (showEnded) endedToggleParams.delete('showEnded')
  else {
    endedToggleParams.set('showEnded', '1')
    endedToggleParams.delete('watchlist')
  }
  const buildPageHref = (nextPage: number) => {
    const nextParams = new URLSearchParams(activeParams)
    if (nextPage > 1) nextParams.set('page', String(nextPage))
    const query = nextParams.toString()
    return query ? `/contracts?${query}` : '/contracts'
  }
  const endedContractsHref = toggleHref(endedToggleParams)
  const olderToggleParams = new URLSearchParams(activeParams)
  if (showOlder) olderToggleParams.delete('showOlder')
  else olderToggleParams.set('showOlder', '1')
  const olderContractsHref = toggleHref(olderToggleParams)
  const watchlistToggleParams = new URLSearchParams(activeParams)
  if (showWatchlist) watchlistToggleParams.delete('watchlist')
  else {
    watchlistToggleParams.set('watchlist', '1')
    watchlistToggleParams.delete('showEnded')
  }
  const watchlistHref = toggleHref(watchlistToggleParams)
  const clearIssueParams = new URLSearchParams(activeParams)
  clearIssueParams.delete('issue')
  clearIssueParams.delete('followUpYear')
  if (issue) clearIssueParams.delete('showOlder')
  const clearIssueHref = toggleHref(clearIssueParams)
  const issueLabel = issue ? executiveFollowUpCategoryLabel(issue) : null

  return (
    <div className="route-stack">
      <header className="page-heading page-heading--actions">
        <div>
          <p className="section-kicker">CONTRACT REGISTER</p>
          <h1>รายการสัญญาทั้งหมด</h1>
          <p>{issueLabel ? `แสดงเฉพาะรายการจากประเด็น “${issueLabel}” ที่พบใน Dashboard ผู้บริหาร` : 'ติดตามสัญญาตามปีงบประมาณ ประเภท และขั้นตอนจัดซื้อ'}</p>
        </div>
        <div className="page-heading__actions">
          {!issue && (showOlder || (!fiscalYear && olderContracts.length > 0)) && (
            <Link className="lab-link-button lab-link-button--secondary contracts-visibility-toggle" href={olderContractsHref}>
              {showOlder ? 'ซ่อนปีเก่า' : `แสดงปีเก่าทั้งหมด (${olderContracts.length})`}
            </Link>
          )}
          {!issue && (showEnded || endedContracts.length > 0) && (
            <Link className="lab-link-button lab-link-button--secondary contracts-visibility-toggle" href={endedContractsHref}>
              {showEnded ? 'ซ่อนสัญญาที่สิ้นสุดแล้ว' : `แสดงสัญญาที่สิ้นสุดแล้ว (${endedContracts.length})`}
            </Link>
          )}
          {!issue && (showWatchlist || watchlistContracts.length > 0) && (
            <Link className="lab-link-button lab-link-button--secondary contracts-visibility-toggle" href={watchlistHref}>
              {showWatchlist ? 'แสดงสัญญาทั้งหมด' : `เฉพาะสัญญาที่ต้องเฝ้าระวัง (${watchlistContracts.length})`}
            </Link>
          )}
          {isAdmin && (
            <Link className="lab-link-button lab-link-button--secondary contracts-visibility-toggle" href="/contracts?showArchived=1">
              สัญญาที่ถูกลบ
            </Link>
          )}
          {canCreateContract && (
            <Link className="lab-link-button lab-link-button--primary" href="/contracts/new">เพิ่มสัญญา</Link>
          )}
        </div>
      </header>

      <ContractFilters
        search={search}
        fiscalYear={fiscalYear ? String(fiscalYear) : ''}
        contractType={contractType ?? ''}
        contractDurationYears={contractDurationYears ? String(contractDurationYears) : ''}
        department={department ?? ''}
        procurementStage={procurementStage ?? ''}
        showEnded={showEnded}
        showOlder={showOlder}
        showWatchlist={showWatchlist}
        fiscalYears={fiscalYears}
        contractTypes={CONTRACT_TYPES.map((type) => ({ value: type, label: CONTRACT_TYPE_LABELS[type] }))}
        departments={[...CONTRACT_DEPARTMENTS]}
        procurementStages={PROCUREMENT_STAGES.map((stage) => ({ value: stage, label: PROCUREMENT_STAGE_LABELS[stage] }))}
      />

      {issueLabel && (
        <p className="inline-alert inline-alert--info" role="status">
          ตัวกรองจาก Dashboard ผู้บริหาร: <strong>{issueLabel}</strong> · พบ {visibleContracts.length.toLocaleString('th-TH')} รายการ
          {' '}<Link className="text-link" href={clearIssueHref}>แสดงทะเบียนสัญญาตามปกติ</Link>
        </p>
      )}

      {error ? (
        <section className="error-state" role="alert">
          <h2>ไม่สามารถแสดงรายการสัญญาได้</h2>
          <p>{error}</p>
          <Link className="text-link" href="/contracts">ลองโหลดข้อมูลอีกครั้ง</Link>
        </section>
      ) : grouped.size === 0 ? (
        <section className="empty-state empty-state--panel">
          <h2>{issueLabel ? `ไม่พบสัญญาที่ตรงกับประเด็น “${issueLabel}”` : showWatchlist ? 'ไม่มีสัญญาที่ต้องเฝ้าระวัง' : showEnded ? 'ไม่พบสัญญาตามตัวกรอง' : !showOlder && !fiscalYear && olderContracts.length > 0 ? 'ไม่พบสัญญาใน 5 ปีล่าสุด' : 'ไม่พบสัญญาที่ยังไม่สิ้นสุด'}</h2>
          <p>{issueLabel ? 'ข้อมูลบน Dashboard อาจเปลี่ยนแปลงแล้ว หรือยังไม่มีรายการที่ตรงกับประเด็นนี้' : showWatchlist ? 'ไม่มีสัญญาที่ใกล้สิ้นสุดหรือคงเหลือน้อยกว่า 30% ตามตัวกรองอื่นที่เลือกไว้' : showEnded ? 'ลองล้างตัวกรอง หรือเพิ่มสัญญาใหม่เพื่อเริ่มต้นทะเบียน' : !showOlder && !fiscalYear && olderContracts.length > 0 ? 'เลือกแสดงปีเก่าทั้งหมด หากต้องการตรวจสอบสัญญาย้อนหลัง' : 'เลือกแสดงสัญญาที่สิ้นสุดแล้ว หากต้องการตรวจสอบข้อมูลย้อนหลัง'}</p>
        </section>
      ) : (
        <>
          {Array.from(grouped.entries()).map(([year, yearContracts]) => (
            <section className="bench-panel contract-year-group" key={year} aria-labelledby={`fiscal-year-${year}`}>
              <div className="bench-panel__header">
                <div>
                  <p className="section-kicker">FISCAL GROUP</p>
                  <h2 id={`fiscal-year-${year}`}>{year === 'unknown' ? 'ไม่ระบุปี' : `ปีงบประมาณ ${year}`}</h2>
                </div>
                <p>{yearContracts.length} สัญญาในหน้านี้</p>
              </div>
              <ContractTable contracts={yearContracts} />
            </section>
          ))}
          <ListPagination
            currentPage={paginatedContracts.currentPage}
            pageCount={paginatedContracts.pageCount}
            totalCount={paginatedContracts.totalCount}
            startIndex={paginatedContracts.startIndex}
            pageSize={LIST_PAGE_SIZE}
            itemLabel="สัญญา"
            buildHref={buildPageHref}
          />
        </>
      )}
    </div>
  )
}
