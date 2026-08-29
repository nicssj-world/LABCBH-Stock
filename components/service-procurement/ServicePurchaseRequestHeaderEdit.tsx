'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { updateServicePurchaseRequestHeader } from '@/lib/service-procurement/actions'
import type { ServicePurchaseRequestRecord } from '@/lib/service-procurement/types'

export function ServicePurchaseRequestHeaderEdit({ request, departments }: { request: ServicePurchaseRequestRecord; departments: readonly string[] }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [department, setDepartment] = useState(request.department)
  const [requestedDate, setRequestedDate] = useState(request.requestedDate)
  const [note, setNote] = useState(request.note ?? '')
  const [error, setError] = useState<string | null>(null)
  const departmentOptions = departments.includes(request.department) ? departments : [request.department, ...departments]

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    startTransition(async () => {
      try {
        await updateServicePurchaseRequestHeader(request.id, { department, requestedDate, note: note || null })
        router.refresh()
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'แก้ไขข้อมูลใบ PR ไม่สำเร็จ')
      }
    })
  }

  return <form id="service-pr-header-edit" className="bench-panel service-pr-header-edit" onSubmit={submit}><div className="bench-panel__header"><div><p className="section-kicker">EDIT BEFORE CONFIRM</p><h2>แก้ไขข้อมูลก่อนคลังยืนยัน</h2></div></div><div className="form-grid"><label><span>หน่วยงานผู้ขอ</span><select value={department} onChange={(event) => setDepartment(event.target.value)}>{departmentOptions.map((value) => <option key={value}>{value}</option>)}</select></label><label><span>วันที่ขอ</span><input type="date" required value={requestedDate} onChange={(event) => setRequestedDate(event.target.value)} /></label><label className="form-grid__wide"><span>หมายเหตุ</span><textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} /></label></div>{error && <p className="form-error" role="alert">{error}</p>}<Button type="submit" variant="secondary" disabled={pending}>{pending ? 'กำลังบันทึก…' : 'บันทึกการแก้ไข'}</Button></form>
}
