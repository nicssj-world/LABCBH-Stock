import Link from 'next/link'
import type { ReactNode } from 'react'
import { StatusChip } from '@/components/ui/StatusChip'
import { DownloadIcon } from '@/components/dashboard/DashboardIcons'
import { ExecutiveLeaseTable } from '@/components/dashboard/ExecutiveLeaseTable'
import { formatThaiDate } from '@/lib/inventory/presenter'
import { executiveFollowUpHref } from '@/lib/dashboard/follow-up'
import type {
  ExecutiveAlert,
  ExecutiveComparison,
  ExecutiveMonthlySpend,
  ExecutiveOverview,
} from '@/lib/dashboard/executive-types'

const money = new Intl.NumberFormat('th-TH', {
  style: 'currency',
  currency: 'THB',
  maximumFractionDigits: 0,
})

const wholeNumber = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 0 })

function formatPercent(value: number | null) {
  return value === null ? 'ไม่มีฐานเปรียบเทียบ' : `${value > 0 ? '+' : ''}${value.toLocaleString('th-TH', { maximumFractionDigits: 1 })}%`
}

function ComparisonNote({ comparison }: { comparison: ExecutiveComparison }) {
  if (comparison.trend === 'no-baseline') {
    return <span className="executive-kpi__comparison executive-kpi__comparison--neutral">ยังไม่มีฐานเปรียบเทียบกับปีก่อน</span>
  }
  return (
    <span className={`executive-kpi__comparison executive-kpi__comparison--${comparison.trend}`}>
      {comparison.trend === 'up' ? 'เพิ่มขึ้น' : comparison.trend === 'down' ? 'ลดลง' : 'เท่าเดิม'} {formatPercent(comparison.changePercent)} จากปีก่อน
    </span>
  )
}

function KpiCard({
  className,
  label,
  value,
  hint,
  comparison,
  actions,
}: {
  className: string
  label: string
  value: number
  hint: string
  comparison?: ExecutiveComparison
  actions?: ReactNode
}) {
  return (
    <article className={`executive-kpi-card ${className}`}>
      <div className="executive-kpi-card__head"><span>{label}</span><span className="executive-kpi-card__marker" aria-hidden="true" /></div>
      <strong>{money.format(value)}</strong>
      {comparison && <ComparisonNote comparison={comparison} />}
      <small>{hint}</small>
      {actions && <div className="executive-kpi-card__actions">{actions}</div>}
    </article>
  )
}

function monthAriaLabel(row: ExecutiveMonthlySpend) {
  return `${row.label}: งานซื้อ ${money.format(row.purchase)}, งานจ้างระบบ ${money.format(row.service)}, เช่าเครื่อง ${money.format(row.lease)}, ยอดรวม ${money.format(row.total)}`
}

