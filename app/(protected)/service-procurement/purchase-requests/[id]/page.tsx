import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireActor } from '@/lib/auth/actor'
import { canCancelServicePurchaseRequestPo, canCloseServicePurchaseRequest, canCreateServicePurchaseRequest, canOperateServicePurchaseRequest, canRecordServicePlanExpense } from '@/lib/service-procurement/authorization'
import { getServicePurchaseRequest, getServicePlan } from '@/lib/service-procurement/queries'
import { formatThaiDateFull } from '@/lib/date/thai'
import { formatQuantity } from '@/lib/inventory/presenter'
import { formatBaht, serviceMethodLabel, servicePoStatusLabel, serviceRequestDisplayStatus, serviceRequestDisplayStatusLabel, serviceRequestDisplayStatusTone } from '@/lib/service-procurement/presenter'
import { ServicePurchaseRequestControls } from '@/components/service-procurement/ServicePurchaseRequestControls'
import { ServicePurchaseRequestExpenseEntry } from '@/components/service-procurement/ServicePurchaseRequestExpenseEntry'
import { ServicePurchaseRequestExpenseLog } from '@/components/service-procurement/ServicePurchaseRequestExpenseLog'
import { ServicePurchaseRequestInvoiceExportLink } from '@/components/service-procurement/ServicePurchaseRequestInvoiceExportLink'

