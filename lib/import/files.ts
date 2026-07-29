import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import readXlsxFile from 'read-excel-file/node'
import type {
  RawContractRow,
  RawItemRow,
  SourceCoordinate,
  Workbook,
} from './types'

type WorkbookKind = 'contracts' | 'items'
type CellValue = string | number | boolean | Date | null

const CONTRACT_HEADERS: Record<string, keyof Omit<RawContractRow, 'source'>> = {
  contractnumber: 'contractNumber',
  เลขที่สัญญา: 'contractNumber',
  เลขสัญญา: 'contractNumber',
  displayname: 'displayName',
  ชื่อสัญญา: 'displayName',
  vendor: 'vendor',
  บริษัท: 'vendor',
  ผู้ขาย: 'vendor',
  fiscalyear: 'fiscalYear',
  ปีงบประมาณ: 'fiscalYear',
  contracttype: 'contractType',
  ประเภทสัญญา: 'contractType',
  product: 'product',
  ผลิตภัณฑ์: 'product',
  รายการ: 'product',
  startdate: 'startDate',
  วันที่เริ่มสัญญา: 'startDate',
  วันเริ่ม: 'startDate',
  enddate: 'endDate',
  วันที่สิ้นสุดสัญญา: 'endDate',
  วันสิ้นสุด: 'endDate',
}

const ITEM_HEADERS: Record<string, keyof Omit<RawItemRow, 'source' | 'purchaseSequences'>> = {
  contractnumber: 'contractNumber',
  เลขที่สัญญา: 'contractNumber',
  เลขสัญญา: 'contractNumber',
  lscode: 'lsCode',
  รหัสls: 'lsCode',
  รหัส: 'lsCode',
  name: 'name',
  ชื่อรายการ: 'name',
  รายการ: 'name',
  unit: 'unit',
  หน่วย: 'unit',
  quantity: 'quantity',
  จำนวน: 'quantity',
  unitprice: 'unitPrice',
  ราคาต่อหน่วย: 'unitPrice',
  ราคา: 'unitPrice',
  stockonhand: 'stockOnHand',
  คงเหลือ: 'stockOnHand',
  ยอดคงเหลือ: 'stockOnHand',
}

function headerKey(value: CellValue): string {
  return String(value ?? '')
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase('th-TH')
    .replace(/[\s_.\-/()]+/g, '')
}

function columnName(index: number): string {
  let value = index + 1
  let result = ''
  while (value > 0) {
    value -= 1
    result = String.fromCharCode(65 + (value % 26)) + result
    value = Math.floor(value / 26)
  }
  return result
}

function cellValue(value: CellValue): unknown {
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return value
}

export function mapWorkbookRows(
  rows: CellValue[][],
  kind: 'contracts',
  metadata: { spreadsheetId: string; tab: string },
): Workbook<RawContractRow>
export function mapWorkbookRows(
  rows: CellValue[][],
  kind: 'items',
  metadata: { spreadsheetId: string; tab: string },
): Workbook<RawItemRow>
export function mapWorkbookRows(
  rows: CellValue[][],
  kind: WorkbookKind,
  metadata: { spreadsheetId: string; tab: string },
): Workbook<RawContractRow> | Workbook<RawItemRow> {
  const headers = rows[0] ?? []
  const mappedRows = rows.slice(1).flatMap((values, rowIndex) => {
    if (values.every(value => value === null || String(value).trim() === '')) return []
    const source: SourceCoordinate = {
      spreadsheetId: metadata.spreadsheetId,
      tab: metadata.tab,
      row: rowIndex + 2,
      cells: {},
    }

    if (kind === 'contracts') {
      const result: RawContractRow = { source }
      headers.forEach((header, columnIndex) => {
        const field = CONTRACT_HEADERS[headerKey(header)]
        if (!field) return
        result[field] = cellValue(values[columnIndex])
        source.cells![field] = `${columnName(columnIndex)}${source.row}`
      })
      return [result]
    }

    const result: RawItemRow = { source, purchaseSequences: {} }
    headers.forEach((header, columnIndex) => {
      const rawHeader = String(header ?? '').normalize('NFKC').trim()
      const field = ITEM_HEADERS[headerKey(header)]
      if (field) {
        result[field] = cellValue(values[columnIndex])
        source.cells![field] = `${columnName(columnIndex)}${source.row}`
        return
      }
      if (/ครั้งที่\s*\d+/i.test(rawHeader)) {
        result.purchaseSequences![rawHeader] = cellValue(values[columnIndex])
        source.cells![`purchaseSequences.${rawHeader}`] = `${columnName(columnIndex)}${source.row}`
      }
    })
    return [result]
  })

  return { ...metadata, rows: mappedRows } as Workbook<RawContractRow> | Workbook<RawItemRow>
}

export async function readWorkbookFile(
  filePath: string,
  kind: 'contracts',
  options?: { sheet?: string | number; spreadsheetId?: string },
): Promise<Workbook<RawContractRow>>
export async function readWorkbookFile(
  filePath: string,
  kind: 'items',
  options?: { sheet?: string | number; spreadsheetId?: string },
): Promise<Workbook<RawItemRow>>
export async function readWorkbookFile(
  filePath: string,
  kind: WorkbookKind,
  options: { sheet?: string | number; spreadsheetId?: string } = {},
) {
  const bytes = await readFile(filePath)
  const spreadsheetId = options.spreadsheetId
    ?? `sha256:${createHash('sha256').update(bytes).digest('hex')}`
  const sheet = options.sheet ?? 1
  const availableSheets = await readXlsxFile(filePath)
  const selectedSheet = typeof sheet === 'number'
    ? availableSheets[sheet - 1]
    : availableSheets.find(candidate => candidate.sheet === sheet)
  if (!selectedSheet) throw new Error(`sheet not found in ${basename(filePath)}: ${String(sheet)}`)
  const rows = selectedSheet.data as CellValue[][]
  const tab = selectedSheet.sheet
  return mapWorkbookRows(rows, kind as never, { spreadsheetId, tab })
}
