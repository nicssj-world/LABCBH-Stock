import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import fontkit from '@pdf-lib/fontkit'
import { PDFDocument, type PDFFont, type PDFPage, rgb } from 'pdf-lib'
import { formatThaiDate } from '@/lib/inventory/presenter'
import { contractStatusLabel } from './executive'
import type { ExecutiveOverview } from './executive-types'

const PAGE_WIDTH = 841.89
const PAGE_HEIGHT = 595.28
const MARGIN_X = 34
const TABLE_WIDTH = PAGE_WIDTH - MARGIN_X * 2
const BOTTOM_MARGIN = 34
const INK = rgb(0.06, 0.09, 0.14)
const MUTED = rgb(0.35, 0.41, 0.48)
const NAVY = rgb(0.09, 0.29, 0.53)
const TEAL = rgb(0.05, 0.58, 0.53)
const VIOLET = rgb(0.49, 0.23, 0.91)
const BLUE_SOFT = rgb(0.92, 0.95, 0.99)
const BORDER = rgb(0.82, 0.87, 0.92)

type TextAlign = 'left' | 'center' | 'right'

interface PdfColumn {
  header: string
  width: number
  align: TextAlign
}

let fontBytesPromise: Promise<Uint8Array> | null = null

function loadFontBytes() {
  if (!fontBytesPromise) {
    const fontsDirectory = join(process.cwd(), 'node_modules', 'font-th-sarabun-new', 'fonts')
    fontBytesPromise = readFile(join(fontsDirectory, 'THSarabunNew-webfont.ttf'))
  }
  return fontBytesPromise
}

const money = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 0 })

function moneyText(value: number): string {
  return `${money.format(value)} บาท`
}

function fitPrefix(text: string, font: PDFFont, size: number, maxWidth: number): [string, string] {
  const characters = [...text]
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
  const lines: string[] = []
  let current = ''
  let remaining = source
  while (remaining && lines.length < maxLines) {
    const words = remaining.split(/\s+/)
    const word = words.shift() ?? ''
    const candidate = current ? `${current} ${word}` : word
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate
      remaining = words.join(' ')
      continue
    }
    if (current) {
      lines.push(current)
      current = ''
      continue
    }
    const [prefix, rest] = fitPrefix(remaining, font, size, maxWidth)
    lines.push(prefix)
    remaining = rest
  }
  if (current && lines.length < maxLines) lines.push(current)
  if (remaining && lines.length > 0) {
    let last = lines[lines.length - 1]
    while (last && font.widthOfTextAtSize(`${last}…`, size) > maxWidth) last = [...last].slice(0, -1).join('')
    lines[lines.length - 1] = `${last}…`
  }
  return lines.length ? lines : ['—']
}

function centeredX(text: string, font: PDFFont, size: number) {
  return Math.max(MARGIN_X, (PAGE_WIDTH - font.widthOfTextAtSize(text, size)) / 2)
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
  const paddingX = 5
  const paddingY = 4
  const lineHeight = size + 3
  const lines = wrapText(text, font, size, Math.max(1, width - paddingX * 2), maxLines)
  const blockHeight = lines.length * lineHeight
  const firstBaseline = top - Math.max(paddingY, (height - blockHeight) / 2) - size
  lines.forEach((line, index) => {
    const measured = font.widthOfTextAtSize(line, size)
    const textX = align === 'right'
      ? x + width - paddingX - measured
      : align === 'center'
        ? x + (width - measured) / 2
        : x + paddingX
    page.drawText(line, { x: textX, y: firstBaseline - index * lineHeight, font, size, color })
  })
}

function drawLine(page: PDFPage, x1: number, y1: number, x2: number, y2: number, color = BORDER, thickness = 0.5) {
  page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, color, thickness })
}

function drawSectionTitle(page: PDFPage, title: string, top: number, font: PDFFont) {
  page.drawText(title, { x: MARGIN_X, y: top, font, size: 13, color: NAVY })
  drawLine(page, MARGIN_X, top - 6, PAGE_WIDTH - MARGIN_X, top - 6, NAVY, 1.2)
  return top - 20
}

