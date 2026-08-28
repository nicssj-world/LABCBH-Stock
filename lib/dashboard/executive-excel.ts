import ExcelJS from 'exceljs'
import { formatThaiDate } from '@/lib/inventory/presenter'
import { contractStatusLabel } from './executive'
import type { ExecutiveOverview } from './executive-types'

const MONEY_FORMAT = '#,##0.00'
const INTEGER_FORMAT = '#,##0'
const HEADER_COLOR = 'FF174A87'
const BORDER_COLOR = 'FFDCE4ED'

function applySheetStyle(sheet: ExcelJS.Worksheet, filter = true) {
  const header = sheet.getRow(1)
  header.height = 24
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_COLOR } }
  header.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
  if (filter && sheet.rowCount > 1) {
    sheet.autoFilter = {
      from: 'A1',
      to: { row: sheet.rowCount, column: sheet.columnCount },
    }
  }
  sheet.views = [{ state: 'frozen', ySplit: 1 }]
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return
    row.alignment = { vertical: 'top', wrapText: true }
    row.eachCell((cell) => {
      cell.border = {
        bottom: { style: 'thin', color: { argb: BORDER_COLOR } },
      }
    })
  })
}

function setMoneyFormat(sheet: ExcelJS.Worksheet, columns: string[]) {
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return
    columns.forEach((column) => { row.getCell(column).numFmt = MONEY_FORMAT })
  })
}

function setIntegerFormat(sheet: ExcelJS.Worksheet, columns: string[]) {
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return
    columns.forEach((column) => { row.getCell(column).numFmt = INTEGER_FORMAT })
  })
}

