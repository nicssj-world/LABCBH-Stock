'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { formatThaiDateTime } from '@/lib/inventory/presenter'
import {
  cancelServicePo,
  cancelServicePurchaseRequest,
  closeServicePo,
  confirmServicePurchaseRequest,
  setServiceEphisPrNumber,
  setServicePoNumber,
  uploadServicePoFile,
} from '@/lib/service-procurement/actions'
import { serviceRequestDisplayStatus, serviceRequestDisplayStatusLabel, serviceRequestDisplayStatusTone } from '@/lib/service-procurement/presenter'
import type { ServicePurchaseRequestRecord } from '@/lib/service-procurement/types'
import { formatBaht } from '@/lib/service-procurement/presenter'

interface Props {
  request: ServicePurchaseRequestRecord
  canOperate: boolean
  canEdit: boolean
  canClose?: boolean
  canCancel?: boolean
}

export function ServicePurchaseRequestControls({ request, canOperate, canEdit, canClose = canEdit, canCancel = canEdit }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [ephis, setEphis] = useState(request.ephisPrNumber ?? '')
  const [po, setPo] = useState(request.poNumber ?? '')
  const [isEditingEphisPrNumber, setIsEditingEphisPrNumber] = useState(!request.ephisPrNumber?.trim())
  const [isEditingPoNumber, setIsEditingPoNumber] = useState(!request.poNumber?.trim())
  const displayStatus = serviceRequestDisplayStatus(request)
  const hasEvidence = Boolean(request.poNumber?.trim() && request.poFileName?.trim())
  const activeExpenses = request.usageEvents.filter((event) => event.kind === 'lab_expense' && event.status === 'active')
  const activeTotal = activeExpenses.reduce((sum, event) => sum + event.amount, 0)

  function run(operation: () => Promise<unknown>) {
    setError(null)
    startTransition(async () => { try { await operation(); router.refresh() } catch (caught) { setError(caught instanceof Error ? caught.message : 'ดำเนินการไม่สำเร็จ') } })
  }

  function handleEphisPrNumberAction() {
    if (!isEditingEphisPrNumber) {
      setIsEditingEphisPrNumber(true)
      return
    }
    const value = ephis.trim()
    if (!value) return
    run(async () => {
      await setServiceEphisPrNumber(request.id, value)
      setEphis(value)
      setIsEditingEphisPrNumber(false)
    })
  }

  function handlePoNumberAction() {
    if (!isEditingPoNumber) {
      setIsEditingPoNumber(true)
      return
    }
    const value = po.trim()
    if (!value) return
    run(async () => {
      await setServicePoNumber(request.id, value)
      setPo(value)
      setIsEditingPoNumber(false)
    })
  }

  async function uploadPo(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(null)
    const formData = new FormData(event.currentTarget)
    startTransition(async () => { try { await uploadServicePoFile(request.id, formData); router.refresh() } catch (caught) { setError(caught instanceof Error ? caught.message : 'แนบไฟล์ PO ไม่สำเร็จ') } })
  }

  function cancelPo() {
    if (!window.confirm(`ยืนยันยกเลิกใบ PO ${request.poNumber ?? ''} หรือไม่ การยกเลิกจะคืนยอดสำรองเต็มจำนวน`)) return
    const reason = window.prompt('เหตุผลที่ยกเลิก PO (จำเป็น)')
    if (reason?.trim()) run(() => cancelServicePo(request.id, reason))
  }

  function closePo() {
    if (!window.confirm(`ยืนยันปิดใบ PO ${request.poNumber ?? ''} และตัดยอดค่าใช้จ่าย ${formatBaht(activeTotal)} จากแผนหรือไม่`)) return
    run(() => closeServicePo(request.id, null))
  }

  return (
    <>
      <section className="service-pr-controls" aria-label="การดำเนินการใบ PR งานจ้าง">
        <div className="service-pr-actions bench-panel">
          <div className="bench-panel__header"><div><p className="section-kicker">WORKFLOW</p><h2>ดำเนินการ</h2></div><span className={`status-chip status-chip--${serviceRequestDisplayStatusTone(displayStatus)}`}>{serviceRequestDisplayStatusLabel(displayStatus)}</span></div>
          {request.status === 'pending' && (canOperate || canEdit) && <div className="service-pr-workflow-actions" aria-label="การดำเนินการใบ PR">
            {canOperate && <Button className="service-pr-workflow-actions__confirm" disabled={pending} onClick={() => run(() => confirmServicePurchaseRequest(request.id))}>ยืนยัน PR โดยคลัง</Button>}
            {canEdit && <Button className="service-pr-workflow-actions__cancel" type="button" variant="danger" disabled={pending} onClick={() => { const reason = window.prompt('เหตุผลที่ยกเลิก PR'); if (reason?.trim()) run(() => cancelServicePurchaseRequest(request.id, reason)) }}>ยกเลิก PR</Button>}
          </div>}
          {request.status === 'confirmed' && canOperate && <div className="service-pr-fields" aria-label="เลขอ้างอิง PO">
            <div className="service-pr-field">
              <label><span>เลข PR จาก E-Phis</span><input readOnly={!isEditingEphisPrNumber} value={ephis} onChange={(event) => setEphis(event.target.value)} /></label>
              <Button type="button" variant="secondary" disabled={pending || (isEditingEphisPrNumber && !ephis.trim())} onClick={handleEphisPrNumberAction}>{isEditingEphisPrNumber ? 'บันทึกเลข PR' : 'แก้ไข'}</Button>
            </div>
            <div className="service-pr-field">
              <label><span>เลข PO</span><input readOnly={!isEditingPoNumber} value={po} onChange={(event) => setPo(event.target.value)} /></label>
              <Button type="button" variant="secondary" disabled={pending || (isEditingPoNumber && !po.trim())} onClick={handlePoNumberAction}>{isEditingPoNumber ? 'บันทึกเลข PO' : 'แก้ไข'}</Button>
            </div>
          </div>}
          {request.status === 'confirmed' && canOperate && <form className="service-po-upload" onSubmit={uploadPo}><label><span>แนบไฟล์ PO</span><input required type="file" name="file" accept="application/pdf,image/jpeg,image/png,image/webp" /></label><Button type="submit" variant="secondary" disabled={pending}>อัปโหลดไฟล์ PO</Button></form>}
          {request.status === 'confirmed' && hasEvidence && <div className="service-pr-action-row service-pr-action-row--po">{canClose && <Button type="button" disabled={pending} onClick={closePo}>ปิดใบ PO</Button>}{canCancel && <Button type="button" variant="danger" disabled={pending} onClick={cancelPo}>ยกเลิกใบ PO</Button>}</div>}
          {error && <p className="form-error" role="alert">{error}</p>}
        </div>

        {request.poEvents.length > 0 && <section className="bench-panel service-po-history" aria-label="ประวัติ PO"><div className="bench-panel__header"><div><p className="section-kicker">PO HISTORY</p><h2>ประวัติ PO</h2></div><p>{request.poEvents.length} รายการ</p></div><ul>{request.poEvents.map((event) => <li key={event.id}><strong>{event.kind === 'number_added' ? 'บันทึกเลข PO' : event.kind === 'file_added' ? 'แนบไฟล์ PO' : event.kind === 'closed' ? 'ปิด PO' : 'ยกเลิก PO'}</strong><span>{event.poNumber ?? 'ไม่มีเลข PO'} · {event.actorName ?? 'ไม่ระบุ'} · <time dateTime={event.createdAt}>{formatThaiDateTime(event.createdAt)}</time></span>{event.reason && <small>{event.reason}</small>}</li>)}</ul></section>}

      </section>
    </>
  )
}
