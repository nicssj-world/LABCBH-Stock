import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import fontkit from '@pdf-lib/fontkit'
import { PDFDocument, type PDFFont, rgb } from 'pdf-lib'
import {
  committeePdfVariant,
  PR_COMMITTEE_KIND_LABELS,
  type PurchaseRequestCommitteeKind,
} from './checklist'
import { formatProfileName } from '@/lib/profiles/name'

export interface CommitteePdfMember {
  kind: PurchaseRequestCommitteeKind
  seat: number
  name: string
  namePrefix?: string | null
  positionTitle: string | null
}

export interface PurchaseRequestCommitteePdfInput {
  subjectName: string | null
  total: number | null
  members: readonly CommitteePdfMember[]
}

export interface PurchaseRequestCommitteePdfModel {
  headerLines: string[]
  groups: Array<{
    kind: PurchaseRequestCommitteeKind
    title: string
    members: Array<{ seat: number; name: string; positionTitle: string }>
  }>
}

const GROUP_ORDER: PurchaseRequestCommitteeKind[] = ['specification', 'result', 'inspection']
let fontBytesPromise: Promise<Uint8Array> | null = null

function loadFontBytes() {
  if (!fontBytesPromise) {
    const fontsDirectory = join(process.cwd(), 'node_modules', 'font-th-sarabun-new', 'fonts')
    fontBytesPromise = readFile(join(fontsDirectory, 'THSarabunNew-webfont.ttf'))
  }
  return fontBytesPromise
}

function formatBudget(value: number) {
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)
}

export function buildPurchaseRequestCommitteePdfModel(
  input: PurchaseRequestCommitteePdfInput,
): PurchaseRequestCommitteePdfModel {
  const variant = committeePdfVariant({ subjectName: input.subjectName, total: input.total })
  const headerLines = variant.kind === 'contract'
    ? [
        `เรื่อง ${variant.subjectName}`,
        ...(variant.budget !== null && variant.budget > 0 ? [`วงเงิน ${formatBudget(variant.budget)} บาท`] : []),
      ]
    : [
        'เอกสารแนบกรณีวิธีเฉพาะเจาะจง ฯ (ไม่เกิน 5 แสน)',
      ]

  const groups = GROUP_ORDER.flatMap((kind) => {
    const members = input.members
      .filter((member) => member.kind === kind)
      .sort((left, right) => left.seat - right.seat)
      .map((member) => ({
        seat: member.seat,
        name: formatProfileName(member.name, member.namePrefix),
        positionTitle: member.positionTitle?.trim() ?? '',
      }))
    return members.length > 0
      ? [{ kind, title: PR_COMMITTEE_KIND_LABELS[kind], members }]
      : []
  })

  return { headerLines, groups }
}

function drawCentered(pageWidth: number, text: string, y: number, font: PDFFont, size: number) {
  return { x: Math.max(48, (pageWidth - font.widthOfTextAtSize(text, size)) / 2), y }
}

function maxTextWidth(font: PDFFont, texts: readonly string[], size: number) {
  return Math.max(1, ...texts.map((text) => font.widthOfTextAtSize(text, size)))
}

function uniformTypography(model: PurchaseRequestCommitteePdfModel, font: PDFFont, pageWidth: number) {
  const preferredSize = 16
  const memberTexts = model.groups.flatMap((group) =>
    group.members.map((member, index) => `${index + 1}. ${member.name}`),
  )
  const positionTexts = model.groups.flatMap((group) =>
    group.members.map((member) => `ตำแหน่ง ${member.positionTitle}`),
  )
  const titleTexts = model.groups.map((group, index) => `${index + 1}. ${group.title}`)
  const nameMeasured = maxTextWidth(font, memberTexts, preferredSize)
  const positionMeasured = maxTextWidth(font, positionTexts, preferredSize)
  const availableColumnsWidth = pageWidth - 104 - 48 - 18
  const proportionalNameWidth = availableColumnsWidth * (nameMeasured / (nameMeasured + positionMeasured))
  const nameWidth = Math.min(240, Math.max(160, proportionalNameWidth))
  const positionWidth = availableColumnsWidth - nameWidth
  const scale = Math.min(
    1,
    (pageWidth - 96) / maxTextWidth(font, model.headerLines, preferredSize),
    (pageWidth - 134) / maxTextWidth(font, titleTexts, preferredSize),
    nameWidth / nameMeasured,
    positionWidth / positionMeasured,
  )

  return {
    fontSize: Math.max(1, preferredSize * scale),
    positionX: 104 + nameWidth + 18,
  }
}

export async function generatePurchaseRequestCommitteePdf(
  input: PurchaseRequestCommitteePdfInput,
): Promise<Uint8Array> {
  const model = buildPurchaseRequestCommitteePdfModel(input)
  if (model.groups.length === 0) throw new Error('ไม่มีรายชื่อคณะกรรมการสำหรับสร้าง PDF')
  if (model.groups.some((group) => group.members.some((member) => !member.name || !member.positionTitle))) {
    throw new Error('กรุณาระบุตำแหน่งบุคลากรของกรรมการให้ครบก่อนดาวน์โหลด PDF')
  }

  const document = await PDFDocument.create()
  document.registerFontkit(fontkit)
  const regular = await document.embedFont(await loadFontBytes(), { subset: true })
  const page = document.addPage([595.28, 841.89])
  const { width } = page.getSize()
  const ink = rgb(0.08, 0.09, 0.11)
  const typography = uniformTypography(model, regular, width)

  let headerY = model.headerLines.length > 1 ? 738 : 750
  model.headerLines.forEach((line) => {
    page.drawText(line, {
      ...drawCentered(width, line, headerY, regular, typography.fontSize),
      font: regular,
      size: typography.fontSize,
      color: ink,
    })
    headerY -= 30
  })

  let y = model.headerLines.length > 1 ? 610 : 625
  model.groups.forEach((group, groupIndex) => {
    const title = `${groupIndex + 1}. ${group.title}`
    page.drawText(title, { x: 67, y, font: regular, size: typography.fontSize, color: ink })
    y -= 34

    group.members.forEach((member, memberIndex) => {
      const memberText = `${memberIndex + 1}. ${member.name}`
      const positionText = `ตำแหน่ง ${member.positionTitle}`
      page.drawText(memberText, {
        x: 104,
        y,
        font: regular,
        size: typography.fontSize,
        color: ink,
      })
      page.drawText(positionText, {
        x: typography.positionX,
        y,
        font: regular,
        size: typography.fontSize,
        color: ink,
      })
      y -= 31
    })
    y -= 38
  })

  document.setTitle('รายชื่อคณะกรรมการใบ PR')
  document.setCreator('LABCBH Stock')
  document.setProducer('LABCBH Stock')
  return document.save()
}
