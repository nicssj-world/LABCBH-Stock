import Link from 'next/link'
import { StatusChip } from '@/components/ui/StatusChip'
import { ContractValueCards } from '@/components/dashboard/ContractValueCards'
import { DashboardWatchlist } from '@/components/dashboard/DashboardWatchlist'
import {
  ContractStackIcon,
  PendingClockIcon,
  PurchaseRequestIcon,
  RequisitionIcon,
} from '@/components/dashboard/DashboardIcons'
import { CONTRACT_TYPE_LABELS, PROCUREMENT_STAGE_LABELS } from '@/lib/contracts/presenter'
import { getExecutiveDashboard } from '@/lib/dashboard/contracts'
import type { ExecutiveDashboard } from '@/lib/dashboard/types'

const money = new Intl.NumberFormat('th-TH', {
  style: 'currency',
  currency: 'THB',
  maximumFractionDigits: 0,
})

const thaiDate = new Intl.DateTimeFormat('th-TH-u-ca-buddhist', {
  dateStyle: 'medium',
  timeZone: 'Asia/Bangkok',
})
const displayDate = (value: string) => thaiDate.format(new Date(`${value}T00:00:00+07:00`))

interface MixRow {
  key: string
  label: string
  count: number
  value: number
  color: string
}

// A validated four-hue cool categorical set (see the palette check run for
// this feature) plus a neutral "other" bucket. Cycling hues past four is
// what the palette check forbids, so a fifth type folds into "อื่นๆ" rather
// than reusing a color already assigned to a real one.
const MIX_COLORS = ['var(--cat-blue)', 'var(--cat-teal)', 'var(--cat-violet)', 'var(--cat-sky)']

function buildMixRows(typeMix: ExecutiveDashboard['typeMix']): MixRow[] {
  const sorted = [...typeMix].sort((a, b) => b.value - a.value)
  const top = sorted.slice(0, MIX_COLORS.length).map((item, index) => ({
    key: item.type,
    label: CONTRACT_TYPE_LABELS[item.type],
    count: item.count,
    value: item.value,
    color: MIX_COLORS[index],
  }))
  const rest = sorted.slice(MIX_COLORS.length)
  if (rest.length === 0) return top
  const other = rest.reduce((sum, item) => ({ count: sum.count + item.count, value: sum.value + item.value }), { count: 0, value: 0 })
  return [...top, { key: 'other', label: 'อื่นๆ', ...other, color: 'var(--lab-muted)' }]
}

