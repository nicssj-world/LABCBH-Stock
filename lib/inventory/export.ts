import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import fontkit from '@pdf-lib/fontkit'
import { PDFDocument, type PDFFont, type PDFPage, rgb } from 'pdf-lib'
import { formatQuantity, formatThaiDate } from './presenter'
import type { InventoryExportItemRecord } from './types'

const PAGE_WIDTH = 841.89
const PAGE_HEIGHT = 595.28
const MARGIN_X = 34
const TABLE_WIDTH = PAGE_WIDTH - MARGIN_X * 2
const BOTTOM_MARGIN = 34
const HEADER_HEIGHT = 28
const CELL_PADDING_X = 5
const CELL_PADDING_Y = 5
const BODY_FONT_SIZE = 10
const BODY_LINE_HEIGHT = 13
const HEADER_FONT_SIZE = 9
const BORDER = rgb(0.77, 0.82, 0.86)
const INK = rgb(0.08, 0.09, 0.11)
const MUTED = rgb(0.29, 0.35, 0.4)
const NAVY = rgb(0.08, 0.18, 0.29)
const LOT_BACKGROUND = rgb(0.95, 0.97, 0.98)
const EMPTY_BACKGROUND = rgb(0.98, 0.98, 0.98)

type InventoryPdfCell = 'sequence' | 'code' | 'name' | 'department' | 'expiry' | 'unit' | 'balance'
type TextAlign = 'left' | 'center' | 'right'

interface InventoryPdfColumn {
  key: InventoryPdfCell
  header: string
  width: number
  align: TextAlign
}

const COLUMNS: readonly InventoryPdfColumn[] = [
  { key: 'sequence', header: 'ลำดับ', width: 38, align: 'center' },
  { key: 'code', header: 'รหัสพัสดุ', width: 78, align: 'left' },
  { key: 'name', header: 'รายการน้ำยา / Lot', width: 250, align: 'left' },
  { key: 'department', header: 'หน่วยงาน', width: 142, align: 'left' },
  { key: 'expiry', header: 'วันหมดอายุ', width: 86, align: 'center' },
  { key: 'unit', header: 'หน่วยนับ', width: 62, align: 'center' },
  { key: 'balance', header: 'คงเหลือ', width: TABLE_WIDTH - 38 - 78 - 250 - 142 - 86 - 62, align: 'right' },
]

export interface InventoryPdfInput {
  items: readonly InventoryExportItemRecord[]
  department: string | null
  onlyInStock: boolean
  generatedOn: string
}

export interface InventoryPdfRow {
  kind: 'item' | 'lot'
  sequence: number | null
  lsCode: string
  name: string
  responsibleDepartment: string | null
  baseUnit: string
  expiryDate: string | null
  balance: number
  lotCount?: number
  isActive?: boolean
}

export interface InventoryPdfModel {
  title: string
  generatedOn: string
  departmentLabel: string
  stockLabel: string
  itemCount: number
  rows: InventoryPdfRow[]
}

let fontBytesPromise: Promise<Uint8Array> | null = null

function loadFontBytes() {
  if (!fontBytesPromise) {
    const fontsDirectory = join(process.cwd(), 'node_modules', 'font-th-sarabun-new', 'fonts')
    fontBytesPromise = readFile(join(fontsDirectory, 'THSarabunNew-webfont.ttf'))
  }
  return fontBytesPromise
}

export function buildInventoryPdfModel(input: InventoryPdfInput): InventoryPdfModel {
  const departmentLabel = input.department?.trim() || 'ทุกหน่วยงาน'
  const rows: InventoryPdfRow[] = []

  input.items.forEach((item, index) => {
    const lotCount = item.lots.length
    rows.push({
      kind: 'item',
      sequence: index + 1,
      lsCode: item.lsCode,
      name: item.name,
      responsibleDepartment: item.responsibleDepartment,
      baseUnit: item.baseUnit,
      // A single lot can be summarized in the item row. Multi-lot items get
      // one explicit child row per lot immediately after the item row.
      expiryDate: lotCount === 1 ? item.lots[0].expiryDate : null,
      balance: item.onHand,
      lotCount,
    })

    if (lotCount > 1) {
      item.lots.forEach((lot) => {
        rows.push({
          kind: 'lot',
          sequence: null,
          lsCode: '',
          name: `Lot ${lot.lotNumber}${lot.isActive ? '' : ' (ปิดใช้งาน)'}`,
          responsibleDepartment: null,
          baseUnit: '',
          expiryDate: lot.expiryDate,
          balance: lot.balance,
          isActive: lot.isActive,
        })
      })
    }
  })

  return {
    title: 'รายงานคงคลังน้ำยาและวัสดุวิทยาศาสตร์',
    generatedOn: input.generatedOn,
    departmentLabel,
    stockLabel: input.onlyInStock ? 'เฉพาะรายการที่มีอยู่ในคลัง' : 'รายการทั้งหมด',
    itemCount: input.items.length,
    rows,
  }
}

