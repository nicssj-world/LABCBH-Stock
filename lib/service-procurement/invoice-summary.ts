import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import fontkit from '@pdf-lib/fontkit'
import { PDFDocument, type PDFFont, type PDFPage, rgb } from 'pdf-lib'
import type { ServicePurchaseRequestItemRecord, ServiceUsageEventRecord } from './types'

const PAGE_WIDTH = 595.28
const PAGE_HEIGHT = 841.89
const MARGIN_X = 32
const TABLE_WIDTH = PAGE_WIDTH - MARGIN_X * 2
const BOTTOM_MARGIN = 36
const TABLE_HEADER_HEIGHT = 28
const CELL_PADDING_X = 5
const CELL_PADDING_Y = 2
const BODY_FONT_SIZE = 9
const BODY_LINE_HEIGHT = 9
const HEADER_FONT_SIZE = 9
const HEADER_TITLE_FONT_SIZE = 14
const HEADER_TITLE_MIN_FONT_SIZE = 10
const BORDER = rgb(0.78, 0.83, 0.89)
const INK = rgb(0.08, 0.1, 0.14)
const MUTED = rgb(0.33, 0.4, 0.48)
const NAVY = rgb(0.08, 0.3, 0.56)
const NAVY_DARK = rgb(0.06, 0.22, 0.42)
const HEADER_TEXT = rgb(1, 1, 1)
const SOFT_SURFACE = rgb(0.96, 0.98, 1)

const moneyNumber = new Intl.NumberFormat('th-TH', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})
const peopleNumber = new Intl.NumberFormat('th-TH', {
  maximumFractionDigits: 2,
})

export interface ServiceInvoiceSummaryInput {
  isRedCross: boolean
  documentNumber: string
  invoiceSummaryNumber: string
  planName: string | null
  poNumber: string | null
  usageStartDate: string
  usageEndDate: string
  items: readonly Pick<ServicePurchaseRequestItemRecord, 'unit' | 'unitPrice'>[]
  usageEvents: readonly Pick<ServiceUsageEventRecord, 'kind' | 'status' | 'expenseDate' | 'amount' | 'invoiceNumber' | 'createdAt'>[]
}

export interface ServiceInvoiceSummaryRow {
  poNumber: string | null
  sequence: number
  invoiceNumber: string | null
  invoiceDate: string
  amount: number
  people: number | null
}

export interface ServiceInvoiceSummaryModel {
  documentNumber: string
  invoiceSummaryNumber: string
  planName: string
  dateRangeLabel: string
  peopleUnitPrice: number | null
  rows: ServiceInvoiceSummaryRow[]
  totalAmount: number
  totalPeople: number | null
}

let fontBytesPromise: Promise<Uint8Array> | null = null

function loadFontBytes() {
  if (!fontBytesPromise) {
    const fontsDirectory = join(process.cwd(), 'node_modules', 'font-th-sarabun-new', 'fonts')
    fontBytesPromise = readFile(join(fontsDirectory, 'THSarabunNew-webfont.ttf'))
  }
  return fontBytesPromise
}

function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function roundPeople(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export function formatThaiLongDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number)
  return new Intl.DateTimeFormat('th-TH-u-ca-buddhist', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Bangkok',
  }).format(new Date(Date.UTC(year, month - 1, day)))
}

export function formatThaiNumericDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-')
  return `${day.padStart(2, '0')}/${month.padStart(2, '0')}/${(Number(year) + 543).toString()}`
}

function isPeopleUnit(unit: string): boolean {
  return unit.trim().toLocaleLowerCase('th-TH') === 'ราย'
}

function peopleUnitPrice(items: ServiceInvoiceSummaryInput['items']): number | null {
  const item = items.find((entry) => isPeopleUnit(entry.unit) && entry.unitPrice !== null && Number.isFinite(entry.unitPrice) && entry.unitPrice > 0)
  return item?.unitPrice ?? null
}

