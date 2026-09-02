import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import fontkit from '@pdf-lib/fontkit'
import { PDFDocument, type PDFFont, type PDFPage, rgb } from 'pdf-lib'
import { formatThaiDateFull } from '@/lib/date/thai'
import { purchaseRequestExpenseEventsForDisplay, purchaseRequestExpenseNetTotal } from './expense'
import type { PurchaseRequestExpenseRecord, PurchaseRequestItemRecord } from './types'

const PAGE_WIDTH = 595.28
const PAGE_HEIGHT = 841.89
const MARGIN_X = 36
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2
const BOTTOM_MARGIN = 38
const BODY_SIZE = 9
const BODY_LINE_HEIGHT = 11
const BORDER = rgb(0.78, 0.83, 0.89)
const INK = rgb(0.08, 0.1, 0.14)
const MUTED = rgb(0.33, 0.4, 0.48)
const NAVY = rgb(0.06, 0.22, 0.42)
const SOFT_SURFACE = rgb(0.96, 0.98, 1)
const CREDIT_SURFACE = rgb(1, 0.95, 0.95)
const CREDIT_TEXT = rgb(0.62, 0.12, 0.14)

const moneyNumber = new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const quantityNumber = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 3 })

export interface PurchaseRequestInvoiceSummaryInput {
  documentNumber: string
  poNumber: string | null
  ephisPrNumber: string | null
  items: readonly Pick<PurchaseRequestItemRecord, 'lineNumber' | 'lsCode' | 'name' | 'requestedQuantity' | 'unit' | 'unitPrice' | 'lineTotal'>[]
  expenseEvents: readonly Pick<PurchaseRequestExpenseRecord, 'id' | 'expenseDate' | 'amount' | 'invoiceNumber' | 'documentType' | 'sourceExpenseId' | 'status' | 'note' | 'createdAt'>[]
}

export interface PurchaseRequestInvoiceSummaryModel {
  documentNumber: string
  poNumber: string | null
  ephisPrNumber: string | null
  title: string
  items: PurchaseRequestInvoiceSummaryInput['items']
  expenses: PurchaseRequestInvoiceSummaryInput['expenseEvents']
  total: number
  activeNetTotal: number
  remaining: number
}

/** The purchase PR heading is the ordered catalogue list, never the plan name. */
export function purchaseInvoiceSummaryTitle(
  items: readonly Pick<PurchaseRequestItemRecord, 'name'>[],
): string {
  const names = items.map((item) => item.name.trim()).filter(Boolean)
  return names.length > 0 ? names.join(', ') : 'รายการจัดซื้อ'
}

export function buildPurchaseRequestInvoiceSummaryModel(
  input: PurchaseRequestInvoiceSummaryInput,
): PurchaseRequestInvoiceSummaryModel {
  const expenses = purchaseRequestExpenseEventsForDisplay(input.expenseEvents.filter((event) => event.status === 'active'), 'asc')
  const total = roundCurrency(input.items.reduce((sum, item) => sum + item.lineTotal, 0))
  const activeNetTotal = purchaseRequestExpenseNetTotal(expenses)
  return {
    documentNumber: input.documentNumber,
    poNumber: input.poNumber?.trim() || null,
    ephisPrNumber: input.ephisPrNumber?.trim() || null,
    title: purchaseInvoiceSummaryTitle(input.items),
    items: input.items,
    expenses,
    total,
    activeNetTotal,
    remaining: roundCurrency(Math.max(0, total - activeNetTotal)),
  }
}

function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function formatMoney(value: number): string {
  return moneyNumber.format(value)
}

function formatQuantity(value: number, unit: string): string {
  return `${quantityNumber.format(value)} ${unit}`
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number, maxLines = 4): string[] {
  const normalized = text.trim() || '—'
  const lines: string[] = []
  let current = ''
  for (const character of [...normalized]) {
    const candidate = current + character
    if (current && font.widthOfTextAtSize(candidate, size) > maxWidth) {
      lines.push(current)
      current = character
      if (lines.length === maxLines - 1) break
    } else {
      current = candidate
    }
  }
  if (lines.length < maxLines && current) lines.push(current)
  if (lines.length === 0) lines.push('—')
  if ([...normalized].length > [...lines.join('')].length) {
    const last = lines.length - 1
    let truncated = lines[last]
    while (truncated && font.widthOfTextAtSize(`${truncated}…`, size) > maxWidth) truncated = truncated.slice(0, -1)
    lines[last] = `${truncated}…`
  }
  return lines
}

