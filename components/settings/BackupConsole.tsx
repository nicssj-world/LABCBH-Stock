'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { requestDatabaseBackup } from '@/lib/backup/actions'
import type {
  BackupDashboard,
  BackupRun,
  BackupRunnerState,
  BackupStatus,
} from '@/lib/backup/types'

type StatusTone = 'neutral' | 'info' | 'progress' | 'attention' | 'success' | 'danger'
type HistoryRange = 'all' | '30' | '90' | '365'

const STATUS_META: Record<BackupStatus, { label: string; tone: StatusTone; description: string }> = {
  requested: {
    label: 'รอ Local runner',
    tone: 'attention',
    description: 'คำขอถูกส่งแล้ว กำลังรอเครื่อง Local รับงาน',
  },
  running: {
    label: 'กำลังสำรอง',
    tone: 'progress',
    description: 'Local runner กำลังอ่านฐานข้อมูลและสร้างไฟล์สำรอง',
  },
  succeeded: {
    label: 'สำเร็จ',
    tone: 'success',
    description: 'ไฟล์สำรองถูกสร้างและตรวจสอบ checksum แล้ว',
  },
  failed: {
    label: 'ล้มเหลว',
    tone: 'danger',
    description: 'ระบบสร้างไฟล์สำรองไม่สำเร็จ',
  },
  pruned: {
    label: 'สำเร็จ · ล้างไฟล์แล้ว',
    tone: 'neutral',
    description: 'งานสำรองสำเร็จ แต่ไฟล์ถูกล้างตามนโยบาย 30 วัน',
  },
}

const RUNNER_META: Record<BackupRunnerState, { label: string; tone: StatusTone; description: string }> = {
  ready: {
    label: 'พร้อมใช้งาน',
    tone: 'success',
    description: 'มี Local runner ที่เชื่อมต่อภายใน 3 นาทีที่ผ่านมา',
  },
  waiting: {
    label: 'กำลังรอรับงาน',
    tone: 'attention',
    description: 'runner ออนไลน์แล้ว และจะรับคำขอจากคิวอัตโนมัติ',
  },
  running: {
    label: 'กำลังทำงาน',
    tone: 'progress',
    description: 'runner กำลังสำรองฐานข้อมูลอยู่ กรุณาอย่าสั่งซ้ำ',
  },
  offline: {
    label: 'ไม่พบ runner ล่าสุด',
    tone: 'danger',
    description: 'ยังไม่พบการเชื่อมต่อในช่วง 3 นาทีที่ผ่านมา',
  },
  unknown: {
    label: 'ยังไม่ได้เชื่อมต่อ',
    tone: 'neutral',
    description: 'เปิด Local runner ด้วยโหมด --watch เพื่อให้ระบบติดตามสถานะ',
  },
}

function StatusMark({ tone }: { tone: StatusTone }) {
  return <span className={`backup-status-mark backup-status-mark--${tone}`} aria-hidden="true" />
}

function BackupIcon({ name }: { name: 'database' | 'runner' | 'clock' | 'check' | 'alert' | 'calendar' | 'close' }) {
  return (
    <svg className="backup-icon" viewBox="0 0 24 24" aria-hidden="true">
      {name === 'database' && <><ellipse cx="12" cy="5" rx="7" ry="3" /><path d="M5 5v7c0 1.7 3.1 3 7 3s7-1.3 7-3V5" /><path d="M5 12v7c0 1.7 3.1 3 7 3s7-1.3 7-3v-7" /></>}
      {name === 'runner' && <><rect x="4" y="5" width="16" height="14" rx="2" /><path d="M8 9h8M8 13h3M8 16h2" /><path d="m15 13 2 2 3-4" /></>}
      {name === 'clock' && <><circle cx="12" cy="12" r="8" /><path d="M12 7v5l3 2" /></>}
      {name === 'check' && <><circle cx="12" cy="12" r="8" /><path d="m8 12 2.5 2.5L16 9" /></>}
      {name === 'alert' && <><path d="m12 4 8 15H4L12 4Z" /><path d="M12 9v4M12 16h.01" /></>}
      {name === 'calendar' && <><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M8 3v4M16 3v4M4 9h16M8 13h.01M12 13h.01M16 13h.01M8 16h.01M12 16h.01" /></>}
      {name === 'close' && <path d="m6 6 12 12M18 6 6 18" />}
    </svg>
  )
}

function StatusChip({ status }: { status: BackupStatus }) {
  const meta = STATUS_META[status]
  return (
    <span className={`status-chip status-chip--${meta.tone}`}>
      <StatusMark tone={meta.tone} />
      {meta.label}
    </span>
  )
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '—'
  return new Intl.DateTimeFormat('th-TH-u-nu-latn', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Bangkok',
  }).format(date)
}

function formatBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes)) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(2)} MiB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GiB`
}

function formatDuration(run: BackupRun): string {
  if (!run.started_at || !run.completed_at) return 'ยังไม่เสร็จ'
  const milliseconds = new Date(run.completed_at).getTime() - new Date(run.started_at).getTime()
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return '—'
  const seconds = Math.round(milliseconds / 1000)
  if (seconds < 60) return `${seconds} วินาที`
  return `${Math.floor(seconds / 60)} นาที ${seconds % 60} วินาที`
}

function runDate(run: BackupRun): number {
  return new Date(run.requested_at).getTime()
}

function runnerStatusLabel(state: BackupRunnerState) {
  return RUNNER_META[state]
}

export function BackupConsole({ dashboard }: { dashboard: BackupDashboard }) {
  const router = useRouter()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [isPending, startTransition] = useTransition()
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'danger'; message: string } | null>(null)
  const [statusFilter, setStatusFilter] = useState<BackupStatus | 'all'>('all')
  const [historyRange, setHistoryRange] = useState<HistoryRange>('all')
  const [filterNow] = useState(() => Date.now())
  const activeRun = dashboard.activeRun
  const runnerMeta = runnerStatusLabel(dashboard.runnerState)

  useEffect(() => {
    if (!activeRun) return
    const timer = window.setInterval(() => {
      startTransition(() => router.refresh())
    }, 10_000)
    return () => window.clearInterval(timer)
  }, [activeRun, router, startTransition])

  const filteredRuns = useMemo(() => {
    const cutoff = historyRange === 'all'
      ? null
      : filterNow - Number(historyRange) * 24 * 60 * 60 * 1000
    return dashboard.runs.filter((run) => {
      if (statusFilter !== 'all' && run.status !== statusFilter) return false
      return cutoff === null || runDate(run) >= cutoff
    })
  }, [dashboard.runs, filterNow, historyRange, statusFilter])

  const latestTitle = activeRun?.status === 'running'
    ? 'กำลังสำรองฐานข้อมูล'
    : activeRun?.status === 'requested'
      ? 'ส่งคำขอแล้ว รอเครื่อง Local'
      : dashboard.lastSuccessfulRun
        ? 'ระบบสำรองพร้อมใช้งาน'
        : 'ยังไม่มีไฟล์สำรองในระบบ'

  function openRequestDialog() {
    setFeedback(null)
    dialogRef.current?.showModal()
  }

  function closeRequestDialog() {
    if (dialogRef.current?.open) dialogRef.current.close()
  }

  function submitRequest() {
    setFeedback(null)
    startTransition(async () => {
      try {
        const run = await requestDatabaseBackup()
        closeRequestDialog()
        setFeedback({
          tone: 'success',
          message: run.status === 'requested'
            ? 'ส่งคำขอสำรองข้อมูลแล้ว Local runner จะเริ่มทำงานโดยอัตโนมัติ'
            : 'มีงานสำรองข้อมูลของโปรเจกต์นี้อยู่แล้ว ระบบจะติดตามผลจากงานเดิม',
        })
        router.refresh()
      } catch (cause) {
        setFeedback({
          tone: 'danger',
          message: cause instanceof Error ? cause.message : 'ส่งคำขอสำรองข้อมูลไม่สำเร็จ',
        })
      }
    })
  }

  return (
    <div className="backup-console">
      <section className={`bench-panel backup-command-panel${activeRun ? ' backup-command-panel--active' : ''}`} aria-labelledby="backup-command-title">
        <div className="backup-command-panel__main">
          <div className="backup-command-panel__identity">
            <div className="backup-command-panel__icon" aria-hidden="true"><BackupIcon name="database" /></div>
            <div>
              <div className="backup-command-panel__status-row">
                {activeRun ? <StatusChip status={activeRun.status} /> : <span className="status-chip status-chip--success"><StatusMark tone="success" />พร้อมสั่งงาน</span>}
                <span className="identifier">{dashboard.projectRef}</span>
              </div>
              <h2 id="backup-command-title">{latestTitle}</h2>
              <p>
                สำรอง schema, ตาราง, ข้อมูล, functions, policies และโครงสร้างที่เกี่ยวข้องลงเครื่อง Local โดยไม่ส่งไฟล์ผ่าน Vercel
              </p>
            </div>
          </div>
          <button
            className="lab-button lab-button--primary backup-command-panel__action"
            type="button"
            disabled={Boolean(activeRun) || isPending}
            onClick={openRequestDialog}
          >
            <BackupIcon name="database" />
            {isPending ? 'กำลังส่งคำขอ…' : activeRun ? 'มีงานสำรองอยู่แล้ว' : 'สำรองข้อมูลตอนนี้'}
          </button>
        </div>

        <div className="backup-command-panel__facts" aria-label="ข้อมูลการสำรองล่าสุด">
          <div>
            <span>สำเร็จล่าสุด</span>
            <strong>{formatDate(dashboard.lastSuccessfulRun?.completed_at)}</strong>
            <small>{dashboard.lastSuccessfulRun ? formatBytes(dashboard.lastSuccessfulRun.bytes) : 'ยังไม่มีข้อมูล'}</small>
          </div>
          <div>
            <span>การทำงานล่าสุด</span>
            <strong>{dashboard.latestRun ? formatDate(dashboard.latestRun.requested_at) : 'ยังไม่มีคำขอ'}</strong>
            <small>{dashboard.latestRun ? `ครั้งที่ ${dashboard.latestRun.attempts}` : 'เริ่มจากปุ่มด้านบน'}</small>
          </div>
          <div>
            <span>นโยบายไฟล์</span>
            <strong>30 วัน</strong>
            <small>เก็บไฟล์สำเร็จล่าสุดเสมอ</small>
          </div>
        </div>
      </section>

      {feedback && (
        <div className={`backup-feedback backup-feedback--${feedback.tone}`} role={feedback.tone === 'danger' ? 'alert' : 'status'} aria-live="polite">
          <StatusMark tone={feedback.tone} />
          <p>{feedback.message}</p>
        </div>
      )}

      <div className="backup-overview-grid">
        <section className="bench-panel backup-runner-panel" aria-labelledby="backup-runner-title">
          <div className="bench-panel__header">
            <div>
              <h2 id="backup-runner-title">สถานะเครื่องสำรอง</h2>
            </div>
            <span className={`status-chip status-chip--${runnerMeta.tone}`}><StatusMark tone={runnerMeta.tone} />{runnerMeta.label}</span>
          </div>
          <div className="backup-runner-panel__body">
            <div className="backup-runner-panel__signal"><BackupIcon name="runner" /></div>
            <div>
              <strong>{runnerMeta.description}</strong>
              <p>{dashboard.primaryRunner ? `Runner: ${dashboard.primaryRunner.runner_id}` : 'ยังไม่มี runner รายงานตัวเข้าระบบ'}</p>
              {dashboard.primaryRunner && <small>เชื่อมต่อล่าสุด {formatDate(dashboard.primaryRunner.last_seen_at)}</small>}
            </div>
          </div>
          {dashboard.runnerState === 'unknown' || dashboard.runnerState === 'offline' ? (
            <p className="backup-runner-panel__hint">เปิดคำสั่ง <code>npm run backup:database -- --watch</code> บนเครื่องที่เก็บไฟล์ backup</p>
          ) : null}
        </section>

        <section className="bench-panel backup-policy-panel" aria-labelledby="backup-policy-title">
          <div className="bench-panel__header">
            <div>
              <h2 id="backup-policy-title">ขอบเขตและรอบเวลา</h2>
            </div>
            <BackupIcon name="calendar" />
          </div>
          <dl className="backup-policy-list">
            <div><dt>รอบแนะนำ</dt><dd>เดือนละครั้ง · 02:00 น.</dd></div>
            <div><dt>รูปแบบไฟล์</dt><dd className="identifier">PostgreSQL custom (-Fc)</dd></div>
            <div><dt>ปลายทาง</dt><dd>เครื่อง Local ที่ตั้งค่า runner</dd></div>
            <div><dt>ไม่รวม</dt><dd>ไฟล์ object ใน Supabase Storage</dd></div>
          </dl>
        </section>
      </div>

      <section className="bench-panel backup-history-panel" aria-labelledby="backup-history-title">
        <div className="bench-panel__header backup-history-panel__header">
          <div>
            <h2 id="backup-history-title">ประวัติการสำรอง</h2>
          </div>
          <p>{filteredRuns.length} รายการจาก {dashboard.runs.length} รายการ</p>
        </div>

        <div className="backup-history-filters" aria-label="ตัวกรองประวัติการสำรอง">
          <label>
            สถานะ
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as BackupStatus | 'all')}>
              <option value="all">ทุกสถานะ</option>
              {(Object.keys(STATUS_META) as BackupStatus[]).map((status) => <option key={status} value={status}>{STATUS_META[status].label}</option>)}
            </select>
          </label>
          <label>
            ช่วงเวลา
            <select value={historyRange} onChange={(event) => setHistoryRange(event.target.value as HistoryRange)}>
              <option value="all">ทั้งหมด</option>
              <option value="30">30 วันที่ผ่านมา</option>
              <option value="90">90 วันที่ผ่านมา</option>
              <option value="365">1 ปีที่ผ่านมา</option>
            </select>
          </label>
        </div>

        {dashboard.runs.length === 0 ? (
          <div className="backup-empty-state">
            <div className="backup-empty-state__icon" aria-hidden="true"><BackupIcon name="database" /></div>
            <div>
              <h3>ยังไม่มีประวัติการสำรอง</h3>
              <p>เริ่มจากกด “สำรองข้อมูลตอนนี้” แล้วเปิด Local runner เพื่อรับงานแรก</p>
            </div>
          </div>
        ) : filteredRuns.length === 0 ? (
          <p className="empty-state backup-filter-empty">ไม่พบรายการตามตัวกรองที่เลือก</p>
        ) : (
          <>
            <ol className="backup-timeline" aria-label="ลำดับการสำรองล่าสุด">
              {filteredRuns.slice(0, 5).map((run) => (
                <li key={run.id} className={`backup-timeline__item backup-timeline__item--${STATUS_META[run.status].tone}`}>
                  <span className="backup-timeline__marker" aria-hidden="true"><StatusMark tone={STATUS_META[run.status].tone} /></span>
                  <div>
                    <div className="backup-timeline__topline"><strong>{STATUS_META[run.status].label}</strong><time dateTime={run.requested_at}>{formatDate(run.requested_at)}</time></div>
                    <p>{STATUS_META[run.status].description}</p>
                  </div>
                </li>
              ))}
            </ol>

            <div className="backup-history-table-wrap">
              <table className="data-table backup-history-table">
                <thead><tr><th>เวลาที่ขอ</th><th>แหล่งที่มา</th><th>สถานะ</th><th>ไฟล์ / ขนาด</th><th>ระยะเวลา</th><th>Runner</th></tr></thead>
                <tbody>
                  {filteredRuns.map((run) => (
                    <tr key={run.id}>
                      <td><strong>{formatDate(run.requested_at)}</strong><small className="identifier">{run.id.slice(0, 8)}</small></td>
                      <td>{run.trigger_source === 'scheduled' ? 'ตั้งเวลา' : 'สั่งเอง'}</td>
                      <td><StatusChip status={run.status} />{run.error_message && <small className="backup-history-table__error">{run.error_message}</small>}</td>
                      <td>{run.file_name ? <><strong>{run.file_name}</strong><small>{formatBytes(run.bytes)}</small></> : '—'}</td>
                      <td>{formatDuration(run)}</td>
                      <td className="identifier">{run.runner_id ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <ul className="backup-history-cards">
              {filteredRuns.map((run) => (
                <li key={run.id} className="backup-history-card">
                  <div className="backup-history-card__topline"><StatusChip status={run.status} /><time dateTime={run.requested_at}>{formatDate(run.requested_at)}</time></div>
                  <dl><div><dt>แหล่งที่มา</dt><dd>{run.trigger_source === 'scheduled' ? 'ตั้งเวลา' : 'สั่งเอง'}</dd></div><div><dt>ไฟล์</dt><dd>{run.file_name ?? 'ยังไม่มีไฟล์'}</dd></div><div><dt>ขนาด</dt><dd>{formatBytes(run.bytes)}</dd></div><div><dt>Runner</dt><dd className="identifier">{run.runner_id ?? '—'}</dd></div></dl>
                  {run.error_message && <p className="backup-history-card__error">{run.error_message}</p>}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <details className="backup-runner-guide">
        <summary>วิธีตั้งค่า Local runner สำหรับเจ้าหน้าที่ระบบ</summary>
        <div className="backup-runner-guide__body">
          <div>
            <h2>เครื่อง Local เป็นผู้ถือไฟล์จริง</h2>
            <p>ติดตั้ง PostgreSQL client ให้มี <code>pg_dump</code> ใน PATH จากนั้นใส่ค่า backup environment บนเครื่องนั้นเท่านั้น แล้วเปิด runner แบบ watch หรือเรียก scheduled ผ่าน Windows Task Scheduler</p>
          </div>
          <pre><code>npm run backup:database -- --watch{`\n`}npm run backup:database -- --scheduled</code></pre>
        </div>
      </details>

      <dialog ref={dialogRef} className="app-dialog backup-request-dialog" aria-labelledby="backup-request-title">
        <div className="app-dialog__header">
          <div>
            <h2 id="backup-request-title">ยืนยันการสำรองฐานข้อมูล</h2>
            <p>ระบบจะส่งคำขอให้ Local runner สร้างไฟล์สำรองฐานข้อมูลเต็มชุด</p>
          </div>
          <button className="app-dialog__close" type="button" aria-label="ปิดหน้าต่างยืนยัน" onClick={closeRequestDialog}><BackupIcon name="close" /></button>
        </div>
        <div className="backup-request-dialog__body">
          <div className="backup-request-dialog__notice">
            <BackupIcon name="database" />
            <div><strong>การสำรองนี้อ่านข้อมูลทั้งฐานข้อมูล</strong><p>อาจใช้เวลาตามขนาดข้อมูล ไฟล์จะถูกเขียนลงเครื่อง Local โดยตรง และไม่ถูกส่งผ่าน Vercel</p></div>
          </div>
          <dl className="backup-request-dialog__facts"><div><dt>Project</dt><dd className="identifier">{dashboard.projectRef}</dd></div><div><dt>รูปแบบ</dt><dd>Full logical backup</dd></div><div><dt>Retention</dt><dd>30 วัน + เก็บไฟล์ล่าสุด</dd></div></dl>
          <div className="backup-request-dialog__actions"><button className="lab-button lab-button--secondary" type="button" disabled={isPending} onClick={closeRequestDialog}>ยกเลิก</button><button className="lab-button lab-button--primary" type="button" disabled={isPending} onClick={submitRequest}>{isPending ? 'กำลังส่งคำขอ…' : 'ยืนยันและส่งคำขอ'}</button></div>
        </div>
      </dialog>
    </div>
  )
}
