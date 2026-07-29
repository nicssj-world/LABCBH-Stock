import { StatusChip } from '@/components/ui/StatusChip'

const workAreas = [
  { code: '01', title: 'บริหารสัญญา', detail: 'ติดตามขั้นตอนและยอดคงเหลือราย LS' },
  { code: '02', title: 'คำขอซื้อและรับเข้า', detail: 'เชื่อม PR, PO และการรับเข้าแบบ Lot' },
  { code: '03', title: 'เบิกจ่ายและคงคลัง', detail: 'จัดลำดับ Lot และติดตาม minimum stock' },
]

export default function DashboardPage() {
  return (
    <div className="dashboard-intro">
      <section className="page-heading" aria-labelledby="dashboard-title">
        <div>
          <StatusChip tone="info">CONTROL BENCH</StatusChip>
          <h1 id="dashboard-title">ภาพรวมงานคลังน้ำยาและวัสดุวิทยาศาสตร์</h1>
          <p>ศูนย์ควบคุมสัญญา การขอซื้อ การรับเข้า และการเบิกจ่ายในระบบเดียว</p>
        </div>
        <StatusChip tone="attention">กำลังเตรียมข้อมูลเริ่มต้น</StatusChip>
      </section>

      <section className="bench-panel" aria-labelledby="work-area-title">
        <div className="bench-panel__header">
          <div>
            <p className="section-kicker">WORK AREAS</p>
            <h2 id="work-area-title">เส้นทางงานหลัก</h2>
          </div>
          <p>ข้อมูลจริงจะแสดงหลังเชื่อม schema และ migration ในขั้นถัดไป</p>
        </div>
        <ol className="work-area-list">
          {workAreas.map((area) => (
            <li key={area.code}>
              <span className="work-area-list__code">{area.code}</span>
              <span>
                <strong>{area.title}</strong>
                <small>{area.detail}</small>
              </span>
              <span className="work-area-list__state">เตรียมระบบ</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  )
}