export async function generateExecutiveWorkbook(data: ExecutiveOverview): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'LABCBH Stock'
  workbook.created = new Date()
  workbook.modified = new Date()

  const summary = workbook.addWorksheet('Summary')
  summary.columns = [
    { header: 'รายการ', key: 'label', width: 32 },
    { header: 'ข้อมูล', key: 'value', width: 34 },
    { header: 'หมายเหตุ', key: 'note', width: 68 },
  ]
  summary.addRows([
    { label: 'รายงาน', value: 'Dashboard ผู้บริหาร', note: 'รายงานสรุปประจำปีงบประมาณ' },
    { label: 'ปีงบประมาณ', value: data.fiscalYear, note: `${formatThaiDate(data.fiscalYearRange.start)} – ${formatThaiDate(data.fiscalYearRange.end)}` },
    { label: 'ข้อมูล ณ วันที่', value: formatThaiDate(data.generatedOn), note: 'เวลาที่สร้างไฟล์รายงาน' },
    { label: 'ยอดรวมตามหมวด', value: data.spend.total, note: 'งานซื้อ + งานจ้างทั้งหมด' },
    { label: 'งานซื้อ', value: data.spend.purchase, note: 'ยอดจากรายการรับเข้าคลังที่บันทึกเรียบร้อยแล้ว · ไม่รวมเช่าเครื่อง' },
    { label: 'งานจ้างทั้งหมด', value: data.spend.hiringTotal, note: `งานจ้างระบบ ${data.spend.service.toLocaleString('th-TH')} บาท + เช่าเครื่อง ${data.spend.lease.toLocaleString('th-TH')} บาท` },
    { label: 'เช่าเครื่อง', value: data.spend.lease, note: 'รายละเอียดภายในงานจ้าง ไม่บวกซ้ำในยอดรวม' },
    { label: 'ยอดรวมปีก่อน', value: data.priorYearSpend.total, note: 'ใช้สำหรับเปรียบเทียบแนวโน้ม' },
    { label: 'เปลี่ยนแปลงจากปีก่อน', value: data.comparison.changePercent === null ? 'ไม่มีฐานเปรียบเทียบ' : `${data.comparison.changePercent.toFixed(1)}%`, note: `เปลี่ยนแปลง ${data.comparison.changeAmount.toLocaleString('th-TH')} บาท` },
    { label: 'ฐานข้อมูล', value: 'รับเข้าคลัง + ค่าใช้จ่ายที่บันทึก', note: 'ตัวเลขงานซื้อไม่ใช่ยอดจ่ายเงินจริงทางการเงิน' },
  ])
  applySheetStyle(summary, false)
  setMoneyFormat(summary, ['B'])
  summary.getColumn('B').numFmt = '@'
  ;[4, 5, 6, 7, 8].forEach((rowNumber) => { summary.getCell(`B${rowNumber}`).numFmt = MONEY_FORMAT })
  summary.getCell('B9').numFmt = '@'

  const monthly = workbook.addWorksheet('Monthly Spend')
  monthly.columns = [
    { header: 'เดือน', key: 'month', width: 14 },
    { header: 'งานซื้อ', key: 'purchase', width: 20 },
    { header: 'งานจ้างระบบ', key: 'service', width: 20 },
    { header: 'เช่าเครื่อง', key: 'lease', width: 20 },
    { header: 'งานจ้างทั้งหมด', key: 'hiringTotal', width: 20 },
    { header: 'ยอดรวม', key: 'total', width: 20 },
  ]
  monthly.addRows(data.monthly.map((row) => ({
    month: `${row.label} (${row.month})`,
    purchase: row.purchase,
    service: row.service,
    lease: row.lease,
    hiringTotal: row.hiringTotal,
    total: row.total,
  })))
  applySheetStyle(monthly)
  setMoneyFormat(monthly, ['B', 'C', 'D', 'E', 'F'])

  const categories = workbook.addWorksheet('Procurement Categories')
  categories.columns = [
    { header: 'หมวด', key: 'label', width: 28 },
    { header: 'จำนวนเงิน', key: 'amount', width: 22 },
    { header: 'สัดส่วน (%)', key: 'share', width: 16 },
    { header: 'จำนวนรายการ/สัญญา', key: 'count', width: 22 },
    { header: 'หมายเหตุ', key: 'note', width: 64 },
  ]
  categories.addRows(data.categories.map((row) => ({
    label: row.label,
    amount: row.amount,
    share: row.share,
    count: row.count,
    note: row.note,
  })))
  applySheetStyle(categories)
  setMoneyFormat(categories, ['B'])
  setIntegerFormat(categories, ['D'])
  categories.eachRow((row, rowNumber) => { if (rowNumber > 1) row.getCell('C').numFmt = '0.0' })

  const duration = workbook.addWorksheet('Equipment Lease Duration')
  duration.columns = [
    { header: 'ระยะเวลา', key: 'duration', width: 18 },
    { header: 'จำนวนสัญญา', key: 'count', width: 18 },
    { header: 'ค่าใช้จ่าย FY', key: 'expense', width: 22 },
    { header: 'สัดส่วนค่าเช่า (%)', key: 'share', width: 22 },
    { header: 'หมายเหตุ', key: 'note', width: 58 },
  ]
  duration.addRows(data.leaseDurationSummary.map((row) => ({
    duration: row.label,
    count: row.contractCount,
    expense: row.expense,
    share: row.share,
    note: row.durationYears === null ? 'ข้อมูลสัญญาที่ไม่ระบุจำนวนปี' : 'จำนวนสัญญาและค่าใช้จ่ายของสัญญาที่เกี่ยวข้องกับปีงบประมาณ',
  })))
  applySheetStyle(duration)
  setMoneyFormat(duration, ['C'])
  setIntegerFormat(duration, ['B'])
  duration.eachRow((row, rowNumber) => { if (rowNumber > 1) row.getCell('D').numFmt = '0.0' })

  const leaseContracts = workbook.addWorksheet('Equipment Lease Contracts')
  leaseContracts.columns = [
    { header: 'ชื่อสัญญา', key: 'name', width: 40 },
    { header: 'เลขที่สัญญา', key: 'number', width: 20 },
    { header: 'ระยะเวลา', key: 'duration', width: 14 },
    { header: 'วันที่เริ่ม', key: 'startDate', width: 18 },
    { header: 'วันที่สิ้นสุด', key: 'endDate', width: 18 },
    { header: 'ค่าใช้จ่าย FY', key: 'expense', width: 22 },
    { header: 'สถานะ', key: 'status', width: 24 },
    { header: 'หน่วยงาน', key: 'department', width: 28 },
    { header: 'Contract ID', key: 'id', width: 14 },
  ]
  leaseContracts.addRows(data.leaseContracts.map((contract) => ({
    name: contract.contractName,
    number: contract.contractNumber || 'ไม่ระบุ',
    duration: contract.durationYears ? `${contract.durationYears} ปี` : 'ไม่ระบุ',
    startDate: formatThaiDate(contract.startDate),
    endDate: formatThaiDate(contract.endDate),
    expense: contract.fiscalYearExpense,
    status: contractStatusLabel(contract.status),
    department: contract.department || 'ไม่ระบุ',
    id: contract.contractId,
  })))
  applySheetStyle(leaseContracts)
  setMoneyFormat(leaseContracts, ['F'])
  setIntegerFormat(leaseContracts, ['I'])

  const alerts = workbook.addWorksheet('Alerts & Data Quality')
  alerts.columns = [
    { header: 'ประเภท', key: 'type', width: 24 },
    { header: 'รายการ', key: 'label', width: 40 },
    { header: 'รายละเอียด', key: 'detail', width: 68 },
    { header: 'จำนวน', key: 'count', width: 16 },
    { header: 'มูลค่า', key: 'amount', width: 20 },
  ]
  alerts.addRows(data.alerts.map((alert) => ({ type: 'รายการต้องติดตาม', label: alert.label, detail: alert.detail, count: '', amount: '' })))
  alerts.addRows([
    { type: 'Data Quality', label: 'รับเข้าไม่สามารถจัดหมวด', detail: 'ไม่มี PR/ข้อมูลอ้างอิงที่จำเป็น หรือเชื่อมกับเช่าเครื่อง', count: data.dataQuality.unclassifiedReceiptCount, amount: data.dataQuality.unclassifiedReceiptAmount },
    { type: 'Data Quality', label: 'รับเข้าไม่มีราคา', detail: 'ไม่สามารถคำนวณมูลค่ารับเข้าจากราคาของ PR', count: data.dataQuality.missingReceiptPriceCount, amount: data.dataQuality.missingReceiptPriceAmount },
    { type: 'Data Quality', label: 'ค่าเช่าไม่มีเดือนอ้างอิง', detail: 'ไม่ถูกจัดเข้าปีงบประมาณ', count: data.dataQuality.missingUsageMonthCount, amount: data.dataQuality.missingUsageMonthAmount },
    { type: 'Data Quality', label: 'สัญญาเช่าไม่ระบุระยะเวลา', detail: 'ไม่สามารถจัดกลุ่ม 1 ปี/3 ปีได้', count: data.dataQuality.missingLeaseDurationCount, amount: '' },
    { type: 'Data Quality', label: 'สัญญาเช่าไม่มีวันเริ่มหรือสิ้นสุด', detail: 'ตรวจสอบข้อมูลในทะเบียนสัญญา', count: data.dataQuality.missingLeaseDateCount, amount: '' },
  ])
  applySheetStyle(alerts)
  setIntegerFormat(alerts, ['D'])
  setMoneyFormat(alerts, ['E'])

  const sources = workbook.addWorksheet('Source Details')
  sources.columns = [
    { header: 'แหล่งข้อมูล', key: 'source', width: 18 },
    { header: 'วันที่', key: 'date', width: 18 },
    { header: 'รายการ/สัญญา', key: 'name', width: 42 },
    { header: 'จำนวน', key: 'quantity', width: 14 },
    { header: 'ราคาต่อหน่วย', key: 'unitPrice', width: 18 },
    { header: 'มูลค่า', key: 'amount', width: 20 },
    { header: 'อ้างอิง', key: 'reference', width: 36 },
    { header: 'หน่วยงาน', key: 'department', width: 28 },
  ]
  sources.addRows([
    ...data.purchaseSourceRows.map((row) => ({
      source: 'งานซื้อ', date: formatThaiDate(row.receivedDate), name: row.itemName || 'ไม่ระบุรายการ', quantity: row.quantity, unitPrice: row.unitPrice, amount: row.amount, reference: row.contractName || row.purchaseRequestId || row.receiptId, department: '',
    })),
    ...data.serviceSourceRows.map((row) => ({
      source: 'งานจ้างระบบ', date: formatThaiDate(row.eventDate), name: row.planName, quantity: '', unitPrice: '', amount: row.amount, reference: row.sourceReference || row.purchaseRequestId || row.planId, department: row.department,
    })),
    ...data.leaseSourceRows.map((row) => ({
      source: 'เช่าเครื่อง', date: formatThaiDate(row.usageMonth), name: row.contractName, quantity: '', unitPrice: '', amount: row.amount, reference: `Contract ${row.contractId}`, department: '',
    })),
  ])
  applySheetStyle(sources)
  setMoneyFormat(sources, ['E', 'F'])

  return new Uint8Array(await workbook.xlsx.writeBuffer())
}
