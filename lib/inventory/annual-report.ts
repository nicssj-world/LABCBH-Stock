import ExcelJS from 'exceljs'
import { fiscalYearBounds } from '@/lib/annual-plans/fiscal'
import { formatThaiDate } from './presenter'
import { roundQuantity, type MovementType } from './balance'
import type {
  InventoryAnnualReportItemSource,
  InventoryAnnualReportMovementSource,
} from './types'

const REPORT_SHEET_NAME = 'เทคนิคการแพทย์'
const DATA_START_ROW = 7
const THAI_SARABUN_BODY = 'TH SarabunPSK'
const THAI_SARABUN_TITLE = 'TH SarabunIT๙'
const QUANTITY_FORMAT = '#,##0.###'
const MONEY_FORMAT = '#,##0.00;(#,##0.00);-'
const BORDER_COLOR = 'FF000000'

export interface InventoryAnnualReportLine {
  id: string
  lsCode: string
  name: string
  baseUnit: string
  openingBalance: number
  receivedDuringYear: number
  totalReceived: number
  issuedDuringYear: number
  closingBalance: number
  latestUnitPrice: number | null
  totalValue: number | null
  note: string | null
}

export interface InventoryAnnualReportModel {
  fiscalYear: number
  startDate: string
  endDate: string
  generatedOn: string
  departmentLabel: string
  items: InventoryAnnualReportLine[]
  totalValue: number
}

export interface BuildInventoryAnnualReportInput {
  fiscalYear: number
  generatedOn: string
  department?: string | null
  items: readonly InventoryAnnualReportItemSource[]
  movements: readonly InventoryAnnualReportMovementSource[]
}

interface MovementTotals {
  openingBalance: number
  receivedDuringYear: number
  issuedDuringYear: number
  hasAdjustments: boolean
}

function moneyValue(quantity: number, unitPrice: number | null): number | null {
  if (unitPrice === null) return null
  return Math.round(quantity * unitPrice * 100) / 100
}

function movementIsAdjustment(movementType: MovementType): boolean {
  return movementType !== 'goods_receipt' && movementType !== 'requisition_issue'
}

function lineNote(item: InventoryAnnualReportItemSource, hasAdjustments: boolean): string | null {
  const notes = item.note?.trim() ? [item.note.trim()] : []
  if (!item.isActive) notes.push('ปิดใช้งาน')
  if (hasAdjustments) notes.push('มีการปรับยอดใน ledger')
  return notes.length > 0 ? notes.join(' · ') : null
}

/**
 * Converts the append-only stock ledger into the columns used by the annual
 * inspection form. Positive movements are reported as receipts and negative
 * movements as issues so the report always reconciles to the ledger, including
 * manual corrections and reversals.
 */
export function buildInventoryAnnualReportModel(
  input: BuildInventoryAnnualReportInput,
): InventoryAnnualReportModel {
  const { startDate, endDate } = fiscalYearBounds(input.fiscalYear)
  const totalsByItem = new Map<string, MovementTotals>()

  for (const movement of input.movements) {
    const totals = totalsByItem.get(movement.inventoryItemId) ?? {
      openingBalance: 0,
      receivedDuringYear: 0,
      issuedDuringYear: 0,
      hasAdjustments: false,
    }
    const occurredOn = movement.occurredOn.slice(0, 10)
    const quantity = movement.quantity

    if (occurredOn < startDate) {
      totals.openingBalance += quantity
    } else if (occurredOn <= endDate) {
      if (quantity >= 0) totals.receivedDuringYear += quantity
      else totals.issuedDuringYear += Math.abs(quantity)
      totals.hasAdjustments ||= movementIsAdjustment(movement.movementType)
    }

    totalsByItem.set(movement.inventoryItemId, totals)
  }

  const items = input.items.map((item) => {
    const totals = totalsByItem.get(item.id) ?? {
      openingBalance: 0,
      receivedDuringYear: 0,
      issuedDuringYear: 0,
      hasAdjustments: false,
    }
    const openingBalance = roundQuantity(totals.openingBalance)
    const receivedDuringYear = roundQuantity(totals.receivedDuringYear)
    const totalReceived = roundQuantity(openingBalance + receivedDuringYear)
    const issuedDuringYear = roundQuantity(totals.issuedDuringYear)
    const closingBalance = roundQuantity(totalReceived - issuedDuringYear)
    const latestUnitPrice = item.defaultUnitPrice === null
      ? null
      : Math.round(item.defaultUnitPrice * 100) / 100

    return {
      id: item.id,
      lsCode: item.lsCode,
      name: item.name,
      baseUnit: item.baseUnit,
      openingBalance,
      receivedDuringYear,
      totalReceived,
      issuedDuringYear,
      closingBalance,
      latestUnitPrice,
      totalValue: moneyValue(closingBalance, latestUnitPrice),
      note: lineNote(item, totals.hasAdjustments),
    }
  })

  const totalValue = Math.round(
    items.reduce((total, item) => total + (item.totalValue ?? 0), 0) * 100,
  ) / 100

  return {
    fiscalYear: input.fiscalYear,
    startDate,
    endDate,
    generatedOn: input.generatedOn,
    departmentLabel: input.department?.trim() || 'ทุกหน่วยงาน',
    items,
    totalValue,
  }
}