function drawTextLines(page: PDFPage, lines: readonly string[], x: number, y: number, font: PDFFont, size: number, color = INK, lineHeight = BODY_LINE_HEIGHT) {
  lines.forEach((line, index) => page.drawText(line, { x, y: y - index * lineHeight, font, size, color }))
}

function drawRule(page: PDFPage, y: number, color = BORDER) {
  page.drawLine({ start: { x: MARGIN_X, y }, end: { x: PAGE_WIDTH - MARGIN_X, y }, thickness: 1, color })
}

function drawHeader(page: PDFPage, model: PurchaseRequestInvoiceSummaryModel, regular: PDFFont, bold: PDFFont, continuation = false): number {
  let y = PAGE_HEIGHT - 34
  page.drawText('โรงพยาบาลชลบุรี', { x: MARGIN_X, y, font: bold, size: 11, color: NAVY })
  page.drawText('กลุ่มงานเทคนิคการแพทย์', { x: MARGIN_X, y: y - 14, font: regular, size: 9, color: MUTED })
  const documentTitle = continuation ? 'สรุปใบแจ้งหนี้ (ต่อ)' : 'สรุปใบแจ้งหนี้'
  page.drawText(documentTitle, { x: PAGE_WIDTH - MARGIN_X - bold.widthOfTextAtSize(documentTitle, 15), y: y - 2, font: bold, size: 15, color: NAVY })
  y -= 34

  const titleLines = wrapText(model.title, bold, 12, CONTENT_WIDTH, 3)
  drawTextLines(page, titleLines, MARGIN_X, y, bold, 12, INK, 14)
  y -= titleLines.length * 14 + 8
  drawRule(page, y)
  y -= 17

  const meta = [
    [`เลขที่ PR: ${model.documentNumber}`, `เลขที่ PO: ${model.poNumber ?? 'ยังไม่มี'}`],
    [`เลข PR (E-Phis): ${model.ephisPrNumber ?? 'ยังไม่มี'}`, `วันที่พิมพ์: ${formatThaiDateFull(new Date().toISOString().slice(0, 10))}`],
  ]
  meta.forEach((row) => {
    page.drawText(row[0], { x: MARGIN_X, y, font: regular, size: 9, color: INK })
    page.drawText(row[1], { x: PAGE_WIDTH / 2, y, font: regular, size: 9, color: INK })
    y -= 13
  })
  return y - 8
}

interface TableColumn { header: string; width: number; align?: 'left' | 'right' | 'center' }

function drawTableHeader(page: PDFPage, columns: readonly TableColumn[], y: number, font: PDFFont): number {
  const height = 24
  page.drawRectangle({ x: MARGIN_X, y: y - height, width: CONTENT_WIDTH, height, color: SOFT_SURFACE, borderColor: BORDER, borderWidth: 1 })
  let x = MARGIN_X
  columns.forEach((column, index) => {
    const lines = wrapText(column.header, font, 8, column.width - 8, 2)
    const lineX = column.align === 'right'
      ? x + column.width - 4 - font.widthOfTextAtSize(lines[0], 8)
      : column.align === 'center'
        ? x + (column.width - font.widthOfTextAtSize(lines[0], 8)) / 2
        : x + 4
    drawTextLines(page, lines, lineX, y - 9, font, 8, NAVY, 9)
    if (index < columns.length - 1) page.drawLine({ start: { x: x + column.width, y }, end: { x: x + column.width, y: y - height }, thickness: 0.6, color: BORDER })
    x += column.width
  })
  return y - height
}

function drawCellText(page: PDFPage, text: string, column: TableColumn, x: number, top: number, font: PDFFont, color = INK): number {
  const lines = wrapText(text, font, BODY_SIZE, column.width - 8, 5)
  const textWidth = font.widthOfTextAtSize(lines[0], BODY_SIZE)
  const textX = column.align === 'right'
    ? x + column.width - 4 - textWidth
    : column.align === 'center'
      ? x + (column.width - textWidth) / 2
      : x + 4
  drawTextLines(page, lines, textX, top - 12, font, BODY_SIZE, color)
  return lines.length
}