function drawTable(
  page: PDFPage,
  top: number,
  columns: readonly PdfColumn[],
  rows: readonly string[][],
  font: PDFFont,
  options: { headerHeight?: number; fontSize?: number; rowMinHeight?: number } = {},
  startIndex = 0,
) {
  const headerHeight = options.headerHeight ?? 25
  const fontSize = options.fontSize ?? 9
  const rowMinHeight = options.rowMinHeight ?? 23
  const lineHeight = fontSize + 3
  const drawHeader = (currentTop: number) => {
    const bottom = currentTop - headerHeight
    page.drawRectangle({ x: MARGIN_X, y: bottom, width: TABLE_WIDTH, height: headerHeight, color: NAVY })
    let x = MARGIN_X
    columns.forEach((column) => {
      drawCellText(page, column.header, x, currentTop, column.width, headerHeight, font, fontSize, rgb(1, 1, 1), column.align, 2)
      x += column.width
      if (x < PAGE_WIDTH - MARGIN_X) drawLine(page, x, bottom, x, currentTop, rgb(0.75, 0.82, 0.9), 0.35)
    })
    drawLine(page, MARGIN_X, bottom, PAGE_WIDTH - MARGIN_X, bottom, BORDER)
    return bottom
  }

  let currentTop = drawHeader(top)
  let rowIndex = startIndex
  for (; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex]
    const height = Math.max(rowMinHeight, ...columns.map((column, index) => wrapText(row[index] ?? '—', font, fontSize, column.width - 10, 2).length * lineHeight + 8))
    if (currentTop - height < BOTTOM_MARGIN) break
    const bottom = currentTop - height
    page.drawRectangle({ x: MARGIN_X, y: bottom, width: TABLE_WIDTH, height, color: rgb(1, 1, 1) })
    let x = MARGIN_X
    columns.forEach((column, index) => {
      drawCellText(page, row[index] ?? '—', x, currentTop, column.width, height, font, fontSize, INK, column.align, 2)
      x += column.width
      if (x < PAGE_WIDTH - MARGIN_X) drawLine(page, x, bottom, x, currentTop, BORDER, 0.35)
    })
    drawLine(page, MARGIN_X, bottom, PAGE_WIDTH - MARGIN_X, bottom, BORDER)
    currentTop = bottom
  }
  return { top: currentTop, nextIndex: rowIndex }
}

function drawTitle(page: PDFPage, data: ExecutiveOverview, font: PDFFont) {
  const title = `รายงานภาพรวมผู้บริหาร ปีงบประมาณ ${data.fiscalYear}`
  page.drawText(title, { x: centeredX(title, font, 20), y: 558, font, size: 20, color: NAVY })
  const range = `${formatThaiDate(data.fiscalYearRange.start)} – ${formatThaiDate(data.fiscalYearRange.end)}`
  const metadata = `ช่วงข้อมูล ${range}  ·  สร้างรายงาน ${formatThaiDate(data.generatedOn)}`
  page.drawText(metadata, { x: centeredX(metadata, font, 10), y: 538, font, size: 10, color: MUTED })
  const basis = 'ฐานข้อมูล: งานซื้อใช้ยอดจากรายการรับเข้าคลังที่บันทึกเรียบร้อยแล้ว · งานจ้างและเช่าเครื่องใช้ค่าใช้จ่ายที่บันทึก'
  page.drawText(basis, { x: centeredX(basis, font, 9), y: 521, font, size: 9, color: MUTED })
  return 493
}

