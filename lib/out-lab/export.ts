import { fiscalYearOfMonth } from '@/lib/out-lab/fiscal'
import type { OutLabUsageRecord } from '@/lib/out-lab/types'

/**
 * Deliberately not lib/contracts/export.ts. That file's header is fixed at
 * `เดือน,วันที่,จำนวนเงิน,...` and its row type carries a `usageDate` this
 * register does not have — one figure per month has no per-entry date. Sharing
 * it would mean widening a module the live lease pages use every day in order
 * to save forty lines here.
 */
const CSV_HEADER = 'เดือน,ปีงบประมาณ,จำนวนเงิน,ผู้บันทึก,หมายเหตุ'
const COLUMN_LABELS = ['เดือน', 'ปีงบประมาณ', 'จำนวนเงิน', 'ผู้บันทึก', 'หมายเหตุ']

function cell(value: string | number | null): string {
  const text = value === null ? '' : String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function xml(value: string | null): string {
  return (value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function fiscalYearCell(usageMonth: string): string {
  const fiscalYear = fiscalYearOfMonth(usageMonth)
  return fiscalYear === null ? '' : String(fiscalYear)
}

export function outLabUsageCsv(rows: OutLabUsageRecord[]): string {
  const body = rows.map((row) =>
    [
      cell(row.usageMonth.slice(0, 7)),
      cell(fiscalYearCell(row.usageMonth)),
      cell(row.amount.toFixed(2)),
      cell(row.recordedBy),
      cell(row.note),
    ].join(','),
  )
  // Excel assumes the system codepage unless the file opens with a BOM, which
  // turns every Thai character into mojibake.
  return `﻿${[CSV_HEADER, ...body].join('\n')}`
}

/**
 * SpreadsheetML keeps this dependency-free. A real .xlsx would mean pulling in
 * a zip writer to produce a file Excel opens either way.
 */
export function outLabUsageSheetXml(
  contract: { contractNumber: string | null; displayName: string | null },
  rows: OutLabUsageRecord[],
): string {
  const header = COLUMN_LABELS.map(
    (label) => `<Cell><Data ss:Type="String">${xml(label)}</Data></Cell>`,
  ).join('')

  const body = rows
    .map(
      (row) =>
        '<Row>' +
        `<Cell><Data ss:Type="String">${xml(row.usageMonth.slice(0, 7))}</Data></Cell>` +
        `<Cell><Data ss:Type="String">${xml(fiscalYearCell(row.usageMonth))}</Data></Cell>` +
        `<Cell><Data ss:Type="Number">${row.amount.toFixed(2)}</Data></Cell>` +
        `<Cell><Data ss:Type="String">${xml(row.recordedBy)}</Data></Cell>` +
        `<Cell><Data ss:Type="String">${xml(row.note)}</Data></Cell>` +
        '</Row>',
    )
    .join('')

  const title = xml(contract.contractNumber ?? contract.displayName ?? 'out-lab')

  return `<?xml version="1.0" encoding="UTF-8"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Worksheet ss:Name="${title}"><Table><Row>${header}</Row>${body}</Table></Worksheet>
</Workbook>`
}

export function outLabUsageFileBase(contract: {
  contractNumber: string | null
  displayName: string | null
}): string {
  const raw = contract.contractNumber ?? contract.displayName ?? 'out-lab'
  return raw.replace(/[^a-zA-Z0-9ก-๙._-]/g, '_')
}