export function buildServiceInvoiceSummaryModel(input: ServiceInvoiceSummaryInput): ServiceInvoiceSummaryModel {
  if (!input.isRedCross) throw new Error('สร้างสรุปใบแจ้งหนี้ได้เฉพาะ PR งานจ้างที่ติด tag สภากาชาดไทย')

  const unitPrice = peopleUnitPrice(input.items)
  const expenseEvents = input.usageEvents
    .filter((event) => event.kind === 'lab_expense' && event.status === 'active')
    .slice()
    .sort((left, right) => left.expenseDate.localeCompare(right.expenseDate) || left.createdAt.localeCompare(right.createdAt))

  const rows = expenseEvents.map((event, index) => ({
    poNumber: index === 0 ? input.poNumber?.trim() || null : null,
    sequence: index + 1,
    invoiceNumber: event.invoiceNumber?.trim() || null,
    invoiceDate: event.expenseDate,
    amount: roundCurrency(event.amount),
    people: unitPrice === null ? null : roundPeople(event.amount / unitPrice),
  }))

  return {
    documentNumber: input.documentNumber,
    invoiceSummaryNumber: input.invoiceSummaryNumber,
    planName: input.planName?.trim() || 'ไม่พบชื่อแผน',
    dateRangeLabel: `วันที่ ${formatThaiLongDate(input.usageStartDate)} - ${formatThaiLongDate(input.usageEndDate)}`,
    peopleUnitPrice: unitPrice,
    rows,
    totalAmount: roundCurrency(rows.reduce((sum, row) => sum + row.amount, 0)),
    totalPeople: unitPrice === null ? null : roundPeople(rows.reduce((sum, row) => sum + (row.people ?? 0), 0)),
  }
}

type TextAlign = 'left' | 'center' | 'right'

interface PdfColumn {
  header: string
  width: number
  align: TextAlign
}

const COLUMNS: readonly PdfColumn[] = [
  { header: 'เลข PO', width: 78, align: 'center' },
  { header: 'ลำดับที่', width: 50, align: 'center' },
  { header: 'เลขที่ใบแจ้งหนี้', width: 142, align: 'center' },
  { header: 'ประจำวันที่', width: 80, align: 'center' },
  { header: 'ราคา (บาท)', width: 92, align: 'right' },
  { header: 'จำนวน (ราย)', width: TABLE_WIDTH - 78 - 50 - 142 - 80 - 92, align: 'right' },
]

function fitPrefix(text: string, font: PDFFont, size: number, maxWidth: number): [string, string] {
  const characters = [...text]
  if (characters.length === 0) return ['', '']
  for (let index = 1; index <= characters.length; index += 1) {
    const candidate = characters.slice(0, index).join('')
    if (font.widthOfTextAtSize(candidate, size) > maxWidth) {
      const splitIndex = Math.max(1, index - 1)
      return [characters.slice(0, splitIndex).join(''), characters.slice(splitIndex).join('')]
    }
  }
  return [text, '']
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number, maxLines = 2): string[] {
  const source = text.trim() || '—'
  const words = source.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let current = ''
  let truncated = false

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate
      continue
    }

    if (current) {
      lines.push(current)
      current = ''
      if (lines.length >= maxLines) {
        truncated = true
        break
      }
    }

    let remaining = word
    while (remaining && font.widthOfTextAtSize(remaining, size) > maxWidth) {
      const [prefix, rest] = fitPrefix(remaining, font, size, maxWidth)
      lines.push(prefix)
      remaining = rest
      if (lines.length >= maxLines) {
        truncated = remaining.length > 0
        break
      }
    }
    if (truncated) break
    current = remaining
  }

  if (!truncated && current) lines.push(current)
  if (lines.length === 0) lines.push('—')
  if (truncated || lines.length > maxLines) {
    const result = lines.slice(0, maxLines)
    let last = result[result.length - 1] ?? ''
    while (last && font.widthOfTextAtSize(`${last}…`, size) > maxWidth) last = [...last].slice(0, -1).join('')
    result[result.length - 1] = `${last}…`
    return result
  }
  return lines
}

function drawCellText(
  page: PDFPage,
  text: string,
  x: number,
  top: number,
  width: number,
  height: number,
  font: PDFFont,
  size: number,
  color: ReturnType<typeof rgb>,
  align: TextAlign,
  maxLines = 2,
) {
  const maxWidth = Math.max(1, width - CELL_PADDING_X * 2)
  const lines = wrapText(text, font, size, maxWidth, maxLines)
  const textBlockHeight = lines.length * BODY_LINE_HEIGHT
  const firstBaseline = top - Math.max(CELL_PADDING_Y, (height - textBlockHeight) / 2) - size
  lines.forEach((line, index) => {
    const measured = font.widthOfTextAtSize(line, size)
    const textX = align === 'right'
      ? x + width - CELL_PADDING_X - measured
      : align === 'center'
        ? x + (width - measured) / 2
        : x + CELL_PADDING_X
    page.drawText(line, { x: textX, y: firstBaseline - index * BODY_LINE_HEIGHT, font, size, color })
  })
}

function drawLine(page: PDFPage, x1: number, y1: number, x2: number, y2: number, color = BORDER, thickness = 0.5) {
  page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, color, thickness })
}

