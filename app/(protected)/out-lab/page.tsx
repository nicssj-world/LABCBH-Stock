import Link from 'next/link'
import { OutLabFilters } from '@/components/out-lab/OutLabFilters'
import { OutLabTable } from '@/components/out-lab/OutLabTable'
import { ListPagination } from '@/components/ui/ListPagination'
import { hasAppRole } from '@/lib/auth/access'
import { requireActor } from '@/lib/auth/actor'
import { bangkokIsoDate } from '@/lib/date/thai'
import { LIST_PAGE_SIZE, paginate, parsePage } from '@/lib/pagination'
import {
  OUT_LAB_CADENCE_LABELS,
  OUT_LAB_CONTRACT_TYPE_LABEL,
  OUT_LAB_KIND_LABELS,
  presentOutLabContract,
} from '@/lib/out-lab/presenter'
import { canCreateOutLabContract } from '@/lib/out-lab/authorization'
import { listOutLabContracts } from '@/lib/out-lab/queries'
import { OUT_LAB_CADENCES, OUT_LAB_DEPARTMENTS, OUT_LAB_KINDS } from '@/lib/out-lab/schema'

interface OutLabPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)

export default async function OutLabPage({ searchParams }: OutLabPageProps) {
  const actor = await requireActor()
  const isAdmin = hasAppRole(actor, 'admin')
  const canCreate = canCreateOutLabContract(actor)
  const params = await searchParams

  const fiscalYearValue = first(params.fiscalYear)
  const search = first(params.search)?.trim() ?? ''
  const showEnded = first(params.showEnded) === '1'
  const showOlder = first(params.showOlder) === '1'
  const showArchived = isAdmin && first(params.showArchived) === '1'
  const page = parsePage(first(params.page))
  const fiscalYear = fiscalYearValue && /^\d{4}$/.test(fiscalYearValue) ? Number(fiscalYearValue) : undefined
  const kind = OUT_LAB_KINDS.find((value) => value === first(params.kind))
  const entryCadence = OUT_LAB_CADENCES.find((value) => value === first(params.cadence))
  const department = OUT_LAB_DEPARTMENTS.find((value) => value === first(params.department))

  // Archived is a distinct admin-only recovery view (find a mistakenly filed
  // row and restore it), not another filter on the normal register, so it
  // bypasses the fiscal-year grouping entirely.
  if (showArchived) {
    let archived: Awaited<ReturnType<typeof listOutLabContracts>> = []
    let archivedError: string | null = null
    try {
      archived = await listOutLabContracts({ includeArchived: true })
    } catch (caught) {
      archivedError = caught instanceof Error ? caught.message : 'อ่านรายการสัญญาที่ถูกลบไม่สำเร็จ'
    }
    const rows = archived.map((contract) => ({ ...contract, ...presentOutLabContract(contract) }))
    const paginated = paginate(rows, page, LIST_PAGE_SIZE)

    return (
      <div className="route-stack">
        <header className="page-heading page-heading--actions">
          <div>
            <p className="section-kicker">ADMIN CLEANUP</p>
            <h1>สัญญา Out Lab ที่ถูกลบ</h1>
            <p>สัญญาที่ถูกลบด้วยเหตุผลสร้างผิดหรือซ้ำ กู้คืนได้จากหน้ารายละเอียดของสัญญานั้น</p>
          </div>
          <div className="page-heading__actions">
            <Link className="lab-link-button lab-link-button--secondary contracts-visibility-toggle" href="/out-lab">
              กลับไปทะเบียนปกติ
            </Link>
          </div>
        </header>

        {archivedError ? (
          <section className="error-state" role="alert">
            <h2>ไม่สามารถแสดงรายการสัญญาที่ถูกลบได้</h2>
            <p>{archivedError}</p>
          </section>
        ) : rows.length === 0 ? (
          <section className="empty-state empty-state--panel">
            <h2>ไม่มีสัญญาที่ถูกลบ</h2>
            <p>ยังไม่มีสัญญา Out Lab ใดถูกลบออกจากทะเบียน</p>
          </section>
        ) : (
          <section className="bench-panel contract-year-group" aria-labelledby="out-lab-archived-title">
            <div className="bench-panel__header">
              <div>
                <p className="section-kicker">ARCHIVED</p>
                <h2 id="out-lab-archived-title">สัญญาที่ถูกลบ</h2>
              </div>
              <p>{rows.length} สัญญา</p>
            </div>
            <OutLabTable contracts={paginated.items} />
            <ListPagination
              currentPage={paginated.currentPage}
              pageCount={paginated.pageCount}
              totalCount={paginated.totalCount}
              startIndex={paginated.startIndex}
              pageSize={LIST_PAGE_SIZE}
              itemLabel="สัญญา"
              buildHref={(nextPage) => `/out-lab?showArchived=1${nextPage > 1 ? `&page=${nextPage}` : ''}`}
            />
          </section>
        )}
      </div>
    )
  }

  let contracts: Awaited<ReturnType<typeof listOutLabContracts>> = []
  let error: string | null = null
  try {
    contracts = await listOutLabContracts({ fiscalYear, kind, entryCadence, department, search })
  } catch (caught) {
    error = caught instanceof Error ? caught.message : 'อ่านทะเบียนสัญญา Out Lab ไม่สำเร็จ'
  }

  const [currentYear, currentMonth] = bangkokIsoDate().split('-').map(Number)
  const thisFiscalYear = currentYear + (currentMonth >= 10 ? 544 : 543)
  const oldestDefaultFiscalYear = thisFiscalYear - 4
  const rows = contracts.map((contract) => ({ ...contract, ...presentOutLabContract(contract) }))
  const endedRows = rows.filter((row) => row.effectiveStatus === 'expired')
  const statusVisible = showEnded
    ? endedRows
    : rows.filter((row) => row.effectiveStatus !== 'expired')
  const olderRows = statusVisible.filter((row) => row.fiscalYear < oldestDefaultFiscalYear)
  // Selecting a fiscal year must always show that year, including older ones.
  const visible =
    showOlder || fiscalYear
      ? statusVisible
      : statusVisible.filter((row) => row.fiscalYear >= oldestDefaultFiscalYear)
  const paginated = paginate(visible, page, LIST_PAGE_SIZE)
  const behindCount = visible.filter((row) => row.missingPeriodCount > 0).length

  const grouped = new Map<number, typeof paginated.items>()
  for (const row of paginated.items) {
    grouped.set(row.fiscalYear, [...(grouped.get(row.fiscalYear) ?? []), row])
  }

  const activeParams = new URLSearchParams()
  if (fiscalYear) activeParams.set('fiscalYear', String(fiscalYear))
  if (kind) activeParams.set('kind', kind)
  if (entryCadence) activeParams.set('cadence', entryCadence)
  if (department) activeParams.set('department', department)
  if (search) activeParams.set('search', search)
  if (showEnded) activeParams.set('showEnded', '1')
  if (showOlder) activeParams.set('showOlder', '1')

  const toggleHref = (next: URLSearchParams) => {
    const query = next.toString()
    return query ? `/out-lab?${query}` : '/out-lab'
  }
  const endedParams = new URLSearchParams(activeParams)
  if (showEnded) endedParams.delete('showEnded')
  else endedParams.set('showEnded', '1')
  const olderParams = new URLSearchParams(activeParams)
  if (showOlder) olderParams.delete('showOlder')
  else olderParams.set('showOlder', '1')

  const fiscalYears = Array.from({ length: 7 }, (_, index) => thisFiscalYear + 1 - index)

  return (
    <div className="route-stack">
      <header className="page-heading page-heading--actions">
        <div>
          <p className="section-kicker">OUT LAB REGISTER</p>
          <h1>สัญญาส่งตรวจภายนอก</h1>
          <p>
            {OUT_LAB_CONTRACT_TYPE_LABEL} · ติดตามยอดใช้จ่ายรายเดือนเทียบกับมูลค่าสัญญาหรืองบตามแผนรายปี
            {behindCount > 0 && ` · มี ${behindCount} สัญญาที่ค้างลงข้อมูล`}
          </p>
        </div>
        <div className="page-heading__actions">
          {(showOlder || (!fiscalYear && olderRows.length > 0)) && (
            <Link className="lab-link-button lab-link-button--secondary contracts-visibility-toggle" href={toggleHref(olderParams)}>
              {showOlder ? 'ซ่อนปีเก่า' : `แสดงปีเก่าทั้งหมด (${olderRows.length})`}
            </Link>
          )}
          {(showEnded || endedRows.length > 0) && (
            <Link className="lab-link-button lab-link-button--secondary contracts-visibility-toggle" href={toggleHref(endedParams)}>
              {showEnded ? 'ซ่อนสัญญาที่สิ้นสุดแล้ว' : `แสดงสัญญาที่สิ้นสุดแล้ว (${endedRows.length})`}
            </Link>
          )}
          {isAdmin && (
            <Link className="lab-link-button lab-link-button--secondary contracts-visibility-toggle" href="/out-lab?showArchived=1">
              สัญญาที่ถูกลบ
            </Link>
          )}
          {canCreate && (
            <Link className="lab-link-button lab-link-button--primary" href="/out-lab/new">เพิ่มสัญญา Out Lab</Link>
          )}
        </div>
      </header>

      <OutLabFilters
        search={search}
        fiscalYear={fiscalYear ? String(fiscalYear) : ''}
        kind={kind ?? ''}
        entryCadence={entryCadence ?? ''}
        department={department ?? ''}
        showEnded={showEnded}
        showOlder={showOlder}
        fiscalYears={fiscalYears}
        kinds={OUT_LAB_KINDS.map((value) => ({ value, label: OUT_LAB_KIND_LABELS[value] }))}
        cadences={OUT_LAB_CADENCES.map((value) => ({ value, label: OUT_LAB_CADENCE_LABELS[value] }))}
        departments={[...OUT_LAB_DEPARTMENTS]}
      />

      {error ? (
        <section className="error-state" role="alert">
          <h2>ไม่สามารถแสดงทะเบียนสัญญา Out Lab ได้</h2>
          <p>{error}</p>
          <Link className="text-link" href="/out-lab">ลองโหลดข้อมูลอีกครั้ง</Link>
        </section>
      ) : grouped.size === 0 ? (
        <section className="empty-state empty-state--panel">
          <h2>
            {showEnded
              ? 'ไม่พบสัญญาที่สิ้นสุดแล้ว'
              : !showOlder && !fiscalYear && olderRows.length > 0
                ? 'ไม่พบสัญญาใน 5 ปีล่าสุด'
                : 'ยังไม่มีสัญญา Out Lab'}
          </h2>
          <p>
            {showEnded
              ? 'ลองล้างตัวกรอง หรือกลับไปดูสัญญาที่ยังใช้งานอยู่'
              : !showOlder && !fiscalYear && olderRows.length > 0
                ? 'เลือกแสดงปีเก่าทั้งหมด หากต้องการตรวจสอบย้อนหลัง'
                : 'เริ่มจากเพิ่มสัญญาส่งตรวจภายนอกรายการแรก แล้วจึงลงยอดใช้จ่ายรายเดือน'}
          </p>
        </section>
      ) : (
        <>
          {Array.from(grouped.entries()).map(([year, yearRows]) => (
            <section className="bench-panel contract-year-group" key={year} aria-labelledby={`out-lab-year-${year}`}>
              <div className="bench-panel__header">
                <div>
                  <p className="section-kicker">FISCAL GROUP</p>
                  <h2 id={`out-lab-year-${year}`}>ปีงบประมาณ {year}</h2>
                </div>
                <p>{yearRows.length} สัญญาในหน้านี้</p>
              </div>
              <OutLabTable contracts={yearRows} />
            </section>
          ))}
          <ListPagination
            currentPage={paginated.currentPage}
            pageCount={paginated.pageCount}
            totalCount={paginated.totalCount}
            startIndex={paginated.startIndex}
            pageSize={LIST_PAGE_SIZE}
            itemLabel="สัญญา"
            buildHref={(nextPage) => {
              const next = new URLSearchParams(activeParams)
              if (nextPage > 1) next.set('page', String(nextPage))
              return toggleHref(next)
            }}
          />
        </>
      )}
    </div>
  )
}