function drawKpis(page: PDFPage, data: ExecutiveOverview, font: PDFFont, top: number) {
  const gap = 10
  const width = (TABLE_WIDTH - gap * 3) / 4
  const height = 76
  const cards = [
    { label: 'ยอดรวมตามหมวด', value: data.spend.total, color: NAVY, hint: 'งานซื้อ + งานจ้างทั้งหมด' },
    { label: 'งานซื้อ', value: data.spend.purchase, color: NAVY, hint: 'ยอดรับเข้าคลัง' },
    { label: 'งานจ้างทั้งหมด', value: data.spend.hiringTotal, color: TEAL, hint: 'งานจ้างระบบ + เช่าเครื่อง' },
    { label: 'เช่าเครื่อง', value: data.spend.lease, color: VIOLET, hint: 'รายละเอียดในงานจ้าง' },
  ]
  cards.forEach((card, index) => {
    const x = MARGIN_X + index * (width + gap)
    page.drawRectangle({ x, y: top - height, width, height, color: BLUE_SOFT, borderColor: BORDER, borderWidth: 0.7 })
    page.drawRectangle({ x, y: top - 3, width, height: 3, color: card.color })
    page.drawText(card.label, { x: x + 9, y: top - 20, font, size: 9, color: MUTED })
    const value = moneyText(card.value)
    page.drawText(value, { x: x + 9, y: top - 43, font, size: 13, color: card.color })
    page.drawText(card.hint, { x: x + 9, y: top - 61, font, size: 8, color: MUTED })
  })
  return top - height - 20
}

function drawFooters(document: PDFDocument, font: PDFFont) {
  const pages = document.getPages()
  pages.forEach((page, index) => {
    const label = `หน้า ${index + 1} / ${pages.length}`
    page.drawText(label, { x: PAGE_WIDTH - MARGIN_X - font.widthOfTextAtSize(label, 8), y: 16, font, size: 8, color: MUTED })
    page.drawText('LABCBH Stock · รายงานเพื่อการบริหาร', { x: MARGIN_X, y: 16, font, size: 8, color: MUTED })
  })
}