function drawTableGrid(page: PDFPage, top: number, bottom: number, color = BORDER, thickness = 0.35) {
  drawLine(page, MARGIN_X, top, MARGIN_X + TABLE_WIDTH, top, color, thickness)
  drawLine(page, MARGIN_X, bottom, MARGIN_X + TABLE_WIDTH, bottom, color, thickness)

  let x = MARGIN_X
  drawLine(page, x, bottom, x, top, color, thickness)
  COLUMNS.forEach((column) => {
    x += column.width
    drawLine(page, x, bottom, x, top, color, thickness)
  })
}

function fitHeaderTitleSize(title: string, font: PDFFont): number {
  const maxWidth = PAGE_WIDTH - MARGIN_X * 2
  let size = HEADER_TITLE_FONT_SIZE
  while (size > HEADER_TITLE_MIN_FONT_SIZE && font.widthOfTextAtSize(title, size) > maxWidth) size -= 1
  return size
}

function drawPageHeader(page: PDFPage, model: ServiceInvoiceSummaryModel, regular: PDFFont, bold: PDFFont, compact = false): number {
  const title = `เอกสารสรุปใบแจ้งหนี้ ${model.planName}`
  const invoiceSummaryLabel = `เลขที่ ${model.invoiceSummaryNumber}`
  if (compact) {
    page.drawText(title, { x: MARGIN_X, y: PAGE_HEIGHT - 38, font: bold, size: 13, color: NAVY_DARK })
    page.drawText(model.dateRangeLabel, { x: MARGIN_X, y: PAGE_HEIGHT - 57, font: regular, size: 9, color: MUTED })
    return PAGE_HEIGHT - 76
  }

  page.drawText(invoiceSummaryLabel, {
    x: PAGE_WIDTH - MARGIN_X - bold.widthOfTextAtSize(invoiceSummaryLabel, 9),
    y: PAGE_HEIGHT - 34,
    font: bold,
    size: 9,
    color: MUTED,
  })
  const titleSize = fitHeaderTitleSize(title, bold)
  page.drawText(title, { x: Math.max(MARGIN_X, (PAGE_WIDTH - bold.widthOfTextAtSize(title, titleSize)) / 2), y: PAGE_HEIGHT - 78, font: bold, size: titleSize, color: NAVY_DARK })
  page.drawText(model.dateRangeLabel, { x: Math.max(MARGIN_X, (PAGE_WIDTH - regular.widthOfTextAtSize(model.dateRangeLabel, 11)) / 2), y: PAGE_HEIGHT - 101, font: regular, size: 11, color: MUTED })
  return PAGE_HEIGHT - 123
}

function drawTableHeader(page: PDFPage, top: number, font: PDFFont): number {
  const bottom = top - TABLE_HEADER_HEIGHT
  page.drawRectangle({ x: MARGIN_X, y: bottom, width: TABLE_WIDTH, height: TABLE_HEADER_HEIGHT, color: NAVY })
  drawTableGrid(page, top, bottom, rgb(0.65, 0.76, 0.88), 0.35)
  let x = MARGIN_X
  COLUMNS.forEach((column) => {
    drawCellText(page, column.header, x, top, column.width, TABLE_HEADER_HEIGHT, font, HEADER_FONT_SIZE, HEADER_TEXT, column.align, 2)
    x += column.width
  })
  drawLine(page, MARGIN_X, bottom, MARGIN_X + TABLE_WIDTH, bottom, NAVY_DARK, 0.8)
  return bottom
}

function rowValue(row: ServiceInvoiceSummaryRow, index: number): string {
  switch (index) {
    case 0: return row.poNumber ?? '—'
    case 1: return String(row.sequence)
    case 2: return row.invoiceNumber ?? '—'
    case 3: return formatThaiNumericDate(row.invoiceDate)
    case 4: return moneyNumber.format(row.amount)
    case 5: return row.people === null ? '—' : peopleNumber.format(row.people)
    default: return '—'
  }
}

function rowHeight(row: ServiceInvoiceSummaryRow, font: PDFFont): number {
  const maxLines = Math.max(...COLUMNS.map((column, index) => wrapText(rowValue(row, index), font, BODY_FONT_SIZE, column.width - CELL_PADDING_X * 2, 1).length))
  return Math.max(17, maxLines * BODY_LINE_HEIGHT + CELL_PADDING_Y * 2)
}

function drawTableRow(page: PDFPage, row: ServiceInvoiceSummaryRow, top: number, font: PDFFont): number {
  const height = rowHeight(row, font)
  const bottom = top - height
  page.drawRectangle({ x: MARGIN_X, y: bottom, width: TABLE_WIDTH, height, color: rgb(1, 1, 1) })
  drawTableGrid(page, top, bottom)
  let x = MARGIN_X
  COLUMNS.forEach((column, index) => {
    drawCellText(page, rowValue(row, index), x, top, column.width, height, font, BODY_FONT_SIZE, INK, column.align, 1)
    x += column.width
  })
  return bottom
}

