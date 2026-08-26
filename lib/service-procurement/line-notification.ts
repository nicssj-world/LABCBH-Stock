import type { LineFlexMessage } from '@/lib/line/client'

export interface ServicePurchaseRequestLineNotificationSnapshot {
  attemptId: string
  retryKey: string
  targetGroupId: string
  documentUrl: string
  documentNumber: string
  department: string
  requesterName: string | null
  poNumber: string
  poFileName: string
  poFileChecksum: string | null
  itemCount: number
  total: number
}

function money(value: number): string {
  return `฿${value.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function row(label: string, value: string): Record<string, unknown> {
  return {
    type: 'box',
    layout: 'horizontal',
    spacing: 'sm',
    contents: [
      { type: 'text', text: label, color: '#6b7280', size: 'sm', flex: 0 },
      { type: 'text', text: value, color: '#111827', size: 'sm', align: 'end', wrap: true, flex: 1 },
    ],
  }
}

export function buildServicePurchaseRequestLineFlexMessage(
  snapshot: ServicePurchaseRequestLineNotificationSnapshot,
): LineFlexMessage {
  return {
    type: 'flex',
    altText: `PO ${snapshot.poNumber} สำหรับใบ PR งานจ้าง ${snapshot.documentNumber}`,
    contents: {
      type: 'bubble',
      size: 'kilo',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#0f766e',
        paddingAll: '16px',
        contents: [
          { type: 'text', text: 'ใบสั่งซื้อ งานจ้าง', color: '#ccfbf1', size: 'sm' },
          { type: 'text', text: 'พร้อมดำเนินการ', color: '#ffffff', weight: 'bold', size: 'lg', wrap: true, margin: 'sm' },
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        paddingAll: '16px',
        contents: [
          row('เลข PR', snapshot.documentNumber),
          row('เลข PO', snapshot.poNumber),
          row('หน่วยงาน', snapshot.department),
          row('ผู้ขอ', snapshot.requesterName ?? 'ไม่ระบุ'),
          row('จำนวนรายการ', `${snapshot.itemCount} รายการ`),
          row('วงเงิน PR', money(snapshot.total)),
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '12px',
        contents: [{
          type: 'button',
          style: 'primary',
          color: '#0f766e',
          action: { type: 'uri', label: 'เปิดใบ PR งานจ้าง', uri: snapshot.documentUrl },
        }],
      },
    },
  }
}