function MonthlySpendChart({ rows }: { rows: ExecutiveMonthlySpend[] }) {
  const maximum = Math.max(...rows.map((row) => row.total), 1)
  return (
    <div className="executive-chart" role="group" aria-label="กราฟยอดตามเดือน แยกงานซื้อ งานจ้างระบบ และเช่าเครื่อง">
      <div className="executive-chart__legend" aria-label="คำอธิบายกราฟ">
        <span><i className="executive-chart__swatch executive-chart__swatch--purchase" />งานซื้อ</span>
        <span><i className="executive-chart__swatch executive-chart__swatch--service" />งานจ้างระบบ</span>
        <span><i className="executive-chart__swatch executive-chart__swatch--lease" />เช่าเครื่อง</span>
      </div>
      <div className="executive-chart__plot executive-chart__plot--desktop" role="group" aria-label="ยอดรวมรายเดือนในปีงบประมาณ">
        {rows.map((row) => (
          <div className="executive-chart__column" key={row.month} role="img" aria-label={monthAriaLabel(row)}>
            <span className="executive-chart__column-value">{row.total > 0 ? money.format(row.total) : '—'}</span>
            <div className="executive-chart__column-track" aria-hidden="true">
              <div
                className="executive-chart__column-bar"
                style={{ height: `${row.total > 0 ? Math.max((row.total / maximum) * 100, 3) : 0}%` }}
              >
                {row.purchase > 0 && <span className="executive-chart__column-segment executive-chart__column-segment--purchase" style={{ height: `${(row.purchase / row.total) * 100}%` }} />}
                {row.service > 0 && <span className="executive-chart__column-segment executive-chart__column-segment--service" style={{ height: `${(row.service / row.total) * 100}%` }} />}
                {row.lease > 0 && <span className="executive-chart__column-segment executive-chart__column-segment--lease" style={{ height: `${(row.lease / row.total) * 100}%` }} />}
              </div>
            </div>
            <span className="executive-chart__column-month">{row.label}</span>
          </div>
        ))}
      </div>
      <div className="executive-chart__plot executive-chart__plot--mobile" role="group" aria-label="ยอดรวมรายเดือนในปีงบประมาณ">
        {rows.map((row) => (
          <div className="executive-chart__row" key={row.month} role="img" aria-label={monthAriaLabel(row)}>
            <span className="executive-chart__month">{row.label}</span>
            <div className="executive-chart__bar-track" aria-hidden="true">
              <div className="executive-chart__bar" style={{ width: `${Math.max((row.total / maximum) * 100, row.total > 0 ? 1 : 0)}%` }}>
                {row.purchase > 0 && <span className="executive-chart__segment executive-chart__segment--purchase" style={{ width: `${(row.purchase / row.total) * 100}%` }} />}
                {row.service > 0 && <span className="executive-chart__segment executive-chart__segment--service" style={{ width: `${(row.service / row.total) * 100}%` }} />}
                {row.lease > 0 && <span className="executive-chart__segment executive-chart__segment--lease" style={{ width: `${(row.lease / row.total) * 100}%` }} />}
              </div>
            </div>
            <strong>{row.total > 0 ? money.format(row.total) : '—'}</strong>
          </div>
        ))}
      </div>
      <details className="executive-chart__details">
        <summary>ดูตัวเลขรายเดือน</summary>
        <div className="executive-table-wrap">
          <table className="executive-data-table">
            <caption className="sr-only">ตารางยอดรายเดือนในปีงบประมาณ</caption>
            <thead><tr><th scope="col">เดือน</th><th scope="col">งานซื้อ</th><th scope="col">งานจ้างระบบ</th><th scope="col">เช่าเครื่อง</th><th scope="col">ยอดรวม</th></tr></thead>
            <tbody>{rows.map((row) => <tr key={row.month}><th scope="row">{row.label}</th><td>{money.format(row.purchase)}</td><td>{money.format(row.service)}</td><td>{money.format(row.lease)}</td><td><strong>{money.format(row.total)}</strong></td></tr>)}</tbody>
          </table>
        </div>
      </details>
    </div>
  )
}

function CategoryBreakdown({ data }: { data: ExecutiveOverview }) {
  return (
    <section className="bench-panel executive-panel executive-category-panel" aria-labelledby="executive-category-title">
      <div className="bench-panel__header">
        <div><p className="section-kicker">ANNUAL CATEGORIES</p><h2 id="executive-category-title">สรุปตามหมวดงาน</h2></div>
        <span className="executive-panel__note">เช่าเครื่องเป็นรายละเอียดในงานจ้าง</span>
      </div>
      <div className="executive-category-list">
        {data.categories.map((category) => (
          <div className={`executive-category-row executive-category-row--${category.key}`} key={category.key}>
            <div><strong>{category.label}</strong><small>{category.note}</small>{category.key === 'hiring' && <span className="executive-category-row__links"><Link href={`/service-procurement/plans?fiscalYear=${data.fiscalYear}`}>เปิดแผนงานจ้างระบบ</Link><Link href={`/service-procurement/purchase-requests?fiscalYear=${data.fiscalYear}`}>เปิด PR/PO งานจ้าง</Link></span>}</div>
            <div className="executive-category-row__amount"><strong>{money.format(category.amount)}</strong><small>{category.share === null ? 'ไม่มีสัดส่วน' : `${category.share.toLocaleString('th-TH', { maximumFractionDigits: 1 })}% ของยอดรวม`}</small></div>
          </div>
        ))}
      </div>
    </section>
  )
}

function ServiceSpendDetails({ data }: { data: ExecutiveOverview }) {
  return (
    <section className="bench-panel executive-panel executive-service-source-panel" aria-labelledby="executive-service-source-title">
      <div className="bench-panel__header">
        <div><h2 id="executive-service-source-title">รายละเอียดงานจ้างระบบ</h2><p className="executive-panel__description">ยอดใช้จริงจาก PO ที่ปิดแล้วในปีงบประมาณ {data.fiscalYear} ไม่รวมวงเงินของแผนที่คัดลอกมา</p></div>
        <StatusChip tone="neutral">{data.serviceSourceRows.length.toLocaleString('th-TH')} รายการ</StatusChip>
      </div>
      {data.serviceSourceRows.length === 0 ? <div className="empty-state"><strong>ยังไม่มียอดใช้จริงของงานจ้างในปีนี้</strong><p>แผนที่สร้างจากการตรวจทานจะยังไม่เพิ่มยอด จนกว่าจะมีการปิด PO และลง ledger</p></div> : <div className="executive-table-wrap"><table className="executive-data-table executive-service-source-table"><caption className="sr-only">รายการยอดใช้จริงงานจ้างระบบปี {data.fiscalYear}</caption><thead><tr><th scope="col">วันที่</th><th scope="col">แผนงานจ้าง</th><th scope="col">หน่วยงาน</th><th scope="col">อ้างอิง PR</th><th scope="col">ยอดใช้จริง</th></tr></thead><tbody>{data.serviceSourceRows.map((row) => <tr key={`${row.planId}:${row.eventDate}:${row.sourceReference ?? row.purchaseRequestId ?? row.amount}`}><td>{formatThaiDate(row.eventDate)}</td><td><Link className="text-link" href={`/service-procurement/plans/${row.planId}?fiscalYear=${data.fiscalYear}`}>{row.planName}</Link></td><td>{row.department}</td><td>{row.purchaseRequestId ? <Link className="text-link identifier" href={`/service-procurement/purchase-requests/${row.purchaseRequestId}?fiscalYear=${data.fiscalYear}`}>{row.sourceReference ?? 'เปิด PR'}</Link> : row.sourceReference ?? '—'}</td><td className="numeric-cell identifier">{money.format(row.amount)}</td></tr>)}</tbody></table></div>}
    </section>
  )
}

