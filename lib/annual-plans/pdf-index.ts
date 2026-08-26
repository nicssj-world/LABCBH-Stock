import 'server-only'

import { createHash } from 'node:crypto'
import { PDFDocument, rgb } from 'pdf-lib'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { WorkerMessageHandler } from 'pdfjs-dist/legacy/build/pdf.worker.mjs'
import type { AnnualPlanRow } from './pr-reference'

// PDF.js disables real workers in Node and falls back to importing its worker
// from the relative path `./pdf.worker.mjs`. That path points at a Next.js
// server chunk in a deployment, where the worker asset is not emitted. Make
// the worker handler available on the global that PDF.js checks first so the
// fallback stays entirely inside the server bundle.
type PdfJsWorkerGlobal = typeof globalThis & {
  pdfjsWorker?: {
    WorkerMessageHandler: typeof WorkerMessageHandler
  }
}

const pdfJsGlobal = globalThis as PdfJsWorkerGlobal
pdfJsGlobal.pdfjsWorker ??= { WorkerMessageHandler }

type PdfTextItem = {
  str: string
  transform: number[]
  width: number
  height: number
}

interface TextRow {
  baseline: number
  items: PdfTextItem[]
}

function isTextItem(value: unknown): value is PdfTextItem {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<PdfTextItem>
  return typeof item.str === 'string'
    && Array.isArray(item.transform)
    && item.transform.length >= 6
    && typeof item.width === 'number'
}

function normaliseRowText(value: string) {
  return value.replace(/[\u200b\u200c\u200d\ufeff]/g, '').replace(/\s+/g, ' ').trim()
}

function parsePlanSequence(text: string, fallback: number) {
  const match = /^\s*([0-9]+(?:[./-][0-9]+)*)[.)-]?\s+/.exec(text)
  return match?.[1] ?? String(fallback)
}

function parseItemName(text: string) {
  return text.replace(/^\s*[0-9]+(?:[./-][0-9]+)*[.)-]?\s+/, '').trim() || text
}

function parseLsCode(text: string) {
  const labelled = /\bLS\s*[-:.]?\s*[A-Z0-9][A-Z0-9-]{2,}\b/i.exec(text)?.[0]
  if (labelled) return labelled.replace(/\s+/g, '')

  // Some legacy plans print the six/seven digit LS number without the "LS"
  // prefix. Keeping the prefix in the index makes it comparable with the
  // catalogue's canonical LS code without mistaking ordinary quantities for a
  // code unless the token is long enough to be useful.
  const numeric = /\b\d{5,10}\b/.exec(text)?.[0]
  return numeric ? `LS${numeric}` : null
}

function rowForItems(
  pageNumber: number,
  pageWidth: number,
  pageHeight: number,
  rows: TextRow[],
  rowNumberOffset: number,
): AnnualPlanRow[] {
  return rows
    .map((row, index) => {
      const items = [...row.items].sort((left, right) => left.transform[4] - right.transform[4])
      const rawText = normaliseRowText(items.map((item) => item.str).join(' '))
      if (!rawText) return null

      const x = Math.max(0, Math.min(...items.map((item) => item.transform[4])))
      const right = Math.max(...items.map((item) => item.transform[4] + Math.max(item.width, 1)))
      const baseline = row.baseline
      const height = Math.max(
        8,
        ...items.map((item) => Math.abs(item.height) || Math.abs(item.transform[3]) || 8),
      )
      const y = Math.max(0, baseline - height * 0.85)
      const width = Math.max(1, Math.min(pageWidth - x, right - x))
      const itemName = parseItemName(rawText)

      return {
        id: crypto.randomUUID(),
        lineNumber: rowNumberOffset + index + 1,
        planSequence: parsePlanSequence(rawText, rowNumberOffset + index + 1),
        itemName,
        lsCode: parseLsCode(rawText),
        rawText,
        pageNumber,
        pageWidth,
        pageHeight,
        x,
        y,
        width,
        height: Math.min(pageHeight - y, height * 1.35),
      }
    })
    .filter((row): row is AnnualPlanRow => row !== null)
}

/** Extracts searchable text rows and their original PDF coordinates. */
export async function indexAnnualPlanPdf(bytes: Uint8Array): Promise<AnnualPlanRow[]> {
  const loadingTask = pdfjs.getDocument({
    // PDF.js may transfer/detach the supplied ArrayBuffer while parsing. Keep
    // the caller's bytes intact because upload indexing hashes them afterward.
    data: new Uint8Array(bytes),
    disableFontFace: true,
    isEvalSupported: false,
    useWorkerFetch: false,
  })
  const document = await loadingTask.promise
  const rows: AnnualPlanRow[] = []
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber)
      const viewport = page.getViewport({ scale: 1 })
      const content = await page.getTextContent()
      const grouped: TextRow[] = []

      for (const rawItem of content.items) {
        if (!isTextItem(rawItem) || !rawItem.str.trim()) continue
        const baseline = rawItem.transform[5]
        const tolerance = Math.max(2.5, Math.abs(rawItem.transform[3] || rawItem.height || 8) * 0.45)
        const row = grouped.find((candidate) => Math.abs(candidate.baseline - baseline) <= tolerance)
        if (row) {
          row.items.push(rawItem)
          row.baseline = (row.baseline + baseline) / 2
        } else {
          grouped.push({ baseline, items: [rawItem] })
        }
      }

      grouped.sort((left, right) => right.baseline - left.baseline)
      rows.push(...rowForItems(pageNumber, viewport.width, viewport.height, grouped, rows.length))
    }
  } finally {
    await document.destroy()
  }

  return rows
}

export function sha256Hex(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex')
}

/**
 * Creates the checklist evidence PDF from the immutable source version. Only
 * pages containing selected rows are copied, and the selected rows are drawn
 * over with a translucent yellow box.
 */
export async function createHighlightedAnnualPlanPdf(
  sourceBytes: Uint8Array,
  selectedRows: readonly AnnualPlanRow[],
): Promise<Uint8Array> {
  if (selectedRows.length === 0) throw new Error('ไม่พบรายการที่ต้องไฮไลท์ในแผนประจำปี')

  const source = await PDFDocument.load(sourceBytes)
  const output = await PDFDocument.create()
  const pageNumbers = [...new Set(selectedRows.map((row) => row.pageNumber))].sort((left, right) => left - right)
  const copiedPages = await output.copyPages(source, pageNumbers.map((page) => page - 1))

  for (const [index, pageNumber] of pageNumbers.entries()) {
    const page = copiedPages[index]
    output.addPage(page)
    const pageRows = selectedRows.filter((row) => row.pageNumber === pageNumber)
    const { width, height } = page.getSize()

    for (const row of pageRows) {
      const x = Math.max(0, Math.min(width - 1, row.x - 3))
      const y = Math.max(0, Math.min(height - 1, row.y - 2))
      const highlightWidth = Math.max(4, Math.min(width - x, row.width + 6))
      const highlightHeight = Math.max(10, Math.min(height - y, row.height + 5))
      page.drawRectangle({
        x,
        y,
        width: highlightWidth,
        height: highlightHeight,
        color: rgb(1, 0.86, 0.08),
        opacity: 0.34,
        borderColor: rgb(0.86, 0.45, 0.02),
        borderOpacity: 0.9,
        borderWidth: 1.2,
      })
    }
  }

  return output.save()
}
