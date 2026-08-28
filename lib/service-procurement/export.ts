import 'server-only'
import ExcelJS from 'exceljs'
import { getServicePlan } from './queries'
import { serviceRequestDisplayStatus, serviceRequestDisplayStatusLabel } from './presenter'

export async function buildServicePlanWorkbook(planId: string): Promise<Uint8Array | null> {
  const result = await getServicePlan(planId)
  if (!result) return null
  const { plan, ledger, requests } = result
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'LABCBH Stock'
  workbook.created = new Date()

  const summary = workbook.addWorksheet('สรุปแผน')
  summary.columns = [
    { header: 'รายการ', key: 'label', width: 30 },
    { header: 'ข้อมูล', key: 'value', width: 28 },
  ]
  summary.addRows([
    { label: 'ชื่อแผน', value: plan.name },
    { label: 'หน่วยงาน', value: plan.department },
    { label: 'ปีงบประมาณ', value: plan.fiscalYear },
    { label: 'ประเภท', value: plan.type },
    { label: 'วงเงิน', value: plan.balance.budget },
    { label: 'ใช้จริง', value: plan.balance.spent },
    { label: 'สำรอง', value: plan.balance.reserved },
    { label: 'คงเหลือ', value: plan.balance.available },
    { label: 'สถานะแผน', value: plan.status },
    { label: 'สภากาชาดไทย', value: plan.isRedCross ? 'ใช่' : 'ไม่ใช่' },
    { label: 'ทำสัญญา', value: plan.requiresContract ? 'ใช่' : 'ไม่ใช่' },
  ])

  const testItems = workbook.addWorksheet('รายการส่งตรวจ')
  testItems.columns = [
    { header: 'ลำดับ', key: 'line', width: 12 },
    { header: 'ชื่อรายการ', key: 'name', width: 44 },
    { header: 'หน่วย', key: 'unit', width: 20 },
  ]
  plan.testItems.forEach((item) => testItems.addRow({ line: item.lineNumber, name: item.name, unit: item.unit }))

  const requestSheet = workbook.addWorksheet('PR PO ที่อ้างแผน')
  requestSheet.columns = [
    { header: 'เลข PR', key: 'pr', width: 24 },
    { header: 'เลข PO', key: 'po', width: 24 },
    { header: 'ช่วงใช้ PO', key: 'range', width: 28 },
    { header: 'วงเงิน', key: 'amount', width: 18 },
    { header: 'สถานะ', key: 'status', width: 24 },
  ]
  requests.forEach((request) => requestSheet.addRow({ pr: request.documentNumber, po: request.poNumber ?? '', range: `${request.usageStartDate} – ${request.usageEndDate}`, amount: request.requestedAmount, status: serviceRequestDisplayStatusLabel(serviceRequestDisplayStatus(request)) }))

  const monthly = workbook.addWorksheet('ยอดรายเดือน')
  monthly.columns = [
    { header: 'เดือน', key: 'month', width: 16 },
    { header: 'ยอดสุทธิรายเดือน', key: 'net', width: 20 },
    { header: 'ยอดใช้/ปรับ', key: 'expense', width: 20 },
    { header: 'ยอดสำรองสุทธิ', key: 'reserved', width: 20 },
    { header: 'จำนวนรายการ', key: 'count', width: 16 },
  ]
  const monthlyRows = new Map<string, { net: number; expense: number; reserved: number; count: number }>()
  ledger.forEach((entry) => {
    const month = entry.eventDate.slice(0, 7)
    const current = monthlyRows.get(month) ?? { net: 0, expense: 0, reserved: 0, count: 0 }
    current.net += entry.amount
    current.count += 1
    if (['expense', 'historical_expense', 'expense_adjustment', 'expense_reversal'].includes(entry.entryKind)) current.expense += entry.amount
    if (entry.entryKind === 'reservation' || entry.entryKind === 'reservation_release') current.reserved += entry.amount
    monthlyRows.set(month, current)
  })
  for (const [month, values] of [...monthlyRows.entries()].sort(([left], [right]) => left.localeCompare(right))) monthly.addRow({ month, ...values })

  const detail = workbook.addWorksheet('Ledger')
  detail.columns = [
    { header: 'Ledger ID', key: 'id', width: 38 },
    { header: 'วันที่', key: 'date', width: 16 },
    { header: 'ประเภท', key: 'kind', width: 22 },
    { header: 'จำนวนเงิน', key: 'amount', width: 18 },
    { header: 'PR', key: 'request', width: 38 },
    { header: 'ผู้บันทึก', key: 'actor', width: 24 },
    { header: 'เหตุผล', key: 'reason', width: 42 },
    { header: 'สร้างเมื่อ', key: 'created', width: 28 },
  ]
  ledger.forEach((entry) => detail.addRow({ id: entry.id, date: entry.eventDate, kind: entry.entryKind, amount: entry.amount, request: entry.sourceReference ?? entry.purchaseRequestId ?? '', actor: entry.actorName ?? '', reason: entry.reason, created: entry.createdAt }))

  for (const sheet of [summary, testItems, requestSheet, monthly, detail]) {
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } }
    sheet.views = [{ state: 'frozen', ySplit: 1 }]
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber > 1) row.alignment = { vertical: 'top', wrapText: true }
    })
  }
  const buffer = await workbook.xlsx.writeBuffer()
  return new Uint8Array(buffer)
}