function drawTotalRow(page: PDFPage, model: ServiceInvoiceSummaryModel, top: number, font: PDFFont, bold: PDFFont): number {
  const height = 32
  const bottom = top - height
  page.drawRectangle({ x: MARGIN_X, y: bottom, width: TABLE_WIDTH, height, color: SOFT_SURFACE })
  const label = 'รวม'
  const labelStartX = MARGIN_X + COLUMNS[0].width + COLUMNS[1].width + COLUMNS[2].width
  const labelWidth = COLUMNS[3].width
  drawTableGrid(page, top, bottom)
  drawCellText(page, label, labelStartX, top, labelWidth, height, bold, BODY_FONT_SIZE, NAVY_DARK, 'right')
  drawCellText(page, moneyNumber.format(model.totalAmount), labelStartX + labelWidth, top, COLUMNS[4].width, height, bold, BODY_FONT_SIZE, NAVY_DARK, 'right')
  drawCellText(page, model.totalPeople === null ? '—' : peopleNumber.format(model.totalPeople), MARGIN_X + TABLE_WIDTH - COLUMNS[5].width, top, COLUMNS[5].width, height, bold, BODY_FONT_SIZE, NAVY_DARK, 'right')
  drawLine(page, MARGIN_X, bottom, MARGIN_X + TABLE_WIDTH, bottom, NAVY_DARK, 0.8)
  return bottom
}

function drawEmptyRow(page: PDFPage, top: number, font: PDFFont): number {
  const height = 36
  const bottom = top - height
  page.drawRectangle({ x: MARGIN_X, y: bottom, width: TABLE_WIDTH, height, color: SOFT_SURFACE })
  const message = 'ยังไม่มีรายการค่าใช้จ่ายที่บันทึก'
  const x = Math.max(MARGIN_X, (PAGE_WIDTH - font.widthOfTextAtSize(message, BODY_FONT_SIZE)) / 2)
  page.drawText(message, { x, y: bottom + 12, font, size: BODY_FONT_SIZE, color: MUTED })
  drawLine(page, MARGIN_X, bottom, MARGIN_X + TABLE_WIDTH, bottom, BORDER)
  return bottom
}

function drawFooters(document: PDFDocument, font: PDFFont) {
  const pages = document.getPages()
  pages.forEach((page, index) => {
    const pageLabel = `หน้า ${index + 1} / ${pages.length}`
    page.drawText(pageLabel, { x: PAGE_WIDTH - MARGIN_X - font.widthOfTextAtSize(pageLabel, 9), y: 18, font, size: 9, color: MUTED })
  })
}

export async function generateServiceInvoiceSummaryPdf(input: ServiceInvoiceSummaryInput): Promise<Uint8Array> {
  const model = buildServiceInvoiceSummaryModel(input)
  const document = await PDFDocument.create()
  document.registerFontkit(fontkit)
  const regular = await document.embedFont(await loadFontBytes(), { subset: true })
  const bold = await document.embedFont(await readFile(join(process.cwd(), 'node_modules', 'font-th-sarabun-new', 'fonts', 'THSarabunNew_bold-webfont.ttf')), { subset: true })

  let page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT])
  let tableTop = drawTableHeader(page, drawPageHeader(page, model, regular, bold), bold)
  if (model.rows.length === 0) {
    tableTop = drawEmptyRow(page, tableTop, regular)
  } else {
    model.rows.forEach((row, index) => {
      const needsSpaceForTotal = index === model.rows.length - 1 ? 40 : 0
      if (tableTop - rowHeight(row, regular) - needsSpaceForTotal < BOTTOM_MARGIN) {
        page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT])
        tableTop = drawTableHeader(page, drawPageHeader(page, model, regular, bold, true), bold)
      }
      tableTop = drawTableRow(page, row, tableTop, regular)
    })
  }

  if (tableTop - 32 < BOTTOM_MARGIN) {
    page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT])
    tableTop = drawTableHeader(page, drawPageHeader(page, model, regular, bold, true), bold)
  }
  drawTotalRow(page, model, tableTop, regular, bold)
  drawFooters(document, regular)
  document.setTitle(`เอกสารสรุปใบแจ้งหนี้ ${model.planName}`)
  document.setSubject(`สรุปใบแจ้งหนี้ของ ${model.documentNumber}`)
  document.setCreator('LABCBH Stock')
  document.setProducer('LABCBH Stock')
  return document.save()
}