function thinBorder() {
  return {
    top: { style: 'thin' as const, color: { argb: BORDER_COLOR } },
    left: { style: 'thin' as const, color: { argb: BORDER_COLOR } },
    bottom: { style: 'thin' as const, color: { argb: BORDER_COLOR } },
    right: { style: 'thin' as const, color: { argb: BORDER_COLOR } },
  }
}

function styleHeaderCell(cell: ExcelJS.Cell) {
  cell.font = { name: THAI_SARABUN_BODY, size: 14 }
  cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
  cell.border = thinBorder()
}

function styleBodyRow(sheet: ExcelJS.Worksheet, rowNumber: number) {
  for (let column = 1; column <= 11; column += 1) {
    const cell = sheet.getCell(rowNumber, column)
    cell.font = { name: THAI_SARABUN_BODY, size: 14 }
    cell.border = thinBorder()
    cell.alignment = {
      vertical: 'middle',
      horizontal: column === 1 || column === 3 ? 'center' : undefined,
    }
  }
  sheet.getCell(rowNumber, 2).alignment = { vertical: 'middle' }
  sheet.getCell(rowNumber, 11).alignment = { vertical: 'middle', wrapText: true }
  sheet.getRow(rowNumber).height = 19.5
}

function setFormula(cell: ExcelJS.Cell, formula: string, result: number) {
  cell.value = { formula, result }
}

function setupReportSheet(sheet: ExcelJS.Worksheet, model: InventoryAnnualReportModel) {
  sheet.columns = [
    { key: 'sequence', width: 5.26953125 },
    { key: 'name', width: 53.90625 },
    { key: 'unit', width: 8.26953125 },
    { key: 'opening', width: 10.7265625 },
    { key: 'received', width: 9.26953125 },
    { key: 'totalReceived', width: 8.26953125 },
    { key: 'issued', width: 8.54296875 },
    { key: 'closing', width: 9.1796875 },
    { key: 'unitPrice', width: 10 },
    { key: 'totalValue', width: 12.6328125 },
    { key: 'note', width: 12.54296875 },
    { key: 'itemCode', width: 11.81640625 },
  ]
  sheet.getColumn(12).hidden = true
  sheet.properties.defaultRowHeight = 20
  sheet.properties.showGridLines = false
  sheet.views = [{ state: 'frozen', ySplit: 6, showGridLines: false }]
  sheet.pageSetup = {
    orientation: 'portrait',
    paperSize: 9,
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    horizontalCentered: true,
    margins: { left: 0.7, right: 0.7, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 },
    printTitlesRow: '1:6',
  }
  sheet.headerFooter = { oddFooter: 'หน้า &P / &N' }
  sheet.mergeCells('B1:L1')
  sheet.mergeCells('B2:L2')
  sheet.mergeCells('B3:L3')
  sheet.mergeCells('A5:A6')
  sheet.mergeCells('B5:B6')
  sheet.mergeCells('F5:F6')
  sheet.mergeCells('G5:G6')
  sheet.mergeCells('H5:J5')
  sheet.mergeCells('K5:K6')

  sheet.getCell('B1').value = `รายงานตรวจสอบพัสดุประจำปีงบประมาณ ${model.fiscalYear} โรงพยาบาลชลบุรี`
  sheet.getCell('B2').value = 'ตามพระราชบัญญัติการจัดซื้อจัดจ้างและบริหารพัสดุภาครัฐ พ.ศ.2560'
  sheet.getCell('B3').value = `วันที่ ${formatThaiDate(model.startDate)} ถึงวันที่ ${formatThaiDate(model.endDate)}`
  sheet.getCell('B4').value = model.departmentLabel === 'ทุกหน่วยงาน'
    ? 'ประเภทวัสดุวิทยาศาสตร์  คลังวัสดุวิทยาศาสตร์'
    : `ประเภทวัสดุวิทยาศาสตร์  คลังวัสดุวิทยาศาสตร์  หน่วยงาน ${model.departmentLabel}`

  for (const rowNumber of [1, 2, 3]) {
    const cell = sheet.getCell(`B${rowNumber}`)
    cell.font = { name: THAI_SARABUN_TITLE, size: 14, bold: true }
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
    sheet.getRow(rowNumber).height = 20
  }
  for (let column = 2; column <= 12; column += 1) {
    sheet.getCell(4, column).font = { name: THAI_SARABUN_TITLE, size: 14, bold: true }
  }
  sheet.getCell('B4').alignment = { horizontal: 'left', vertical: 'middle' }

  for (let rowNumber = 5; rowNumber <= 6; rowNumber += 1) {
    for (let column = 1; column <= 11; column += 1) styleHeaderCell(sheet.getCell(rowNumber, column))
  }
  styleHeaderCell(sheet.getCell('L5'))
  sheet.getCell('L5').value = 'itemcode'
  sheet.getCell('A5').value = 'ลำดับ'
  sheet.getCell('B5').value = 'รายการ'
  sheet.getCell('C5').value = 'บรรจุ'
  sheet.getCell('C6').value = 'หน่วยนับ'
  sheet.getCell('D5').value = `ปีงบประมาณ ${model.fiscalYear - 1}`
  sheet.getCell('D6').value = 'คงเหลือยกมา'
  sheet.getCell('E5').value = `ปีงบประมาณ ${model.fiscalYear}`
  sheet.getCell('E6').value = 'รับระหว่างปี'
  sheet.getCell('F5').value = 'รวมจำนวนรับ'
  sheet.getCell('G5').value = 'รวมจำนวนจ่าย'
  sheet.getCell('H5').value = `คงเหลือสิ้นปีงบประมาณ ${model.fiscalYear}`
  sheet.getCell('H6').value = 'จำนวน(หน่วย)'
  sheet.getCell('I6').value = 'ราคา/หน่วยล่าสุด'
  sheet.getCell('J6').value = 'ราคารวม'
  sheet.getCell('K5').value = 'หมายเหตุ'
  sheet.getRow(5).height = 37.5
  sheet.getRow(6).height = 39.75
}