function drawItemRows(page: PDFPage, items: PurchaseRequestInvoiceSummaryModel['items'], y: number, regular: PDFFont, bold: PDFFont): number {
  const columns: readonly TableColumn[] = [
    { header: 'ลำดับ', width: 34, align: 'center' },
    { header: 'รหัส LS', width: 64 },
    { header: 'รายการซื้อ', width: 188 },
    { header: 'จำนวน', width: 75, align: 'right' },
    { header: 'หน่วย', width: 53, align: 'center' },
    { header: 'ราคาต่อหน่วย', width: 72, align: 'right' },
    { header: 'รวม', width: CONTENT_WIDTH - 486, align: 'right' },
  ]
  page.drawText('รายการซื้อ', { x: MARGIN_X, y, font: bold, size: 10, color: NAVY })
  y -= 8
  y = drawTableHeader(page, columns, y, bold)
  items.forEach((item) => {
    const values = [
      String(item.lineNumber), item.lsCode, item.name, formatQuantity(item.requestedQuantity, item.unit), item.unit,
      formatMoney(item.unitPrice), formatMoney(item.lineTotal),
    ]
    const lineCounts = values.map((value, index) => wrapText(value, regular, BODY_SIZE, columns[index].width - 8, 5).length)
    const height = Math.max(24, Math.max(...lineCounts) * BODY_LINE_HEIGHT + 8)
    page.drawRectangle({ x: MARGIN_X, y: y - height, width: CONTENT_WIDTH, height, borderColor: BORDER, borderWidth: 0.6 })
    let x = MARGIN_X
    values.forEach((value, index) => {
      drawCellText(page, value, columns[index], x, y, regular)
      if (index < values.length - 1) page.drawLine({ start: { x: x + columns[index].width, y }, end: { x: x + columns[index].width, y: y - height }, thickness: 0.5, color: BORDER })
      x += columns[index].width
    })
    y -= height
  })
  if (items.length === 0) {
    page.drawRectangle({ x: MARGIN_X, y: y - 28, width: CONTENT_WIDTH, height: 28, color: SOFT_SURFACE, borderColor: BORDER, borderWidth: 0.6 })
    page.drawText('ไม่มีรายการซื้อใน PR', { x: MARGIN_X + 8, y: y - 17, font: regular, size: BODY_SIZE, color: MUTED })
    y -= 28
  }
  return y - 18
}

function drawExpenseRows(page: PDFPage, expenses: PurchaseRequestInvoiceSummaryModel['expenses'], y: number, regular: PDFFont, bold: PDFFont): number {
  const columns: readonly TableColumn[] = [
    { header: 'วันที่', width: 72, align: 'center' },
    { header: 'ประเภท', width: 70, align: 'center' },
    { header: 'เลขที่เอกสาร', width: 132 },
    { header: 'Invoice ต้นทาง', width: 108 },
    { header: 'ยอดสุทธิ', width: 78, align: 'right' },
    { header: 'หมายเหตุ', width: CONTENT_WIDTH - 460 },
  ]
  page.drawText('รายการ Invoice และใบลดหนี้', { x: MARGIN_X, y, font: bold, size: 10, color: NAVY })
  y -= 8
  y = drawTableHeader(page, columns, y, bold)
  if (expenses.length === 0) {
    page.drawRectangle({ x: MARGIN_X, y: y - 28, width: CONTENT_WIDTH, height: 28, color: SOFT_SURFACE, borderColor: BORDER, borderWidth: 0.6 })
    const message = 'ยังไม่มีรายการค่าใช้จ่ายที่บันทึก'
    page.drawText(message, { x: MARGIN_X + 8, y: y - 17, font: regular, size: BODY_SIZE, color: MUTED })
    return y - 46
  }
  expenses.forEach((expense) => {
    const isCredit = expense.documentType === 'credit_note'
    const source = isCredit && expense.sourceExpenseId
      ? expenses.find((candidate) => candidate.id === expense.sourceExpenseId)?.invoiceNumber ?? 'Invoice ต้นทาง'
      : '—'
    const values = [
      formatThaiDateFull(expense.expenseDate),
      isCredit ? 'ใบลดหนี้' : 'Invoice',
      expense.invoiceNumber ?? 'ไม่ระบุเลข',
      source,
      formatMoney(isCredit ? -expense.amount : expense.amount),
      expense.note ?? '—',
    ]
    const lineCounts = values.map((value, index) => wrapText(value, regular, BODY_SIZE, columns[index].width - 8, 5).length)
    const height = Math.max(24, Math.max(...lineCounts) * BODY_LINE_HEIGHT + 8)
    page.drawRectangle({ x: MARGIN_X, y: y - height, width: CONTENT_WIDTH, height, color: isCredit ? CREDIT_SURFACE : undefined, borderColor: BORDER, borderWidth: 0.6 })
    let x = MARGIN_X
    values.forEach((value, index) => {
      drawCellText(page, value, columns[index], x, y, regular, isCredit && (index === 1 || index === 4) ? CREDIT_TEXT : INK)
      if (index < values.length - 1) page.drawLine({ start: { x: x + columns[index].width, y }, end: { x: x + columns[index].width, y: y - height }, thickness: 0.5, color: BORDER })
      x += columns[index].width
    })
    y -= height
  })
  return y - 16
}