function LeaseDurationSummary({ data }: { data: ExecutiveOverview }) {
  return (
    <section className="bench-panel executive-panel" aria-labelledby="executive-duration-title">
      <div className="bench-panel__header">
        <div><p className="section-kicker">EQUIPMENT LEASE TERMS</p><h2 id="executive-duration-title">สรุปเช่าเครื่องตามอายุสัญญา</h2></div>
        <span className="executive-panel__note">สัญญาที่เกี่ยวข้องกับปีงบประมาณ</span>
      </div>
      <div className="executive-duration-grid">
        {data.leaseDurationSummary.map((row) => (
          <div className={`executive-duration-card${row.durationYears === null ? ' executive-duration-card--unknown' : ''}`} key={row.durationYears ?? 'unknown'}>
            <div className="executive-duration-card__head"><strong>{row.label}</strong><span>{row.contractCount.toLocaleString('th-TH')} สัญญา</span></div>
            <strong className="executive-duration-card__amount">{money.format(row.expense)}</strong>
            <small>{row.share === null ? 'ไม่มีค่าใช้จ่ายในปีนี้' : `${row.share.toLocaleString('th-TH', { maximumFractionDigits: 1 })}% ของค่าเช่าเครื่อง`}</small>
          </div>
        ))}
      </div>
    </section>
  )
}

function AlertList({ alerts, fiscalYear }: { alerts: ExecutiveAlert[]; fiscalYear: number }) {
  const actionableCount = alerts.filter((alert) => alert.tone !== 'neutral').length
  return (
    <section className="bench-panel executive-panel executive-alert-panel" aria-labelledby="executive-alert-title">
      <div className="bench-panel__header"><div><p className="section-kicker">DECISION QUEUE</p><h2 id="executive-alert-title"><Link className="executive-alert-panel__title-link" href={executiveFollowUpHref(fiscalYear)}>รายการที่ต้องติดตาม</Link></h2></div><StatusChip tone={alerts.some((alert) => alert.tone === 'danger') ? 'danger' : alerts.some((alert) => alert.tone === 'attention') ? 'attention' : 'success'}>{actionableCount ? `${actionableCount} ประเด็น` : 'ไม่มีประเด็น'}</StatusChip></div>
      <ul className="executive-alert-list">
        {alerts.map((alert) => <li className={`executive-alert executive-alert--${alert.tone}`} key={alert.key}><span className="executive-alert__dot" aria-hidden="true" />{alert.href ? <Link className="executive-alert__link" href={alert.href}><strong>{alert.label}</strong><small>{alert.detail}</small></Link> : <div><strong>{alert.label}</strong><small>{alert.detail}</small></div>}</li>)}
      </ul>
    </section>
  )
}

function DataQualityNote({ data }: { data: ExecutiveOverview }) {
  const count = data.dataQuality.unclassifiedReceiptCount + data.dataQuality.missingReceiptPriceCount + data.dataQuality.missingUsageMonthCount + data.dataQuality.missingLeaseDurationCount + data.dataQuality.missingLeaseDateCount
  if (count === 0) return <div className="executive-data-quality executive-data-quality--clear"><strong>ข้อมูลพร้อมใช้งาน</strong><span>ไม่พบรายการที่ต้องจัดหมวดหรือเติมข้อมูลเพิ่มเติม</span></div>
  return <div className="executive-data-quality executive-data-quality--warning" role="status"><strong>มีข้อมูลย่อยที่ต้องตรวจสอบ {wholeNumber.format(count)} รายการ</strong><span>ยอดที่จัดหมวดได้ยังคงแสดงตามข้อมูลต้นทาง และรายการที่ไม่ครบจะไม่ถูกนำไปจัดหมวดแบบคาดเดา</span></div>
}

