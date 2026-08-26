import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { InventoryItemActiveControl } from '@/components/inventory/InventoryItemActiveControl'
import { LayersIcon, PriceTagIcon, StockBoxIcon, ThresholdIcon, TrendIcon } from '@/components/inventory/InventoryDetailIcons'
import { LotTable } from '@/components/inventory/LotTable'
import { StockAdjustmentDialog } from '@/components/inventory/StockAdjustmentDialog'
import { ListPagination } from '@/components/ui/ListPagination'
import { StatusChip } from '@/components/ui/StatusChip'
import { StickyScroll } from '@/components/ui/StickyScroll'
import { canOperateStock } from '@/lib/auth/access'
import { requireActor } from '@/lib/auth/actor'
import {
  INACTIVE_STATUS_TONE,
  MOVEMENT_TYPE_LABELS,
  STOCK_LEVEL_LABELS,
  STOCK_LEVEL_TONES,
  formatBaht,
  formatQuantity,
  formatThaiDate,
} from '@/lib/inventory/presenter'
import {
  INVENTORY_MOVEMENT_PAGE_SIZE,
  INVENTORY_MOVEMENT_PREVIEW_SIZE,
  bangkokToday,
  completedMonthKeys,
  getInventoryItem,
} from '@/lib/inventory/queries'
import { parsePage } from '@/lib/pagination'

interface InventoryDetailPageProps {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const monthLabel = (isoMonth: string) => {
  const [year, month] = isoMonth.split('-').map(Number)
  return new Intl.DateTimeFormat('th-TH-u-ca-buddhist', { month: 'short', year: 'numeric' }).format(
    new Date(Date.UTC(year, month - 1, 1)),
  )
}

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)