export async function generateExecutivePdf(data: ExecutiveOverview): Promise<Uint8Array> {
  const document = await PDFDocument.create()
  document.registerFontkit(fontkit)
  const font = await document.embedFont(await loadFontBytes(), { subset: true })

  const firstPage = document.addPage([PAGE_WIDTH, PAGE_HEIGHT])
  let top = drawTitle(firstPage, data, font)
  top = drawKpis(firstPage, data, font, top)
  top = drawSectionTitle(firstPage, 'สรุปตามหมวดงาน', top, font)
  top = drawTable(firstPage, top, [
    { header: 'หมวด', width: 145, align: 'left' },
    { header: 'จำนวนเงิน', width: 155, align: 'right' },
    { header: 'สัดส่วน', width: 90, align: 'right' },
    { header: 'หมายเหตุ', width: TABLE_WIDTH - 390, align: 'left' },
  ], data.categories.map((row) => [row.label, moneyText(row.amount), row.share === null ? '—' : `${row.share.toFixed(1)}%`, row.note]), font, { rowMinHeight: 29 }).top
  top -= 22
  top = drawSectionTitle(firstPage, 'สรุปเช่าเครื่องตามอายุสัญญา', top, font)
  drawTable(firstPage, top, [
    { header: 'ระยะเวลา', width: 125, align: 'left' },
    { header: 'จำนวนสัญญา', width: 125, align: 'right' },
    { header: 'ค่าใช้จ่าย FY', width: 165, align: 'right' },
    { header: 'สัดส่วนค่าเช่า', width: 130, align: 'right' },
    { header: 'หมายเหตุ', width: TABLE_WIDTH - 545, align: 'left' },
  ], data.leaseDurationSummary.map((row) => [row.label, `${row.contractCount} สัญญา`, moneyText(row.expense), row.share === null ? '—' : `${row.share.toFixed(1)}%`, row.durationYears === null ? 'ไม่ระบุจำนวนปี' : 'สัญญาที่เกี่ยวข้องกับปีงบประมาณ']), font, { rowMinHeight: 29 })

  const monthlyPage = document.addPage([PAGE_WIDTH, PAGE_HEIGHT])
  top = drawTitle(monthlyPage, data, font)
  top = drawSectionTitle(monthlyPage, 'ยอดรายเดือนตามปีงบประมาณ', top, font)
  drawTable(monthlyPage, top, [
    { header: 'เดือน', width: 65, align: 'left' },
    { header: 'งานซื้อ', width: 130, align: 'right' },
    { header: 'งานจ้างระบบ', width: 130, align: 'right' },
    { header: 'เช่าเครื่อง', width: 130, align: 'right' },
    { header: 'งานจ้างทั้งหมด', width: 145, align: 'right' },
    { header: 'ยอดรวม', width: TABLE_WIDTH - 600, align: 'right' },
  ], data.monthly.map((row) => [row.label, moneyText(row.purchase), moneyText(row.service), moneyText(row.lease), moneyText(row.hiringTotal), moneyText(row.total)]), font, { rowMinHeight: 28 })

  const leaseRows = data.leaseContracts.map((contract) => [
    `${contract.contractName}${contract.contractNumber ? `\n${contract.contractNumber}` : ''}`,
    contract.durationYears ? `${contract.durationYears} ปี` : 'ไม่ระบุ',
    formatThaiDate(contract.startDate),
    formatThaiDate(contract.endDate),
    moneyText(contract.fiscalYearExpense),
    contractStatusLabel(contract.status),
  ])
  let leaseRowIndex = 0
  let leasePage = document.addPage([PAGE_WIDTH, PAGE_HEIGHT])
  while (true) {
    top = drawTitle(leasePage, data, font)
    top = drawSectionTitle(leasePage, 'รายละเอียดสัญญาเช่าเครื่อง', top, font)
    const leaseResult = drawTable(leasePage, top, [
    { header: 'สัญญา / เลขที่', width: 195, align: 'left' },
    { header: 'ระยะเวลา', width: 70, align: 'center' },
    { header: 'วันที่เริ่ม', width: 100, align: 'center' },
    { header: 'วันที่สิ้นสุด', width: 100, align: 'center' },
    { header: 'ค่าใช้จ่าย FY', width: 125, align: 'right' },
    { header: 'สถานะ', width: TABLE_WIDTH - 590, align: 'left' },
    ], leaseRows, font, { rowMinHeight: 31, fontSize: 8 }, leaseRowIndex)
    leaseRowIndex = leaseResult.nextIndex
    if (leaseRowIndex >= leaseRows.length) break
    leasePage = document.addPage([PAGE_WIDTH, PAGE_HEIGHT])
  }

  const finalPage = document.addPage([PAGE_WIDTH, PAGE_HEIGHT])
  top = drawTitle(finalPage, data, font)
  top = drawSectionTitle(finalPage, 'รายการที่ต้องติดตามและคุณภาพข้อมูล', top, font)
  top = drawTable(finalPage, top, [
    { header: 'ประเภท', width: 120, align: 'left' },
    { header: 'รายการ', width: 230, align: 'left' },
    { header: 'รายละเอียด', width: TABLE_WIDTH - 350, align: 'left' },
  ], data.alerts.map((alert) => [alert.tone === 'danger' ? 'เร่งด่วน' : alert.tone === 'attention' ? 'ติดตาม' : 'ข้อมูล', alert.label, alert.detail]), font, { rowMinHeight: 31 }).top
  top -= 30
  const qualityNote = 'หมายเหตุ: รายการรับเข้าที่ไม่มี PR ราคา หรือสัญญาที่เชื่อมโยง จะไม่ถูกจัดหมวดโดยการคาดเดา และแสดงแยกไว้ใน Data Quality ของไฟล์ Excel'
  const qualityLines = wrapText(qualityNote, font, 10, TABLE_WIDTH, 3)
  qualityLines.forEach((line, index) => finalPage.drawText(line, { x: MARGIN_X, y: top - index * 14, font, size: 10, color: MUTED }))

  drawFooters(document, font)
  document.setTitle(`รายงานภาพรวมผู้บริหาร ปีงบประมาณ ${data.fiscalYear}`)
  document.setSubject('รายงานยอดงานซื้อ งานจ้าง และเช่าเครื่องประจำปีงบประมาณ')
  document.setCreator('LABCBH Stock')
  document.setProducer('LABCBH Stock')
  return document.save()
}