function ExportActions({ fiscalYear }: { fiscalYear: number }) {
  const query = `fiscalYear=${encodeURIComponent(String(fiscalYear))}`
  return (
    <div className="executive-export-actions" aria-label="Export รายงานผู้บริหาร">
      <a className="lab-link-button lab-link-button--secondary" href={`/api/dashboard/executive/export?${query}&format=pdf`}><span className="dashboard-quick-action__icon" aria-hidden="true"><DownloadIcon /></span><span>PDF</span></a>
      <a className="lab-link-button lab-link-button--primary" href={`/api/dashboard/executive/export?${query}&format=xlsx`}><span className="dashboard-quick-action__icon" aria-hidden="true"><DownloadIcon /></span><span>Excel</span></a>
    </div>
  )
}

export function ExecutiveDashboardView({ data }: { data: ExecutiveOverview }) {
  const comparison = data.comparison
  const rangeLabel = `${formatThaiDate(data.fiscalYearRange.start)} – ${formatThaiDate(data.fiscalYearRange.end)}`
  const serviceHint = `งานจ้างระบบ ${money.format(data.spend.service)} + เช่าเครื่อง ${money.format(data.spend.lease)}`
  return (
    <div className="executive-dashboard" data-testid="executive-dashboard">
      <section className="executive-report-toolbar" aria-label="ตัวกรองและการ Export รายงาน">
        <div><p className="section-kicker">FISCAL YEAR {data.fiscalYear}</p><strong>ช่วงข้อมูล {rangeLabel}</strong><small>ข้อมูล ณ วันที่ {formatThaiDate(data.generatedOn)} · งานซื้อใช้ยอดจากรายการรับเข้าคลังที่บันทึกเรียบร้อยแล้ว</small></div>
        <ExportActions fiscalYear={data.fiscalYear} />
      </section>

      <section className="executive-kpi-grid" aria-label="ตัวเลขสำคัญรายปี">
        <KpiCard className="executive-kpi-card--total" label="ยอดรวมตามหมวด" value={data.spend.total} hint="งานซื้อ + งานจ้างทั้งหมด" comparison={comparison} />
        <KpiCard className="executive-kpi-card--purchase" label="งานซื้อ" value={data.spend.purchase} hint="ยอดจากรายการรับเข้าคลังที่บันทึกเรียบร้อยแล้ว · ไม่รวมเช่าเครื่อง" />
        <KpiCard className="executive-kpi-card--hiring" label="งานจ้างทั้งหมด" value={data.spend.hiringTotal} hint={serviceHint} actions={<><Link href={`/service-procurement/plans?fiscalYear=${data.fiscalYear}`}>แผนงานจ้างระบบ</Link><Link href={`/service-procurement/purchase-requests?fiscalYear=${data.fiscalYear}`}>PR/PO งานจ้าง</Link></>} />
        <KpiCard className="executive-kpi-card--lease" label="เช่าเครื่อง" value={data.spend.lease} hint="รายละเอียดภายในงานจ้าง · ไม่บวกซ้ำ" />
      </section>

      <DataQualityNote data={data} />

      <div className="executive-priority-grid">
        <AlertList alerts={data.alerts} fiscalYear={data.fiscalYear} />
        <CategoryBreakdown data={data} />
      </div>

      <section className="bench-panel executive-panel executive-monthly-panel executive-trend-panel" aria-labelledby="executive-monthly-title">
        <div className="bench-panel__header"><div><p className="section-kicker">FISCAL YEAR TREND</p><h2 id="executive-monthly-title">ยอดตามเดือนงบประมาณ</h2></div><span className="executive-panel__note">รวม {money.format(data.spend.total)}</span></div>
        <MonthlySpendChart rows={data.monthly} />
      </section>

      <ServiceSpendDetails data={data} />

      <LeaseDurationSummary data={data} />

      <section className="bench-panel executive-panel executive-lease-panel" aria-labelledby="executive-lease-title">
        <div className="bench-panel__header"><div><p className="section-kicker">LEASE CONTRACT REGISTER</p><h2 id="executive-lease-title">รายละเอียดสัญญาเช่าเครื่อง</h2><p className="executive-panel__description">ตรวจสอบอายุสัญญา วันที่เริ่ม–สิ้นสุด และค่าใช้จ่ายของแต่ละสัญญาในปีงบประมาณที่เลือก</p></div><StatusChip tone="neutral">{data.leaseContracts.length.toLocaleString('th-TH')} สัญญา</StatusChip></div>
        <ExecutiveLeaseTable contracts={data.leaseContracts} />
      </section>
    </div>
  )
}
