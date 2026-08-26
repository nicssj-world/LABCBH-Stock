import { formatQuantity } from '@/lib/inventory/presenter'
import { toThaiPrintDate } from '@/lib/requisitions/print'
import {
  PURCHASE_METHOD_LABELS,
  PURCHASE_PURPOSE_LABELS,
  PURCHASE_REQUEST_STATUS_LABELS,
  formatBaht,
} from '@/lib/pr/presenter'
import { purchaseMethodPurpose } from '@/lib/pr/schema'
import type { PurchaseRequestRecord } from '@/lib/pr/types'

interface PrintFact {
  label: string
  value: string
}

function asPrintValue(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function methodReferenceFacts(request: PurchaseRequestRecord): PrintFact[] {
  const facts: PrintFact[] = [
    {
      label: 'จุดประสงค์',
      value: PURCHASE_PURPOSE_LABELS[purchaseMethodPurpose(request.purchaseMethod)],
    },
    { label: 'วิธีจัดซื้อ', value: PURCHASE_METHOD_LABELS[request.purchaseMethod] },
  ]
  const details = request.methodDetails
  const add = (label: string, value: unknown, date = false) => {
    const parsed = asPrintValue(value)
    if (!parsed) return
    facts.push({ label, value: date ? toThaiPrintDate(parsed) : parsed })
  }

  switch (request.purchaseMethod) {
    case 'annual_plan':
      add('ปีงบประมาณของแผน', details.fiscalYear)
      add('ลำดับในแผนจัดซื้อ', details.planSequence)
      break
    case 'contract':
      add('สัญญาเลขที่ระบบ', details.contractId)
      add('ครั้งที่ซื้อ', details.purchaseSequence)
      break
    case 'awaiting_contract':
      add('สัญญาที่รอดำเนินการ (ระบบ)', details.contractId)
      break
    case 'specific_contract':
    case 'e_bidding':
    case 'equipment_lease': {
      const draft = asRecord(details.contractDraft)
      if (!draft) break
      add('ชื่อสัญญา', draft.displayName)
      add('ปีงบประมาณ', draft.fiscalYear)
      add('คู่สัญญา', draft.vendor)
      add('วันที่ส่งเจ้าหน้าที่คลัง', draft.sentToStockOfficerDate, true)
      break
    }
    case 'off_plan':
      break
  }

  return facts
}

function printTotal(request: PurchaseRequestRecord): { label: string; value: string } {
  if (request.purchaseMethod === 'equipment_lease') {
    const draft = asRecord(request.methodDetails.contractDraft)
    const ceiling = draft ? asPrintValue(draft.total) : null
    const ceilingNumber = ceiling ? Number(ceiling) : NaN
    return {
      label: 'วงเงินเช่าโดยประมาณ',
      value: Number.isFinite(ceilingNumber) ? formatBaht(ceilingNumber) : 'ยังไม่ระบุ',
    }
  }

  return { label: 'ยอดรวมทั้งสิ้น', value: formatBaht(request.total) }
}

function printDateOrPlaceholder(value: string | null): string {
  return value ? toThaiPrintDate(value.slice(0, 10)) : '......../......../..........'
}

/** A4 purchase-request document, intentionally sharing the requisition form's paper grammar. */
export function PurchaseRequestPrint({ request }: { request: PurchaseRequestRecord }) {
  const facts = methodReferenceFacts(request)
  const total = printTotal(request)
  const requesterName = request.requesterName?.trim() || request.headName.trim() || 'ไม่ระบุชื่อผู้ขอ'
  const acknowledgedName = request.acknowledgedByName?.trim() || null

  return (
    <article className="print-sheet pr-print-sheet">
      <header className="print-header pr-print-header">
        <p className="print-header__hospital">โรงพยาบาลชลบุรี</p>
        <p className="print-header__department">กลุ่มงานเทคนิคการแพทย์</p>
        <h1>ใบขอซื้อ (PR)</h1>
        <p className="pr-print-header__subtitle">น้ำยาและวัสดุวิทยาศาสตร์</p>
      </header>

      <dl className="print-meta pr-print-meta">
        <div>
          <dt>เลขที่ PR</dt>
          <dd className="identifier">{request.documentNumber}</dd>
        </div>
        <div>
          <dt>วันที่ขอซื้อ</dt>
          <dd>{toThaiPrintDate(request.requestedDate)}</dd>
        </div>
        <div>
          <dt>หน่วยงานผู้ขอ</dt>
          <dd>{request.department}</dd>
        </div>
        <div>
          <dt>ผู้ขอ</dt>
          <dd>{requesterName}</dd>
        </div>
        <div>
          <dt>ผู้จัดทำ</dt>
          <dd>{request.headName}</dd>
        </div>
        <div>
          <dt>สถานะ</dt>
          <dd>{PURCHASE_REQUEST_STATUS_LABELS[request.status]}</dd>
        </div>
        <div>
          <dt>เลขที่ PR จาก E-Phis</dt>
          <dd className="identifier">{request.ephisPrNumber ?? '—'}</dd>
        </div>
        <div>
          <dt>เลขที่ใบสั่งซื้อ (PO)</dt>
          <dd className="identifier">{request.poNumber ?? '—'}</dd>
        </div>
      </dl>

      <section className="pr-print-reference" aria-labelledby="pr-print-reference-title">
        <div className="pr-print-reference__heading">
          <h2 id="pr-print-reference-title">รายละเอียดการจัดซื้อ</h2>
          <span>ข้อมูลอ้างอิงของใบ PR</span>
        </div>
        <dl>
          {facts.map((fact) => (
            <div key={fact.label}>
              <dt>{fact.label}</dt>
              <dd className={fact.label.includes('เลขที่') || fact.label.includes('ครั้งที่') || fact.label.includes('ปีงบประมาณ') ? 'identifier' : undefined}>
                {fact.value}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="pr-print-table-wrap">
        <table className="print-table pr-print-table">
          <caption className="visually-hidden">รายการในใบขอซื้อ {request.documentNumber}</caption>
          <colgroup>
            <col className="pr-print-table__col--number" />
            <col className="pr-print-table__col--code" />
            <col className="pr-print-table__col--item" />
            <col className="pr-print-table__col--usage" />
            <col className="pr-print-table__col--quantity" />
            <col className="pr-print-table__col--unit" />
            <col className="pr-print-table__col--price" />
            <col className="pr-print-table__col--total" />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">ลำดับ</th>
              <th scope="col">รหัสพัสดุ (LS)</th>
              <th scope="col">รายการ</th>
              <th scope="col">อัตราใช้<br />เฉลี่ย/เดือน</th>
              <th scope="col">จำนวนที่ขอ</th>
              <th scope="col">หน่วย</th>
              <th scope="col">ราคาต่อหน่วย</th>
              <th scope="col">จำนวนเงิน</th>
            </tr>
          </thead>
          <tbody>
            {request.items.length === 0 ? (
              <tr>
                <td className="pr-print-table__empty" colSpan={8}>ใบ PR นี้ไม่มีรายการวัสดุ — เป็นรายการเช่าเครื่อง</td>
              </tr>
            ) : (
              request.items.map((item) => (
                <tr key={item.id}>
                  <td>{item.lineNumber}</td>
                  <td className="identifier">{item.lsCode}</td>
                  <td className="pr-print-table__item">
                    <strong>{item.name}</strong>
                    {item.contractDisplayName && <small>อ้างอิงสัญญา: {item.contractDisplayName}</small>}
                  </td>
                  <td className="numeric-cell identifier">{formatQuantity(item.monthlyUsageSnapshot)}</td>
                  <td className="numeric-cell identifier">{formatQuantity(item.requestedQuantity)}</td>
                  <td>{item.unit}</td>
                  <td className="numeric-cell identifier">{formatBaht(item.unitPrice)}</td>
                  <td className="numeric-cell identifier"><strong>{formatBaht(item.lineTotal)}</strong></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="pr-print-summary">
        <p>{request.items.length > 0 ? `รวม ${request.items.length} รายการ` : 'ไม่มีรายการวัสดุในใบนี้'}</p>
        <div>
          <span>{total.label}</span>
          <strong>{total.value}</strong>
        </div>
      </div>

      {request.note && <p className="print-note"><strong>หมายเหตุ:</strong> {request.note}</p>}

      <div className="print-signatures pr-print-signatures">
        <div className="print-signature">
          <div className="print-signature__mark">
            <p className="print-signature__line">ลงชื่อ ..................................................</p>
          </div>
          <p className="print-signature__role">({requesterName})</p>
          <p className="print-signature__hint">ผู้จัดทำใบขอซื้อ</p>
          <p className="print-signature__date">วันที่ {printDateOrPlaceholder(request.requestedDate)}</p>
        </div>
        <div className="print-signature">
          <div className="print-signature__mark">
            {acknowledgedName ? (
              <p className="print-signature__name">{acknowledgedName}</p>
            ) : (
              <p className="print-signature__line">ลงชื่อ ..................................................</p>
            )}
          </div>
          <p className="print-signature__role">(เจ้าหน้าที่คลัง)</p>
          <p className="print-signature__hint">{acknowledgedName ? 'ผู้ยืนยันใบ PR' : 'ผู้ตรวจสอบและยืนยันใบ PR'}</p>
          <p className="print-signature__date">วันที่ {printDateOrPlaceholder(request.acknowledgedAt)}</p>
        </div>
      </div>
    </article>
  )
}