function DashboardContent({ data }: { data: ExecutiveDashboard }) {
  const maximumPipeline = Math.max(...data.pipeline.map((stage) => stage.count), 1)
  const mixRows = buildMixRows(data.typeMix)
  const maxMixCount = Math.max(...mixRows.map((row) => row.count), 1)

  return (
    <>
      <section className="executive-strip" aria-label="ตัวชี้วัดสัญญา">
        <div className="executive-strip__card">
          <div className="executive-strip__head">
            <span>สัญญาใช้งานอยู่</span>
            <span className="executive-strip__icon" aria-hidden="true"><ContractStackIcon /></span>
          </div>
          <strong>{data.activeContracts.toLocaleString('th-TH')}</strong>
          <small>จาก {data.contractCount.toLocaleString('th-TH')} สัญญาในระบบ</small>
        </div>
        <div className="executive-strip__card">
          <div className="executive-strip__head">
            <span>ระหว่างดำเนินการ</span>
            <span className="executive-strip__icon" aria-hidden="true"><PendingClockIcon /></span>
          </div>
          <strong>{data.pendingContracts.toLocaleString('th-TH')}</strong>
          <small>ยังไม่ถึงขั้นเริ่มสัญญา</small>
        </div>
        <ContractValueCards
          total={{ total: data.totalContractValue, remaining: data.remainingContractValue }}
          lease={data.leaseContractValue}
          supply={data.supplyContractValue}
        />
      </section>

      <div className="dashboard-operations">
        <section className="bench-panel watchlist-panel" aria-labelledby="watchlist-title">
          <div className="bench-panel__header">
            <div>
              <p className="section-kicker">WATCHLIST · BELOW 30%</p>
              <h2 id="watchlist-title">รายการตามสัญญาคงเหลือต่ำ</h2>
            </div>
            <StatusChip tone={data.watchlistTotal ? 'danger' : 'success'}>{data.watchlistTotal} รายการ</StatusChip>
          </div>
          <DashboardWatchlist
            initialItems={data.watchlist}
            totalCount={data.watchlistTotal}
            nextOffset={data.watchlistNextOffset}
          />
        </section>

        <section className="bench-panel lease-watchlist-panel" aria-labelledby="lease-watchlist-title">
          <div className="bench-panel__header">
            <div>
              <p className="section-kicker">LEASE · EXPIRING OR LOW BUDGET</p>
              <h2 id="lease-watchlist-title">สัญญาเช่าที่ต้องติดตาม</h2>
            </div>
            <StatusChip tone={data.leaseWatchlist.length ? 'danger' : 'success'}>
              {data.leaseWatchlist.length} สัญญา
            </StatusChip>
          </div>
          {data.leaseWatchlist.length === 0 ? (
            <div className="empty-state">
              <strong>ยังไม่มีสัญญาเช่าที่ต้องติดตาม</strong>
              <p>ทุกสัญญาเช่ายังมีงบคงเหลือเพียงพอและยังไม่ใกล้สิ้นสุด</p>
            </div>
          ) : (
            <ol className="lease-watchlist">
              {data.leaseWatchlist.map((lease) => (
                <li key={lease.contractId}>
                  <Link className="lease-watchlist__name" href={`/contracts/${lease.contractId}`}>
                    {lease.contractName}
                  </Link>
                  <p className="lease-watchlist__meta">
                    ปีงบประมาณ {lease.fiscalYear ?? 'ไม่ระบุ'}
                    {lease.endDate && ` · สิ้นสุด ${displayDate(lease.endDate)}`}
                  </p>
                  <p className="lease-watchlist__figure">
                    {lease.remaining === null
                      ? 'ไม่ระบุมูลค่าสัญญา'
                      : `${money.format(lease.remaining)} คงเหลือ`}
                  </p>
                  {lease.remainingPercent !== null && (
                    <div className="remaining-track" aria-hidden="true">
                      <span style={{ width: `${Math.max(Math.min(lease.remainingPercent, 100), 2)}%` }} />
                    </div>
                  )}
                  <p className="lease-watchlist__flags">
                    {lease.expiring && (
                      <span>เหลืออีก {Math.max(lease.monthsLeft, 0)} เดือน</span>
                    )}
                    {lease.lowBudget && <span>งบคงเหลือต่ำ</span>}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="bench-panel pipeline-panel" aria-labelledby="pipeline-title">
          <div className="bench-panel__header">
            <div>
              <p className="section-kicker">SIX-STAGE PIPELINE</p>
              <h2 id="pipeline-title">ขั้นตอนการทำสัญญา</h2>
            </div>
          </div>
          <ol className="pipeline-list">
            {data.pipeline.map((item, index) => (
              <li key={item.stage}>
                <span className="pipeline-list__index">{index + 1}</span>
                <div>
                  <div className="pipeline-list__label"><span>{PROCUREMENT_STAGE_LABELS[item.stage]}</span><strong>{item.count}</strong></div>
                  <div className="pipeline-track" aria-hidden="true"><span style={{ width: `${(item.count / maximumPipeline) * 100}%` }} /></div>
                </div>
              </li>
            ))}
          </ol>
        </section>
      </div>

      <section className="bench-panel type-mix" aria-labelledby="type-mix-title">
        <div className="bench-panel__header">
          <div>
            <p className="section-kicker">CONTRACT MIX</p>
            <h2 id="type-mix-title">สัดส่วนตามประเภทสัญญา</h2>
          </div>
          <Link className="text-link" href="/contracts">ดูทะเบียนสัญญาทั้งหมด</Link>
        </div>
        {mixRows.length === 0 ? <p className="empty-state">ยังไม่มีข้อมูลประเภทสัญญา</p> : (
          <div className="type-mix__rows">
            {mixRows.map((row) => (
              <div key={row.key}>
                <span>{row.label}</span>
                <div className="type-mix__track" aria-hidden="true">
                  <span style={{ width: `${(row.count / maxMixCount) * 100}%`, background: row.color }} />
                </div>
                <strong>{row.count} สัญญา</strong>
                <small>{money.format(row.value)}</small>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  )
}

export default async function DashboardPage() {
  let data: ExecutiveDashboard | null = null
  let error: string | null = null
  try {
    data = await getExecutiveDashboard({ watchlistLimit: 5 })
  } catch (caught) {
    error = caught instanceof Error ? caught.message : 'อ่านข้อมูลภาพรวมไม่สำเร็จ'
  }

  return (
    <div className="dashboard-composition-c">
      <header className="page-heading page-heading--actions">
        <div>
          <p className="section-kicker">EXECUTIVE CONTROL BENCH</p>
          <h1>Dashboard บริหารสัญญา</h1>
          <p>สถานะงานจัดซื้อ มูลค่าคงเหลือ และรายการน้ำยาที่ต้องติดตามจากข้อมูลธุรกรรมจริง</p>
        </div>
        <div className="dashboard-heading-tools">
          {error && <StatusChip tone="danger">ข้อมูลขัดข้อง</StatusChip>}
          <nav className="dashboard-quick-actions" aria-label="ทางลัดงานหลัก">
            <Link className="lab-link-button lab-link-button--secondary dashboard-quick-action" href="/purchase-requests/new">
              <span className="dashboard-quick-action__icon" aria-hidden="true"><PurchaseRequestIcon /></span>
              <span>สร้างใบ PR</span>
            </Link>
            <Link className="lab-link-button lab-link-button--primary dashboard-quick-action" href="/requisitions/new">
              <span className="dashboard-quick-action__icon" aria-hidden="true"><RequisitionIcon /></span>
              <span>สร้างใบเบิก</span>
            </Link>
          </nav>
        </div>
      </header>

      {error || !data ? (
        <section className="error-state" role="alert">
          <h2>ไม่สามารถแสดง Dashboard ได้</h2>
          <p>{error}</p>
          <Link className="text-link" href="/dashboard">ลองโหลดข้อมูลอีกครั้ง</Link>
        </section>
      ) : <DashboardContent data={data} />}
    </div>
  )
}
