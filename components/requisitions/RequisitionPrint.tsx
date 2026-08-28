import { formatQuantity } from '@/lib/inventory/presenter'
import { SIGNATURE_BLOCKS, toThaiPrintDate } from '@/lib/requisitions/print'
import type { RequisitionRecord } from '@/lib/requisitions/types'

/**
 * The paper form. Semantic markup only — layout and pagination live in the
 * print rules in globals.css so the same document renders on screen and on A4.
 */
export function RequisitionPrint({
  requisition,
  fulfilledBySignature = null,
}: {
  requisition: RequisitionRecord
  fulfilledBySignature?: string | null
}) {
  return (
    <article className="print-sheet">
      <header className="print-header">
        <p className="print-header__hospital">โรงพยาบาลชลบุรี</p>
        <p className="print-header__department">กลุ่มงานเทคนิคการแพทย์</p>
        <h1>ใบเบิกน้ำยาและวัสดุวิทยาศาสตร์</h1>
      </header>

      <dl className="print-meta">
        <div>
          <dt>เลขที่</dt>
          <dd>{requisition.documentNumber}</dd>
        </div>
        <div>
          <dt>วันที่</dt>
          <dd>{toThaiPrintDate(requisition.desiredDate)}</dd>
        </div>
        <div>
          <dt>หน่วยงาน</dt>
          <dd>{requisition.department}</dd>
        </div>
        <div>
          <dt>ผู้ขอเบิก</dt>
          <dd>{requisition.requesterName}</dd>
        </div>
        <div>
          <dt>วันที่จ่าย</dt>
          <dd>{toThaiPrintDate(requisition.fulfilledAt?.slice(0, 10) ?? null)}</dd>
        </div>
      </dl>

      <table className="print-table">
        <thead>
          <tr>
            <th scope="col">ลำดับ</th>
            <th scope="col">รหัสพัสดุ</th>
            <th scope="col">รายการ</th>
            <th scope="col">เลขที่ล็อต</th>
            <th scope="col">วันหมดอายุ</th>
            <th scope="col">จำนวนที่ขอ</th>
            <th scope="col">จำนวนที่จ่าย</th>
          </tr>
        </thead>
        <tbody>
          {requisition.items.map((item) =>
            item.allocations.length === 0 ? (
              <tr key={item.id}>
                <td>{item.lineNumber}</td>
                <td>{item.lsCode}</td>
                <td>
                  {item.name}
                  {item.shortIssueReason && (
                    <small className="print-line-reason">เหตุผลจ่ายไม่ครบ: {item.shortIssueReason}</small>
                  )}
                </td>
                <td>—</td>
                <td>—</td>
                <td>{formatQuantity(item.requestedQuantity, item.unit)}</td>
                <td>—</td>
              </tr>
            ) : (
              item.allocations.map((allocation, index) => (
                <tr key={allocation.id}>
                  {index === 0 && (
                    <>
                      <td rowSpan={item.allocations.length}>{item.lineNumber}</td>
                      <td rowSpan={item.allocations.length}>{item.lsCode}</td>
                      <td rowSpan={item.allocations.length}>
                        {item.name}
                        {item.shortIssueReason && (
                          <small className="print-line-reason">เหตุผลจ่ายไม่ครบ: {item.shortIssueReason}</small>
                        )}
                      </td>
                    </>
                  )}
                  <td>{allocation.lotNumber}</td>
                  <td>{toThaiPrintDate(allocation.expiryDate)}</td>
                  {index === 0 && (
                    <td rowSpan={item.allocations.length}>
                      {formatQuantity(item.requestedQuantity, item.unit)}
                    </td>
                  )}
                  <td>{formatQuantity(allocation.quantity, item.unit)}</td>
                </tr>
              ))
            ),
          )}
        </tbody>
      </table>

      {requisition.note && <p className="print-note">หมายเหตุ: {requisition.note}</p>}

      <div className="print-signatures">
        {SIGNATURE_BLOCKS.map((block) => {
          // The receiving head's block already has a digital signature —
          // print what was actually captured instead of a blank line to sign.
          const isReceiverBlock = block.role === 'หัวหน้าหน่วยงานผู้รับ'
          const isIssuerBlock = block.role === 'ผู้จ่ายของ'
          if (isReceiverBlock && requisition.signature) {
            return (
              <div key={block.role} className="print-signature">
                <div className="print-signature__mark">
                  {/* eslint-disable-next-line @next/next/no-img-element -- a data URI signature has no Next.js Image loader to optimize through */}
                  <img className="print-signature__image" src={requisition.signature} alt="ลายเซ็นต์ผู้รับของ" />
                </div>
                <p className="print-signature__role">{requisition.receivedByName}</p>
                <p className="print-signature__hint">({block.hint})</p>
                <p className="print-signature__date">วันที่ {toThaiPrintDate(requisition.signedAt?.slice(0, 10) ?? null)}</p>
              </div>
            )
          }

          // The stock officer is identified by the fulfilment snapshot. Their
          // reusable signature is loaded from the private Portal bucket on the
          // server, while the name/date remain tied to this requisition.
          if (isIssuerBlock && requisition.fulfilledByName) {
            return (
              <div key={block.role} className="print-signature">
                <div className="print-signature__mark">
                  {fulfilledBySignature ? (
                    // eslint-disable-next-line @next/next/no-img-element -- a server-rendered Portal signature is an in-memory data URI
                    <img className="print-signature__image" src={fulfilledBySignature} alt="ลายเซ็นต์เจ้าหน้าที่คลังผู้จ่ายของ" />
                  ) : (
                    <span className="print-signature__missing">ไม่พบลายเซ็นต์ใน Portal</span>
                  )}
                </div>
                <p className="print-signature__role">{requisition.fulfilledByName}</p>
                <p className="print-signature__hint">({block.hint})</p>
                <p className="print-signature__date">วันที่ {toThaiPrintDate(requisition.fulfilledAt?.slice(0, 10) ?? null)}</p>
              </div>
            )
          }

          return (
            <div key={block.role} className="print-signature">
              <div className="print-signature__mark">
                <p className="print-signature__line">ลงชื่อ ..................................................</p>
              </div>
              <p className="print-signature__hint">({block.hint})</p>
              <p className="print-signature__date">วันที่ ......../......../..........</p>
            </div>
          )
        })}
      </div>
    </article>
  )
}
