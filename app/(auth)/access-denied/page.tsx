import { LogoutButton } from '@/components/ui/LogoutButton'

export default function AccessDeniedPage() {
  return (
    <main className="access-denied-stage">
      <section className="access-denied-card" aria-labelledby="access-denied-title">
        <span className="access-denied-card__code">403 · LAB-CBH INVENTORY &amp; CONTRACT MANAGEMENT</span>
        <h1 id="access-denied-title">บัญชีนี้ยังไม่มีสิทธิ์ใช้งาน</h1>
        <p>
          เข้าสู่ระบบสำเร็จแล้ว แต่ยังไม่ได้รับบทบาทในระบบงานคลัง
          กรุณาติดต่อผู้ดูแลระบบเพื่อกำหนดสิทธิ์ให้บัญชีนี้
        </p>
        <div className="access-denied-card__actions">
          <LogoutButton />
        </div>
      </section>
    </main>
  )
}