function centeredX(pageWidth: number, text: string, font: PDFFont, size: number) {
  return Math.max(MARGIN_X, (pageWidth - font.widthOfTextAtSize(text, size)) / 2)
}

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

function ellipsize(lines: string[], font: PDFFont, size: number, maxWidth: number, maxLines: number) {
  const result = lines.slice(0, maxLines)
  if (result.length === 0) return ['…']

  let last = result[result.length - 1]
  while (last && font.widthOfTextAtSize(`${last}…`, size) > maxWidth) {
    last = [...last].slice(0, -1).join('')
  }
  result[result.length - 1] = `${last}…`
  return result
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
  return truncated || lines.length > maxLines
    ? ellipsize(lines, font, size, maxWidth, maxLines)
    : lines
}

function rowCellText(row: InventoryPdfRow, key: InventoryPdfCell): string {
  switch (key) {
    case 'sequence':
      return row.sequence === null ? '' : String(row.sequence)
    case 'code':
      return row.kind === 'item' ? row.lsCode : ''
    case 'name':
      return row.kind === 'lot' ? `  ${row.name}` : row.name
    case 'department':
      return row.kind === 'item' ? (row.responsibleDepartment ?? 'ไม่ระบุ') : ''
    case 'expiry':
      if (row.kind === 'item' && (row.lotCount ?? 0) > 1) return 'ดูด้านล่าง'
      return row.expiryDate ? formatThaiDate(row.expiryDate) : '—'
    case 'unit':
      return row.kind === 'item' ? row.baseUnit : ''
    case 'balance':
      return formatQuantity(row.balance)
  }
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
    page.drawText(line, {
      x: textX,
      y: firstBaseline - index * BODY_LINE_HEIGHT,
      font,
      size,
      color,
    })
  })
}

function rowHeight(row: InventoryPdfRow, font: PDFFont) {
  const lineCount = Math.max(
    ...COLUMNS.map((column) => wrapText(rowCellText(row, column.key), font, BODY_FONT_SIZE, column.width - CELL_PADDING_X * 2).length),
  )
  return Math.max(24, lineCount * BODY_LINE_HEIGHT + CELL_PADDING_Y * 2)
}

function drawGridLine(page: PDFPage, startX: number, startY: number, endX: number, endY: number, thickness = 0.5) {
  page.drawLine({
    start: { x: startX, y: startY },
    end: { x: endX, y: endY },
    thickness,
    color: BORDER,
  })
}

function drawTableHeader(page: PDFPage, top: number, font: PDFFont) {
  const bottom = top - HEADER_HEIGHT
  page.drawRectangle({
    x: MARGIN_X,
    y: bottom,
    width: TABLE_WIDTH,
    height: HEADER_HEIGHT,
    color: NAVY,
  })

  let x = MARGIN_X
  COLUMNS.forEach((column) => {
    drawCellText(page, column.header, x, top, column.width, HEADER_HEIGHT, font, HEADER_FONT_SIZE, rgb(1, 1, 1), column.align, 2)
    x += column.width
    if (x < MARGIN_X + TABLE_WIDTH) drawGridLine(page, x, bottom, x, top, 0.35)
  })
  drawGridLine(page, MARGIN_X, bottom, MARGIN_X + TABLE_WIDTH, bottom)
  return bottom
}

function drawTableRow(page: PDFPage, row: InventoryPdfRow, top: number, font: PDFFont) {
  const height = rowHeight(row, font)
  const bottom = top - height
  page.drawRectangle({
    x: MARGIN_X,
    y: bottom,
    width: TABLE_WIDTH,
    height,
    color: row.kind === 'lot' ? LOT_BACKGROUND : rgb(1, 1, 1),
  })

  let x = MARGIN_X
  COLUMNS.forEach((column) => {
    drawCellText(page, rowCellText(row, column.key), x, top, column.width, height, font, BODY_FONT_SIZE, row.kind === 'lot' ? MUTED : INK, column.align)
    x += column.width
    if (x < MARGIN_X + TABLE_WIDTH) drawGridLine(page, x, bottom, x, top, 0.35)
  })
  drawGridLine(page, MARGIN_X, bottom, MARGIN_X + TABLE_WIDTH, bottom)
  return bottom
}

