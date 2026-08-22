'use client'

import { useState, type FormEvent } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { runLoginAttempt } from '@/lib/auth/login'
import { createClient } from '@/lib/supabase/client'

export default function LoginPage() {
  const router = useRouter()
  const [ephisId, setEphisId] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setIsSubmitting(true)

    const result = await runLoginAttempt({
      identifier: ephisId,
      password,
      signIn: (credentials) => createClient().auth.signInWithPassword(credentials),
    })
    setIsSubmitting(false)

    if (!result.ok) {
      setError('เข้าสู่ระบบไม่สำเร็จ กรุณาตรวจสอบ E-Phis และรหัสผ่านแล้วลองอีกครั้ง')
      return
    }

    router.replace('/dashboard')
    router.refresh()
  }

  return (
    <main className="login-stage">
      <section className="login-form-panel" aria-labelledby="login-title">
        <div className="login-form-panel__inner">
          <div className="login-brand">
            <Image
              className="login-brand__logo"
              src="/images/cbh-lab-logo-v3.png"
              alt="CBH Lab"
              width={44}
              height={44}
              sizes="44px"
              preload
            />
            <span>
              <strong>LAB-CBH</strong>
              <small>Inventory &amp; Contract Management</small>
            </span>
          </div>

          <div className="login-heading">
            <p>กลุ่มงานเทคนิคการแพทย์ · โรงพยาบาลชลบุรี</p>
            <h1 id="login-title">เข้าสู่ระบบ<br />คลังพัสดุและสัญญา</h1>
            <span>ใช้บัญชีเดียวกับระบบ Lab Management Portal</span>
          </div>

          <form className="login-form" onSubmit={handleSubmit}>
            <label htmlFor="ephis-id">รหัส E-Phis</label>
            <input
              id="ephis-id"
              name="ephis-id"
              type="text"
              inputMode="numeric"
              autoComplete="username"
              value={ephisId}
              onChange={(event) => setEphisId(event.target.value)}
              placeholder="เช่น 9495"
              required
              autoFocus
            />

            <label htmlFor="password">รหัสผ่าน</label>
            <div className="password-field">
              <input
                id="password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
              <button
                className="password-toggle"
                type="button"
                onClick={() => setShowPassword((visible) => !visible)}
                aria-label={showPassword ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
                aria-pressed={showPassword}
                title={showPassword ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
                  <circle cx="12" cy="12" r="2.75" />
                  {showPassword ? <path d="m4 4 16 16" /> : null}
                </svg>
              </button>
            </div>

            {error ? <p className="form-error" role="alert">{error}</p> : null}

            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'กำลังตรวจสอบ…' : 'เข้าสู่ระบบ'}
            </Button>
          </form>

          <p className="login-help">หากไม่สามารถเข้าสู่ระบบได้ กรุณาติดต่อผู้ดูแลระบบกลุ่มงาน</p>
        </div>
      </section>

      <aside className="login-bench-panel" aria-label="ขอบเขตระบบ">
        <div>
          <p className="section-kicker section-kicker--light">LAB OPERATIONS</p>
          <h2>ระบบบริหาร<br /><span className="login-bench-panel__title-line">คลังน้ำยา-วัสดุวิทยาศาสตร์<br />และสัญญา</span></h2>
          <p>สัญญา · จัดซื้อ · รับเข้า · เบิกจ่าย · คงคลัง</p>
        </div>
        <dl>
          <div><dt>01</dt><dd>ทะเบียนสัญญาและรายการพัสดุ</dd></div>
          <div><dt>02</dt><dd>จัดซื้อ รับเข้า และตรวจรับ</dd></div>
          <div><dt>03</dt><dd>FIFO และระดับคงเหลือ</dd></div>
        </dl>
      </aside>
    </main>
  )
}
