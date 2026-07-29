import { formatQuantity } from '@/lib/inventory/presenter'
import { SIGNATURE_BLOCKS, toThaiPrintDate } from '@/lib/requisitions/print'
import type { RequisitionRecord } from '@/lib/requisitions/types'

/**
 * The paper form. Semantic markup only — layout and pagination live in the
 * print rules in globals.css so the same document renders on screen and on A4.
 */
export function RequisitionPrint({ requisition }: { requisition: RequisitionRecord }) {
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
            <th scope="col">รหัส LS</th>
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
                <td>{item.name}</td>
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
                      <td rowSpan={item.allocations.length}>{item.name}</td>
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
        {SIGNATURE_BLOCKS.map((block) => (
          <div key={block.role}>
            <p className="print-signature__line">ลงชื่อ ..................................................</p>
            <p className="print-signature__role">({block.role})</p>
            <p className="print-signature__hint">{block.hint}</p>
            <p className="print-signature__date">วันที่ ......../......../..........</p>
          </div>
        ))}
      </div>
    </article>
  )
}