function drawReportIntro(page: PDFPage, model: InventoryPdfModel, font: PDFFont) {
  page.drawText(model.title, {
    x: centeredX(PAGE_WIDTH, model.title, font, 18),
    y: 560,
    font,
    size: 18,
    color: NAVY,
  })

  const generated = `ข้อมูล ณ วันที่ ${formatThaiDate(model.generatedOn)}`
  page.drawText(generated, {
    x: centeredX(PAGE_WIDTH, generated, font, 11),
    y: 539,
    font,
    size: 11,
    color: MUTED,
  })

  const scope = `หน่วยงาน: ${model.departmentLabel}  ·  ${model.stockLabel}`
  page.drawText(scope, {
    x: centeredX(PAGE_WIDTH, scope, font, 11),
    y: 520,
    font,
    size: 11,
    color: INK,
  })

  const note = `รวม ${model.itemCount} รายการ  ·  รายการที่มีมากกว่า 1 Lot จะแสดงรายละเอียด Lot ต่อจากรายการหลัก`
  page.drawText(note, {
    x: centeredX(PAGE_WIDTH, note, font, 10),
    y: 501,
    font,
    size: 10,
    color: MUTED,
  })

  return 480
}

function drawCompactHeader(page: PDFPage, model: InventoryPdfModel, font: PDFFont) {
  page.drawText(model.title, { x: MARGIN_X, y: 565, font, size: 12, color: NAVY })
  const scope = `หน่วยงาน: ${model.departmentLabel}  ·  ${model.stockLabel}  ·  วันที่ ${formatThaiDate(model.generatedOn)}`
  page.drawText(scope, { x: MARGIN_X, y: 548, font, size: 9, color: MUTED })
  return 532
}

function drawEmptyRow(page: PDFPage, top: number, font: PDFFont) {
  const height = 36
  const bottom = top - height
  page.drawRectangle({
    x: MARGIN_X,
    y: bottom,
    width: TABLE_WIDTH,
    height,
    color: EMPTY_BACKGROUND,
  })
  const message = 'ไม่พบรายการตามเงื่อนไขที่เลือก'
  page.drawText(message, {
    x: centeredX(PAGE_WIDTH, message, font, 11),
    y: bottom + 12,
    font,
    size: 11,
    color: MUTED,
  })
  drawGridLine(page, MARGIN_X, bottom, MARGIN_X + TABLE_WIDTH, bottom)
}

function drawFooters(document: PDFDocument, font: PDFFont) {
  const pages = document.getPages()
  pages.forEach((page, index) => {
    const label = `หน้า ${index + 1} / ${pages.length}`
    page.drawText(label, {
      x: PAGE_WIDTH - MARGIN_X - font.widthOfTextAtSize(label, 9),
      y: 16,
      font,
      size: 9,
      color: MUTED,
    })
  })
}

export async function generateInventoryPdf(input: InventoryPdfInput): Promise<Uint8Array> {
  const model = buildInventoryPdfModel(input)
  const document = await PDFDocument.create()
  document.registerFontkit(fontkit)
  const regular = await document.embedFont(await loadFontBytes(), { subset: true })

  let page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT])
  let tableTop = drawTableHeader(page, drawReportIntro(page, model, regular), regular)

  if (model.rows.length === 0) {
    drawEmptyRow(page, tableTop, regular)
  } else {
    for (const row of model.rows) {
      const height = rowHeight(row, regular)
      if (tableTop - height < BOTTOM_MARGIN) {
        page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT])
        tableTop = drawTableHeader(page, drawCompactHeader(page, model, regular), regular)
      }
      tableTop = drawTableRow(page, row, tableTop, regular)
    }
  }

  drawFooters(document, regular)
  document.setTitle('รายงานคงคลังน้ำยาและวัสดุวิทยาศาสตร์')
  document.setSubject('รายงานยอดคงเหลือรายน้ำยาและราย Lot')
  document.setCreator('LABCBH Stock')
  document.setProducer('LABCBH Stock')
  return document.save()
}