/** Creates the annual inspection workbook without changing the existing PDF export. */
export async function generateInventoryAnnualReportWorkbook(
  model: InventoryAnnualReportModel,
): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'LABCBH Stock'
  workbook.created = new Date()
  workbook.modified = new Date()
  workbook.calcProperties.fullCalcOnLoad = true

  const sheet = workbook.addWorksheet(REPORT_SHEET_NAME)
  setupReportSheet(sheet, model)

  model.items.forEach((item, index) => {
    const rowNumber = DATA_START_ROW + index
    styleBodyRow(sheet, rowNumber)
    sheet.getCell(rowNumber, 1).value = index + 1
    sheet.getCell(rowNumber, 2).value = item.name
    sheet.getCell(rowNumber, 3).value = item.baseUnit
    sheet.getCell(rowNumber, 4).value = item.openingBalance
    sheet.getCell(rowNumber, 5).value = item.receivedDuringYear
    setFormula(sheet.getCell(rowNumber, 6), `ROUND(D${rowNumber}+E${rowNumber},3)`, item.totalReceived)
    sheet.getCell(rowNumber, 7).value = item.issuedDuringYear
    setFormula(sheet.getCell(rowNumber, 8), `ROUND(F${rowNumber}-G${rowNumber},3)`, item.closingBalance)
    sheet.getCell(rowNumber, 9).value = item.latestUnitPrice
    if (item.latestUnitPrice === null) {
      sheet.getCell(rowNumber, 10).value = null
    } else {
      setFormula(
        sheet.getCell(rowNumber, 10),
        `IF(I${rowNumber}="","",ROUND(H${rowNumber}*I${rowNumber},2))`,
        item.totalValue ?? 0,
      )
    }
    sheet.getCell(rowNumber, 11).value = item.note
    sheet.getCell(rowNumber, 12).value = item.lsCode

    for (const column of [4, 5, 6, 7, 8]) sheet.getCell(rowNumber, column).numFmt = QUANTITY_FORMAT
    for (const column of [9, 10]) sheet.getCell(rowNumber, column).numFmt = MONEY_FORMAT
  })

  const totalRowNumber = DATA_START_ROW + model.items.length
  styleBodyRow(sheet, totalRowNumber)
  sheet.getCell(totalRowNumber, 2).value = 'รวมจำนวนเงินทั้งสิ้น'
  sheet.getCell(totalRowNumber, 2).font = { name: THAI_SARABUN_BODY, size: 14, bold: true }
  setFormula(
    sheet.getCell(totalRowNumber, 10),
    `SUM(J${DATA_START_ROW}:J${Math.max(DATA_START_ROW, totalRowNumber - 1)})`,
    model.totalValue,
  )
  sheet.getCell(totalRowNumber, 10).numFmt = MONEY_FORMAT
  sheet.getCell(totalRowNumber, 10).font = { name: THAI_SARABUN_BODY, size: 14, bold: true }
  sheet.pageSetup.printArea = `A1:K${totalRowNumber}`

  return new Uint8Array(await workbook.xlsx.writeBuffer())
}
