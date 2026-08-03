import type { GoodsReceiptStatus } from './schema'

export const GOODS_RECEIPT_STATUS_LABELS: Record<GoodsReceiptStatus, string> = {
  draft: 'ฉบับร่าง',
  posted: 'บันทึกเข้าคลังแล้ว',
  cancelled: 'ยกเลิก',
}

export const GOODS_RECEIPT_STATUS_TONES: Record<GoodsReceiptStatus, 'attention' | 'success' | 'danger'> = {
  draft: 'attention',
  posted: 'success',
  cancelled: 'danger',
}