function drawTotals(page: PDFPage, model: PurchaseRequestInvoiceSummaryModel, y: number, regular: PDFFont, bold: PDFFont) {
  const rows = [
    ['ยอดรวม PR', formatMoney(model.total)],
    ['ยอดสุทธิ active (Invoice หักใบลดหนี้)', formatMoney(model.activeNetTotal)],
    ['ยอดคงเหลือ', formatMoney(model.remaining)],
  ]
  const x = PAGE_WIDTH - MARGIN_X - 240
  rows.forEach(([label, value], index) => {
    const rowY = y - index * 17
    if (index === rows.length - 1) drawRule(page, rowY + 9, NAVY)
    page.drawText(label, { x, y: rowY, font: index === rows.length - 1 ? bold : regular, size: 9, color: index === rows.length - 1 ? NAVY : INK })
    page.drawText(value, { x: PAGE_WIDTH - MARGIN_X - bold.widthOfTextAtSize(value, 10), y: rowY, font: bold, size: 10, color: NAVY })
  })
}

function drawPageFooter(document: PDFDocument, font: PDFFont) {
  const pages = document.getPages()
  pages.forEach((page, index) => {
    const label = `หน้า ${index + 1} / ${pages.length}`
    page.drawText(label, { x: PAGE_WIDTH - MARGIN_X - font.widthOfTextAtSize(label, 8), y: 18, font, size: 8, color: MUTED })
  })
}

let regularFontBytes: Promise<Uint8Array> | null = null
let boldFontBytes: Promise<Uint8Array> | null = null

function loadRegularFont() {
  if (!regularFontBytes) regularFontBytes = readFile(join(process.cwd(), 'node_modules', 'font-th-sarabun-new', 'fonts', 'THSarabunNew-webfont.ttf'))
  return regularFontBytes
}

function loadBoldFont() {
  if (!boldFontBytes) boldFontBytes = readFile(join(process.cwd(), 'node_modules', 'font-th-sarabun-new', 'fonts', 'THSarabunNew_bold-webfont.ttf'))
  return boldFontBytes
}

export async function generatePurchaseRequestInvoiceSummaryPdf(input: PurchaseRequestInvoiceSummaryInput): Promise<Uint8Array> {
  const model = buildPurchaseRequestInvoiceSummaryModel(input)
  const document = await PDFDocument.create()
  document.registerFontkit(fontkit)
  const regular = await document.embedFont(await loadRegularFont(), { subset: true })
  const bold = await document.embedFont(await loadBoldFont(), { subset: true })

  let page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT])
  let y = drawHeader(page, model, regular, bold)
  y = drawItemRows(page, model.items, y, regular, bold)
  if (y < BOTTOM_MARGIN + 150) {
    page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT])
    y = drawHeader(page, model, regular, bold, true)
  }
  y = drawExpenseRows(page, model.expenses, y, regular, bold)
  if (y < BOTTOM_MARGIN + 70) {
    page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT])
    y = drawHeader(page, model, regular, bold, true)
  }
  drawTotals(page, model, y, regular, bold)
  drawPageFooter(document, regular)
  document.setTitle(`สรุปใบแจ้งหนี้ ${model.title}`)
  document.setSubject(`สรุปค่าใช้จ่ายของ ${model.documentNumber}`)
  document.setCreator('LABCBH Stock')
  document.setProducer('LABCBH Stock')
  return document.save()
}
