'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui/Button'

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }, reset: () => void }) {
  useEffect(() => {
    // In production the message itself is redacted by Next.js; the digest is
    // the only thread back to the real stack trace in the server log.
    console.error('Unhandled render error', error.digest ? `(digest: ${error.digest})` : '', error)
  }, [error])

  return (
    <section className="bench-panel empty-state empty-state--panel" role="alert">
      <h2>เกิดข้อผิดพลาดที่ไม่คาดคิด</h2>
      <p>ระบบไม่สามารถแสดงหน้านี้ได้ ข้อมูลที่บันทึกไปก่อนหน้านี้ยังปลอดภัย ลองอีกครั้ง หรือแจ้งผู้ดูแลระบบพร้อมรหัสอ้างอิงด้านล่าง</p>
      {error.digest && <p className="identifier">รหัสอ้างอิง: {error.digest}</p>}
      <div className="form-action-bar__buttons">
        <Button variant="secondary" onClick={() => window.location.assign('/dashboard')}>กลับหน้าหลัก</Button>
        <Button onClick={reset}>ลองใหม่</Button>
      </div>
    </section>
  )
}