export default async function ServicePurchaseRequestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor()
  const { id } = await params
  const request = await getServicePurchaseRequest(id)
  if (!request) notFound()

  const plan = request.planId ? (await getServicePlan(request.planId))?.plan ?? null : null
  const responsibleIds = plan?.responsibles.map((person) => person.profileId) ?? []
  const canEdit = canCreateServicePurchaseRequest(actor) && (request.requesterId === actor.id || actor.appRoles.includes('admin') || actor.appRoles.includes('head'))
  const canRecord = canRecordServicePlanExpense(actor, responsibleIds, request.requesterId)
  const displayStatus = serviceRequestDisplayStatus(request)
  const hasPoEvidence = Boolean(request.poNumber?.trim() || request.poFileName?.trim())
  const requestedItems = request.items.filter((item) => item.requestedQuantity > 0)
  const expenseEvents = request.usageEvents.filter((event) => event.kind === 'lab_expense')
  const activeExpenses = expenseEvents.filter((event) => event.status === 'active')
  const activeExpenseTotal = activeExpenses.reduce((sum, event) => sum + event.amount, 0)
  const totalRequestedQuantity = requestedItems.reduce((sum, item) => sum + item.requestedQuantity, 0)
  const documents = [
    ...request.attachments.map((file) => ({
      id: file.id,
      label: 'TOR',
      fileName: file.fileName,
      href: `/api/service-procurement/purchase-requests/${request.id}/files/${file.id}`,
    })),
    ...request.planDocuments.map((file) => ({
      id: file.id,
      label: file.kind === 'quotation' ? 'ใบเสนอราคา · ระดับแผน' : 'หน้าสัญญา · ระดับแผน',
      fileName: file.fileName,
      href: `/api/service-procurement/plans/${request.planId}/documents/${file.id}`,
    })),
    ...(request.poFileName ? [{
      id: 'po-file',
      label: 'ไฟล์ PO',
      fileName: request.poFileName,
      href: `/api/service-procurement/purchase-requests/${request.id}/files/po`,
    }] : []),
  ]
  const committeeGroups = [
    { kind: 'specification' as const, title: 'กำหนดราคากลางและคุณลักษณะเฉพาะ' },
    { kind: 'inspection' as const, title: 'ตรวจรับพัสดุ' },
  ].map((group) => ({ ...group, members: request.committees.filter((row) => row.kind === group.kind) }))

  return (
    <div className="route-stack service-pr-detail-page">
      <header className="page-heading page-heading--actions service-pr-detail__hero">
        <div className="service-pr-detail__hero-copy">
          <Link className="back-link service-pr-detail__back" href="/service-procurement/purchase-requests">← ใบ PR (งานจ้าง)</Link>
          <div className="service-pr-detail__document-meta"><span className="identifier">{request.documentNumber}</span><span aria-hidden="true">·</span><span>ปีงบประมาณ {request.fiscalYear}</span></div>
          <h1>{request.planName ?? 'ไม่พบแผน'}</h1>
          <p className="service-pr-detail__subtitle">{request.department} · {serviceMethodLabel(request.purchaseMethod)} · ขอวันที่ {formatThaiDateFull(request.requestedDate)}</p>
        </div>
        <div className="service-pr-detail__status-group" aria-label="สถานะใบ PR">
          {request.isRedCross && <ServicePurchaseRequestInvoiceExportLink request={request} />}
          {canEdit && request.status === 'pending' && (
            <Link
              className="lab-link-button lab-link-button--secondary"
              href={`/service-procurement/purchase-requests/${request.id}/edit`}
            >
              แก้ไขใบ PR
            </Link>
          )}
          <span className={`status-chip status-chip--${serviceRequestDisplayStatusTone(displayStatus)}`}>{serviceRequestDisplayStatusLabel(displayStatus)}</span>
          <span className="status-chip status-chip--service">{servicePoStatusLabel(request.poStatus)}</span>
        </div>
      </header>

      <section className="bench-panel service-pr-detail__overview service-pr-detail__metrics" aria-labelledby="service-pr-overview-title">
        <div className="service-pr-detail__overview-main service-pr-detail__metric--primary">
          <div>
            <h2 id="service-pr-overview-title">สรุปใบ PR</h2>
            <p>วงเงินที่ระบบสำรองไว้จากแผนงานจ้าง</p>
          </div>
          <strong className="identifier">{formatBaht(request.requestedAmount)}</strong>
          <span>วงเงิน PR (สำรอง)</span>
        </div>
        <dl className="service-pr-detail__overview-facts">
          <div><dt>ใช้จริงในแผน</dt><dd className="identifier">{formatBaht(request.status === 'closed' ? request.actualAmount : 0)}</dd><small>{request.status === 'closed' ? 'ตัดยอดแล้วเมื่อปิด PO' : 'ยังไม่ตัดยอดจนกว่าจะปิด PO'}</small></div>
          <div><dt>ผู้ขอ</dt><dd>{request.requesterName}</dd><small>ผู้สร้างใบ PR</small></div>
          <div><dt>เลข PR จาก E-Phis</dt><dd className="identifier">{request.ephisPrNumber ?? 'ยังไม่ได้ระบุ'}</dd><small>กรอกหลังคลังยืนยัน</small></div>
          <div><dt>เลข PO</dt><dd className="identifier">{request.poNumber ?? 'ยังไม่มี'}</dd><small>{request.poFileName ? 'มีไฟล์ PO แล้ว' : 'รอออก PO'}</small></div>
        </dl>
      </section>

      <section className="bench-panel service-pr-detail__section" aria-labelledby="service-pr-details-title">
        <div className="bench-panel__header service-pr-detail__section-header">
          <div><h2 id="service-pr-details-title">รายละเอียดคำขอ</h2><p>ข้อมูลหัวใบ PR และช่วงเวลาที่จะใช้ PO</p></div>
        </div>
        <dl className="service-detail-facts service-pr-detail__facts">
          <div><dt>หน่วยงานผู้ขอ</dt><dd>{request.department}</dd></div>
          <div><dt>ประเภทงาน</dt><dd>{serviceMethodLabel(request.purchaseMethod)}</dd></div>
          <div><dt>แผนที่อ้างอิง</dt><dd><Link className="text-link" href={`/service-procurement/plans/${request.planId}`}>{request.planName ?? 'ไม่พบแผน'}</Link></dd></div>
          <div><dt>ช่วงวันที่ที่จะใช้ PO</dt><dd className="identifier">{formatThaiDateFull(request.usageStartDate)} – {formatThaiDateFull(request.usageEndDate)}</dd></div>
          <div><dt>วันที่สร้างใบ PR</dt><dd className="identifier">{formatThaiDateFull(request.requestedDate)}</dd></div>
          <div><dt>หมายเหตุ</dt><dd>{request.note ?? '—'}</dd></div>
        </dl>
      </section>

      {requestedItems.length > 0 && <section className="bench-panel service-pr-detail__section service-pr-detail__items" aria-labelledby="service-pr-items-title">
        <div className="bench-panel__header service-pr-detail__section-header">
          <div><h2 id="service-pr-items-title">รายการส่งตรวจ</h2><p>ข้อมูล snapshot ณ วันที่สร้าง PR ไม่เปลี่ยนตามแผนภายหลัง</p></div>
          <div className="service-pr-detail__section-stat"><strong>{requestedItems.length}</strong><span>รายการ · จำนวนรวม {formatQuantity(totalRequestedQuantity)}</span></div>
        </div>
        <div className="service-pr-detail__table-wrap">
          <table className="data-table service-pr-test-items-table service-pr-detail__items-table">
            <caption className="sr-only">รายการส่งตรวจที่อ้างในใบ PR</caption>
            <thead><tr><th>รายการ</th><th>หน่วย</th><th className="numeric-cell">ราคาต่อหน่วย (บาท)</th><th className="numeric-cell">จำนวน</th><th className="numeric-cell">รวม</th></tr></thead>
            <tbody>{requestedItems.map((item) => <tr key={item.id}><td>{item.name}</td><td>{item.unit}</td><td className="numeric-cell identifier">{item.unitPrice === null ? 'ยังไม่ระบุ' : formatBaht(item.unitPrice)}</td><td className="numeric-cell identifier">{formatQuantity(item.requestedQuantity)}</td><td className="numeric-cell identifier">{item.lineTotal === null ? '—' : formatBaht(item.lineTotal)}</td></tr>)}</tbody>
            <tfoot><tr><th colSpan={4} className="numeric-cell">ยอดรวมตาม PR</th><td className="numeric-cell identifier">{formatBaht(request.requestedAmount)}</td></tr></tfoot>
          </table>
        </div>
      </section>}

      <ServicePurchaseRequestExpenseEntry request={request} canRecord={canRecord} />
      <ServicePurchaseRequestExpenseLog request={request} canRecord={canRecord} />

      {hasPoEvidence && <section className="bench-panel service-pr-detail__section service-pr-detail__expenses" aria-labelledby="service-pr-expenses-title">
        <div className="bench-panel__header service-pr-detail__section-header">
          <div><h2 id="service-pr-expenses-title">ประวัติค่าใช้จ่าย</h2><p>รายการที่บันทึกก่อนปิด PO ระบบจะตัดยอดแผนเมื่อปิด PO เท่านั้น</p></div>
          <div className="service-pr-detail__section-stat"><strong>{activeExpenses.length}</strong><span>รายการ active</span></div>
        </div>
        {expenseEvents.length === 0 ? <div className="service-pr-detail__empty service-pr-detail__empty--large"><strong>ยังไม่มีการบันทึกค่าใช้จ่าย</strong><p>เมื่อมีการบันทึกค่าใช้จ่าย รายการจะแสดงในส่วนนี้</p></div> : <div className="service-pr-detail__table-wrap"><table className="data-table service-pr-detail__expenses-table"><caption className="sr-only">ประวัติค่าใช้จ่ายของใบ PR</caption><thead><tr><th>วันที่</th><th>Invoice</th><th className="numeric-cell">ยอด</th><th>สถานะ</th><th>หมายเหตุ</th><th>ผู้บันทึก</th></tr></thead><tbody>{expenseEvents.map((event) => <tr key={event.id}><td className="identifier">{formatThaiDateFull(event.expenseDate)}</td><td>{event.invoiceNumber ?? '—'}</td><td className="numeric-cell identifier">{formatBaht(event.amount)}</td><td><span className={`status-chip status-chip--${event.status === 'active' ? 'success' : 'neutral'}`}>{event.status === 'active' ? 'active' : 'ยกเลิกแล้ว'}</span></td><td>{event.note ?? '—'}</td><td>{event.actorName ?? '—'}</td></tr>)}</tbody><tfoot><tr><th colSpan={2}>ยอด active</th><td className="numeric-cell identifier">{formatBaht(activeExpenseTotal)}</td><td colSpan={3}>จาก {formatBaht(request.requestedAmount)} ของวงเงิน PR</td></tr></tfoot></table></div>}
      </section>}

      <section className="bench-panel service-pr-detail__section service-pr-detail__evidence" aria-labelledby="service-pr-evidence-title">
        <div className="bench-panel__header service-pr-detail__section-header">
          <div><h2 id="service-pr-evidence-title">เอกสารและกรรมการ</h2><p>หลักฐานประกอบและรายชื่อที่ใช้ในกระบวนการอนุมัติ</p></div>
        </div>
        <div className="service-pr-detail__evidence-grid">
          <div className="service-pr-detail__evidence-column">
            <div className="service-pr-detail__subheading"><h3>เอกสารประกอบ</h3><span>{documents.length} ไฟล์</span></div>
            {documents.length > 0 ? <ul className="service-pr-detail__documents">{documents.map((file) => <li className="service-pr-detail__document-card" key={file.id}><span>{file.label}</span><a href={file.href} target="_blank" rel="noreferrer" aria-label={`${file.label}: ${file.fileName} (เปิดแท็บใหม่)`}>{file.fileName}</a></li>)}</ul> : <div className="service-pr-detail__empty"><strong>ยังไม่มีเอกสาร</strong><p>เอกสารจะแสดงเมื่อมีการแนบในขั้นตอนที่เกี่ยวข้อง</p></div>}
          </div>
          <div className="service-pr-detail__evidence-column service-pr-detail__committees">
            <div className="service-pr-detail__subheading"><h3>คณะกรรมการ</h3><span>{request.committees.length} คน</span></div>
            <div className="service-pr-detail__committee-groups">{committeeGroups.map((group) => <section className="service-pr-detail__committee-group service-pr-detail__committee-card" key={group.kind}><h4>{group.title}</h4>{group.members.length > 0 ? <ol>{group.members.map((member) => <li key={member.id}><span>{member.name}</span><small>คนที่ {member.seat} · {member.position ?? 'ไม่ระบุตำแหน่ง'}</small></li>)}</ol> : <p className="service-pr-detail__empty-copy">ยังไม่มีรายชื่อกรรมการ</p>}</section>)}</div>
          </div>
        </div>
      </section>

      <div className="service-pr-detail__controls">
        <ServicePurchaseRequestControls request={request} canOperate={canOperateServicePurchaseRequest(actor)} canEdit={canEdit} canClose={canCloseServicePurchaseRequest(actor, request.requesterId, responsibleIds) && plan?.status !== 'closed'} canCancel={canCancelServicePurchaseRequestPo(actor, request.requesterId) && plan?.status !== 'closed'} />
      </div>
    </div>
  )
}
