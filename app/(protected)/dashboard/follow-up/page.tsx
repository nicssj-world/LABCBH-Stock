import Link from 'next/link'
import { AutoFilterBench } from '@/components/ui/AutoFilterBench'
import { StatusChip } from '@/components/ui/StatusChip'
import { formatThaiDate } from '@/lib/inventory/presenter'
import { bangkokIsoDate } from '@/lib/date/thai'
import { fiscalYearFromDate, fiscalYearRange } from '@/lib/service-procurement/domain'
import { getExecutiveOverview } from '@/lib/dashboard/executive'
import {
  EXECUTIVE_FOLLOW_UP_CATEGORIES,
  executiveFollowUpCategoryLabel,
  executiveFollowUpHref,
  executiveSourceHref,
  isExecutiveFollowUpCategory,
  type ExecutiveFollowUpCategory,
} from '@/lib/dashboard/follow-up'
import type { ExecutiveAlert } from '@/lib/dashboard/executive-types'

type FollowUpSearchParams = Promise<Record<string, string | string[] | undefined>>

const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value

function currentFiscalYear() {
  return fiscalYearFromDate(bangkokIsoDate())
}

function fiscalYearOptions(selected: number) {
  const current = currentFiscalYear()
  return [...new Set([selected, ...Array.from({ length: 7 }, (_, index) => current - index)])]
    .filter((year) => year >= 2500 && year <= 3000)
}

function sourceLabel(alert: ExecutiveAlert) {
  switch (alert.key) {
    case 'receiving-data-quality':
      return 'เปิดรายการรับเข้าที่พบ'
    case 'lease-usage-data-quality':
    case 'lease-contract-metadata':
    case 'lease-risk':
    case 'pending-contracts':
      return 'เปิดทะเบียนสัญญาที่พบ'
    default:
      return null
  }
}

function toneLabel(tone: ExecutiveAlert['tone']) {
  if (tone === 'danger') return 'เร่งด่วน'
  if (tone === 'attention') return 'ติดตาม'
  return 'ข้อมูล'
}

function FollowUpAlertCard({
  alert,
  fiscalYear,
  isCurrentCategory,
}: {
  alert: ExecutiveAlert
  fiscalYear: number
  isCurrentCategory: boolean
}) {
  const href = isExecutiveFollowUpCategory(alert.key)
    ? executiveSourceHref(fiscalYear, alert.key)
    : null
  const label = sourceLabel(alert)
  const filterHref = isCurrentCategory
    ? executiveFollowUpHref(fiscalYear)
    : isExecutiveFollowUpCategory(alert.key)
    ? executiveFollowUpHref(fiscalYear, alert.key)
    : executiveFollowUpHref(fiscalYear)
  const filterLabel = isCurrentCategory ? 'กลับไปดูรายการทั้งหมด' : 'ดูเฉพาะรายการนี้'

  return (
    <li className={`follow-up-item follow-up-item--${alert.tone}`} data-testid={`follow-up-${alert.key}`}>
      <div className="follow-up-item__topline">
        <span className="follow-up-item__tone"><span className="executive-alert__dot" aria-hidden="true" />{toneLabel(alert.tone)}</span>
        <span className="identifier">ปีงบประมาณ {fiscalYear}</span>
      </div>
      <div>
        <h2>{alert.label}</h2>
        <p>{alert.detail}</p>
      </div>
      <div className="follow-up-item__actions">
        {href && label && <Link className="lab-link-button lab-link-button--primary" href={href}>{label}</Link>}
        <Link className="text-link" href={filterHref}>{filterLabel}</Link>
      </div>
    </li>
  )
}