export default async function InventoryDetailPage({ params, searchParams }: InventoryDetailPageProps) {
  const { id } = await params
  if (!UUID_PATTERN.test(id)) notFound()

  const query = await searchParams
  const expandedLedger = first(query.ledger) === 'expanded'
  const requestedLedgerPage = parsePage(first(query.ledgerPage))

  const actor = await requireActor()
  const canEdit = canOperateStock(actor)

  const item = await getInventoryItem(id, {
    movementPage: expandedLedger ? requestedLedgerPage : 1,
    movementPageSize: expandedLedger ? INVENTORY_MOVEMENT_PAGE_SIZE : INVENTORY_MOVEMENT_PREVIEW_SIZE,
  })
  if (!item) notFound()
  if (expandedLedger && item.movementPagination.currentPage !== requestedLedgerPage) {
    redirect(`/inventory/${id}?ledger=expanded&ledgerPage=${item.movementPagination.currentPage}`)
  }

  const monthKeys = completedMonthKeys(bangkokToday())
  const usableLots = item.lots.filter((lot) => lot.isActive && lot.expiryStatus !== 'expired' && lot.balance > 0)

  return (
    <div className="route-stack">
      <header className="page-heading page-heading--actions inventory-detail__heading">
        <div>
          <Link className="back-link" href="/inventory">← คลังน้ำยา</Link>
          <p className="inventory-detail__code">
            <StatusChip tone="info">{item.lsCode}</StatusChip>
          </p>
          <h1>{item.name}</h1>
          <p>{item.responsibleDepartment ?? 'ไม่ระบุหน่วยงานที่รับผิดชอบ'}</p>
          <div className="inventory-detail__note" role="note">
            <strong>หมายเหตุ</strong>
            <span>{item.note?.trim() || 'ไม่มีหมายเหตุ'}</span>
          </div>
        </div>
        <div className="page-heading__cluster">
          {!item.isActive ? (
            <StatusChip tone={INACTIVE_STATUS_TONE}>ปิดใช้งานแล้ว</StatusChip>
          ) : (
            <StatusChip tone={STOCK_LEVEL_TONES[item.stockLevel]}>
              {STOCK_LEVEL_LABELS[item.stockLevel]}
            </StatusChip>
          )}
          {canEdit && (
            <>
              <StockAdjustmentDialog
                itemId={item.id}
                itemName={item.name}
                unit={item.baseUnit}
                lots={item.lots}
              />
              <Link className="lab-link-button lab-link-button--secondary" href={`/inventory/${item.id}/edit`}>
                แก้ไขข้อมูล
              </Link>
              <InventoryItemActiveControl itemId={item.id} isActive={item.isActive} />
            </>
          )}
        </div>
      </header>

      <section className="executive-strip executive-strip--even-5" aria-label="ยอดคงเหลือ จุดสั่งซื้อ และราคาต่อหน่วย">
        <div className={`executive-strip__card${item.stockLevel !== 'healthy' ? ' executive-strip__cell--risk' : ''}`}>
          <div className="executive-strip__head">
            <span>คงเหลือทั้งหมด</span>
            <span className="executive-strip__icon" aria-hidden="true"><StockBoxIcon /></span>
          </div>
          <strong>{formatQuantity(item.onHand, item.baseUnit)}</strong>
          <small>รวมทุกล็อตจากบัญชีเคลื่อนไหว</small>
        </div>
        <div className="executive-strip__card">
          <div className="executive-strip__head">
            <span>จุดสั่งซื้อ</span>
            <span className="executive-strip__icon" aria-hidden="true"><ThresholdIcon /></span>
          </div>
          <strong>{formatQuantity(item.minimumStock, item.baseUnit)}</strong>
          <small>ถึงจุดนี้หรือต่ำกว่า ควรทำ PR</small>
        </div>
        <div className="executive-strip__card">
          <div className="executive-strip__head">
            <span>ล็อตที่ใช้งานได้</span>
            <span className="executive-strip__icon" aria-hidden="true"><LayersIcon /></span>
          </div>
          <strong>{usableLots.length.toLocaleString('th-TH')}</strong>
          <small>จากทั้งหมด {item.lots.length.toLocaleString('th-TH')} ล็อต</small>
        </div>
        <div className="executive-strip__card">
          <div className="executive-strip__head">
            <span>เบิกเฉลี่ยต่อเดือน</span>
            <span className="executive-strip__icon" aria-hidden="true"><TrendIcon /></span>
          </div>
          <strong>
            {formatQuantity(
              item.monthlyIssues.reduce((sum, value) => sum + value, 0) /
                Math.max(item.monthlyIssues.length, 1),
              item.baseUnit,
            )}
          </strong>
          <small>ค่าเฉลี่ย 3 เดือนที่ผ่านมา</small>
        </div>
        <div className="executive-strip__card">
          <div className="executive-strip__head">
            <span>ราคาต่อหน่วย</span>
            <span className="executive-strip__icon" aria-hidden="true"><PriceTagIcon /></span>
          </div>
          <strong>{formatBaht(item.defaultUnitPrice)}</strong>
          <small>ราคาอ้างอิงล่าสุดที่บันทึกไว้</small>
        </div>
      </section>

      {item.stockLevel !== 'healthy' && (
        <p className="inline-alert" role="status">
          ยอดคงเหลืออยู่ที่หรือต่ำกว่าจุดสั่งซื้อแล้ว ต้องทำ PR เพื่อเติมสต๊อก
        </p>
      )}

      <section className="bench-panel" aria-labelledby="lot-title">
        <div className="bench-panel__header">
          <div>
            <p className="section-kicker">LOTS · FIFO ORDER</p>
            <h2 id="lot-title">ล็อตคงเหลือ</h2>
          </div>
          <p>เรียงตามลำดับที่ควรเบิกก่อน · Lot ปิดใช้งานจะไม่ถูกนำไปเลือกจ่าย</p>
        </div>
        <LotTable lots={item.lots} unit={item.baseUnit} inventoryItemId={item.id} canEdit={canEdit} />
      </section>

      <section className="bench-panel" aria-labelledby="issue-history-title">
        <div className="bench-panel__header">
          <div>
            <p className="section-kicker">ISSUE HISTORY</p>
            <h2 id="issue-history-title">ปริมาณการเบิกรายเดือน</h2>
          </div>
          <p>ใช้คำนวณค่าขั้นต่ำที่ระบบแนะนำ</p>
        </div>
        <dl className="issue-history">
          {monthKeys.map((month, index) => (
            <div key={month}>
              <dt>{monthLabel(month)}</dt>
              <dd className="identifier">{formatQuantity(item.monthlyIssues[index] ?? 0, item.baseUnit)}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="bench-panel" aria-labelledby="movement-title">
        <div className="bench-panel__header">
          <div>
            <p className="section-kicker">LEDGER</p>
            <h2 id="movement-title">ความเคลื่อนไหวล่าสุด</h2>
          </div>
          <div className="inventory-ledger__header-meta">
            <p className="inventory-ledger__summary">
              {expandedLedger
                ? `แสดงครั้งละ ${item.movementPagination.pageSize} รายการ · ทั้งหมด ${item.movementPagination.totalCount} รายการ`
                : `แสดง ${item.recentMovements.length} รายการล่าสุดจากทั้งหมด ${item.movementPagination.totalCount} รายการ`}
            </p>
            <small>บัญชีนี้แก้ไขย้อนหลังไม่ได้ ต้องบันทึกรายการกลับรายการแทน</small>
          </div>
        </div>
        {item.recentMovements.length === 0 ? (
          <p className="empty-state">ยังไม่มีความเคลื่อนไหวของน้ำยารายการนี้</p>
        ) : (
          <StickyScroll className="detail-items-table" ariaLabel="ประวัติการเคลื่อนไหวของน้ำยา เลื่อนในแนวนอนเพื่อดูคอลัมน์เพิ่มเติม">
            <table className="data-table">
              <thead>
                <tr>
                  <th>วันที่</th>
                  <th>ประเภท</th>
                  <th>ล็อต</th>
                  <th className="numeric-cell">จำนวน</th>
                  <th>หมายเหตุ</th>
                </tr>
              </thead>
              <tbody>
                {item.recentMovements.map((movement) => (
                  <tr key={movement.id}>
                    <td>{formatThaiDate(movement.occurredOn)}</td>
                    <td>{MOVEMENT_TYPE_LABELS[movement.movementType]}</td>
                    <td className="identifier">{movement.lotNumber ?? '—'}</td>
                    <td className="numeric-cell identifier">
                      {formatQuantity(movement.quantity, item.baseUnit)}
                    </td>
                    <td>{movement.note ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </StickyScroll>
        )}
        {!expandedLedger && item.movementPagination.totalCount > INVENTORY_MOVEMENT_PREVIEW_SIZE && (
          <div className="inventory-ledger__load-more">
            <p>มีความเคลื่อนไหวเก่ากว่านี้อีก {item.movementPagination.totalCount - item.recentMovements.length} รายการ</p>
            <Link className="lab-link-button lab-link-button--secondary" href={`/inventory/${item.id}?ledger=expanded&ledgerPage=1`}>
              โหลดเพิ่มเติม
            </Link>
          </div>
        )}
        {expandedLedger && (
          <ListPagination
            currentPage={item.movementPagination.currentPage}
            pageCount={item.movementPagination.pageCount}
            totalCount={item.movementPagination.totalCount}
            startIndex={item.movementPagination.startIndex}
            pageSize={item.movementPagination.pageSize}
            itemLabel="รายการ"
            buildHref={(page) => `/inventory/${item.id}?ledger=expanded&ledgerPage=${page}`}
          />
        )}
      </section>
    </div>
  )
}
