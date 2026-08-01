import Link from 'next/link'
import { StatusChip } from '@/components/ui/StatusChip'
import { CONTRACT_TYPE_LABELS, PROCUREMENT_STAGE_LABELS } from '@/lib/contracts/presenter'
import { getExecutiveDashboard, type ExecutiveDashboard } from '@/lib/dashboard/contracts'

const money = new Intl.NumberFormat('th-TH', {
  style: 'currency',
  currency: 'THB',
  maximumFractionDigits: 0,
})

const thaiDate = new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium' })
const displayDate = (value: string) => thaiDate.format(new Date(`${value}T00:00:00+07:00`))

function DashboardContent({ data }: { data: ExecutiveDashboard }) {
  const maximumPipeline = Math.max(...data.pipeline.map((stage) => stage.count), 1)
  const totalTypeContracts = data.typeMix.reduce((sum, type) => sum + type.count, 0) || 1

  return (
    <>
      <section className="executive-strip" aria-label="ตัวชี้วัดสัญญา">
        <div>
          <span>สัญญาใช้งานอยู่</span>
          <strong>{data.activeContracts.toLocaleString('th-TH')}</strong>
          <small>จาก {data.contractCount.toLocaleString('th-TH')} สัญญาในระบบ</small>
        </div>
        <div>
          <span>ระหว่างดำเนินการ</span>
          <strong>{data.pendingContracts.toLocaleString('th-TH')}</strong>
          <small>ยังไม่ถึงขั้นเริ่มสัญญา</small>
        </div>
        <div>
          <span>มูลค่าสัญญารวม</span>
          <strong>{money.format(data.totalContractValue)}</strong>
          <small>รายการน้ำยาในสัญญาซื้อ และมูลค่าสัญญาเช่า</small>
        </div>
        <div>
          <span>มูลค่าคงเหลือในสัญญา</span>
          <strong>{money.format(data.remainingContractValue)}</strong>
          <small>หลังหักการยืนยันใน PR และการตัดงบรายเดือน</small>
        </div>
      </section>

      <div className="dashboard-operations">
        <section className="bench-panel watchlist-panel" aria-labelledby="watchlist-title">
          <div className="bench-panel__header">
            <div>
              <p className="section-kicker">WATCHLIST · BELOW 30%</p>
              <h2 id="watchlist-title">รายการที่ต้องเฝ้าระวัง</h2>
            </div>
            <StatusChip tone={data.watchlist.length ? 'danger' : 'success'}>{data.watchlist.length} รายการ</StatusChip>
          </div>
          {data.watchlist.length === 0 ? (
            <div className="empty-state">
              <strong>ยังไม่มีรายการต่ำกว่า 30%</strong>
              <p>ยอดคงเหลือของรายการสัญญาทั้งหมดยังอยู่เหนือเกณฑ์เฝ้าระวัง</p>
            </div>
          ) : (
            <ol className="watchlist">
              {data.watchlist.map((item) => (
                <li key={`${item.contractId}-${item.lsCode}`}>
                  <div className="watchlist__identity">
                    <span className="identifier">{item.lsCode}</span>
                    <div><strong>{item.name}</strong><small>{item.contractName} · ปีงบประมาณ {item.fiscalYear ?? 'ไม่ระบุ'}</small></div>
                  </div>
                  <div className="watchlist__remaining">
                    <strong>{item.remainingPercent.toLocaleString('th-TH', { maximumFractionDigits: 1 })}% คงเหลือ</strong>
                    <span>{item.remainingQuantity.toLocaleString('th-TH')} / {item.contractedQuantity.toLocaleString('th-TH')} {item.unit}</span>
                    <div className="remaining-track" aria-hidden="true"><span style={{ width: `${Math.max(item.remainingPercent, 2)}%` }} /></div>
                  </div>
                  <Link className="text-link" href={`/contracts/${item.contractId}`}>เปิดสัญญา</Link>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="bench-panel watchlist-panel" aria-labelledby="lease-watchlist-title">
          <div className="bench-panel__header">
            <div>
              <p className="section-kicker">LEASE · EXPIRING OR LOW BUDGET</p>
              <h2 id="lease-watchlist-title">สัญญาเช่าที่ต้องเฝ้าระวัง</h2>
            </div>
            <StatusChip tone={data.leaseWatchlist.length ? 'danger' : 'success'}>
              {data.leaseWatchlist.length} สัญญา
            </StatusChip>
          </div>
          {data.leaseWatchlist.length === 0 ? (
            <div className="empty-state">
              <strong>ยังไม่มีสัญญาเช่าที่ต้องเฝ้าระวัง</strong>
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
        {data.typeMix.length === 0 ? <p className="empty-state">ยังไม่มีข้อมูลประเภทสัญญา</p> : (
          <div className="type-mix__rows">
            {data.typeMix.map((item) => (
              <div key={item.type}>
                <span>{CONTRACT_TYPE_LABELS[item.type]}</span>
                <div className="type-mix__track" aria-hidden="true"><span style={{ width: `${(item.count / totalTypeContracts) * 100}%` }} /></div>
                <strong>{item.count} สัญญา</strong>
                <small>{money.format(item.value)}</small>
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
    data = await getExecutiveDashboard()
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
        <StatusChip tone={error ? 'danger' : 'info'}>{error ? 'ข้อมูลขัดข้อง' : 'ข้อมูลปัจจุบัน'}</StatusChip>
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