export default async function ExecutiveFollowUpPage({ searchParams }: { searchParams: FollowUpSearchParams }) {
  const params = await searchParams
  const requestedFiscalYear = Number(first(params.fiscalYear))
  const fiscalYear = Number.isInteger(requestedFiscalYear) && requestedFiscalYear >= 2500 && requestedFiscalYear <= 3000
    ? requestedFiscalYear
    : currentFiscalYear()
  const requestedCategory = first(params.category)
  const category: ExecutiveFollowUpCategory = isExecutiveFollowUpCategory(requestedCategory)
    ? requestedCategory
    : 'all'

  let data = null
  let error: string | null = null
  try {
    data = await getExecutiveOverview({ fiscalYear })
  } catch (caught) {
    error = caught instanceof Error ? caught.message : 'อ่านรายการที่ต้องติดตามไม่สำเร็จ'
  }

  const alerts = data
    ? data.alerts.filter((alert) => category === 'all' || alert.key === category)
    : []
  const actionableCount = data?.alerts.filter((alert) => alert.tone !== 'neutral').length ?? 0
  const range = fiscalYearRange(fiscalYear)

  return (
    <div className="route-stack follow-up-page" data-testid="executive-follow-up-page">
      <header className="page-heading page-heading--actions">
        <div>
          <p className="section-kicker">EXECUTIVE FOLLOW-UP</p>
          <h1>รายการที่ต้องติดตาม</h1>
          <p>รวมประเด็นจาก Dashboard ผู้บริหาร พร้อมตัวกรองเพื่อเปิดรายการต้นทางและดำเนินการต่อ</p>
        </div>
        <div className="page-heading__actions">
          <Link className="lab-link-button lab-link-button--secondary" href={`/dashboard?view=executive&fiscalYear=${fiscalYear}`}>
            กลับ Dashboard ผู้บริหาร
          </Link>
        </div>
      </header>

      <section className="follow-up-overview" aria-label="สรุปรายการที่ต้องติดตาม">
        <div className="follow-up-overview__card follow-up-overview__card--primary">
          <span>ประเด็นที่พบ</span>
          <strong>{actionableCount.toLocaleString('th-TH')}</strong>
          <small>จากข้อมูลปีงบประมาณ {fiscalYear}</small>
        </div>
        <div className="follow-up-overview__card">
          <span>กำลังแสดง</span>
          <strong>{alerts.length.toLocaleString('th-TH')}</strong>
          <small>{category === 'all' ? 'ทุกประเภทประเด็น' : executiveFollowUpCategoryLabel(category)}</small>
        </div>
        <div className="follow-up-overview__card">
          <span>ช่วงข้อมูล</span>
          <strong>{fiscalYear}</strong>
          <small>{formatThaiDate(range.start)} – {formatThaiDate(range.end)}</small>
        </div>
      </section>

      <AutoFilterBench
        className="follow-up-filters"
        ariaLabel="ตัวกรองรายการที่ต้องติดตาม"
        fields={[
          {
            type: 'select',
            name: 'category',
            label: 'ประเภทประเด็น',
            value: category,
            options: EXECUTIVE_FOLLOW_UP_CATEGORIES.map((option) => ({ value: option.value, label: option.label })),
          },
          {
            type: 'select',
            name: 'fiscalYear',
            label: 'ปีงบประมาณ',
            value: String(fiscalYear),
            options: fiscalYearOptions(fiscalYear).map((year) => ({ value: String(year), label: `พ.ศ. ${year}` })),
          },
        ]}
      />

      {error ? (
        <section className="error-state" role="alert">
          <h2>ไม่สามารถแสดงรายการที่ต้องติดตามได้</h2>
          <p>{error}</p>
          <Link className="text-link" href={executiveFollowUpHref(fiscalYear, category)}>ลองโหลดข้อมูลอีกครั้ง</Link>
        </section>
      ) : alerts.length === 0 ? (
        <section className="empty-state empty-state--panel">
          <h2>{category === 'all' ? 'ไม่พบประเด็นที่ต้องติดตาม' : 'ไม่พบรายการในประเภทที่เลือก'}</h2>
          <p>{category === 'all' ? 'ข้อมูลปีงบประมาณนี้ยังไม่มีประเด็นที่ต้องดำเนินการ' : `ไม่พบ “${executiveFollowUpCategoryLabel(category)}” ในปีงบประมาณ ${fiscalYear}`}</p>
          {category !== 'all' && <Link className="text-link" href={executiveFollowUpHref(fiscalYear)}>แสดงทุกประเด็น</Link>}
        </section>
      ) : (
        <section className="bench-panel follow-up-panel" aria-labelledby="follow-up-results-title">
          <div className="bench-panel__header">
            <div>
              <p className="section-kicker">FILTERED DECISION QUEUE</p>
              <h2 id="follow-up-results-title">{category === 'all' ? 'ทุกประเด็นที่ต้องติดตาม' : executiveFollowUpCategoryLabel(category)}</h2>
            </div>
            <StatusChip tone={alerts.some((alert) => alert.tone === 'danger') ? 'danger' : alerts.some((alert) => alert.tone === 'attention') ? 'attention' : 'success'}>
              {alerts.length.toLocaleString('th-TH')} รายการ
            </StatusChip>
          </div>
          <ul className="follow-up-list">
            {alerts.map((alert) => (
              <FollowUpAlertCard
                key={alert.key}
                alert={alert}
                fiscalYear={fiscalYear}
                isCurrentCategory={category === alert.key}
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
