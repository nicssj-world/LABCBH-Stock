import type { ContractExpenseRecord } from '@/lib/contracts/budget-queries'

const CSV_HEADER = 'เดือน,วันที่,จำนวนเงิน,ผู้บันทึก,หมายเหตุ'

function cell(value: string | number | null): string {
  const text = value === null ? '' : String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function expenseCsv(rows: ContractExpenseRecord[]): string {
  const body = rows.map((row) =>
    [
      cell(row.usageMonth?.slice(0, 7) ?? ''),
      cell(row.usageDate),
      cell(row.amount.toFixed(2)),
      cell(row.recordedBy),
      cell(row.note),
    ].join(','),
  )
  // Excel assumes the system codepage unless the file opens with a BOM, which
  // turns every Thai character into mojibake.
  return `﻿${[CSV_HEADER, ...body].join('\n')}`
}

function xml(value: string | null): string {
  return (value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/**
 * SpreadsheetML keeps this dependency-free. A real .xlsx would mean pulling in
 * a zip writer to produce a file Excel opens either way.
 */
export function expenseSheetXml(
  contract: { contractNumber: string | null; displayName: string | null },
  rows: ContractExpenseRecord[],
): string {
  const header = ['เดือน', 'วันที่', 'จำนวนเงิน', 'ผู้บันทึก', 'หมายเหตุ']
    .map((label) => `<Cell><Data ss:Type="String">${xml(label)}</Data></Cell>`)
    .join('')

  const body = rows
    .map(
      (row) =>
        '<Row>' +
        `<Cell><Data ss:Type="String">${xml(row.usageMonth?.slice(0, 7) ?? '')}</Data></Cell>` +
        `<Cell><Data ss:Type="String">${xml(row.usageDate)}</Data></Cell>` +
        `<Cell><Data ss:Type="Number">${row.amount.toFixed(2)}</Data></Cell>` +
        `<Cell><Data ss:Type="String">${xml(row.recordedBy)}</Data></Cell>` +
        `<Cell><Data ss:Type="String">${xml(row.note)}</Data></Cell>` +
        '</Row>',
    )
    .join('')

  const title = xml(contract.contractNumber ?? contract.displayName ?? 'contract')

  return `<?xml version="1.0" encoding="UTF-8"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Worksheet ss:Name="${title}"><Table><Row>${header}</Row>${body}</Table></Worksheet>
</Workbook>`
}

export function expenseFileBase(contract: {
  contractNumber: string | null
  displayName: string | null
}): string {
  const raw = contract.contractNumber ?? contract.displayName ?? 'contract'
  return raw.replace(/[^a-zA-Z0-9ก-๙._-]/g, '_')
}
