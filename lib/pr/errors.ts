const PURCHASE_REQUEST_ERROR_COPY: Record<string, string> = {
  'allocation exceeds contracted quantity':
    'ยอดคงเหลือในสัญญาไม่พอสำหรับจำนวนที่ขอ อาจมี PR อื่นถูกยืนยันไปแล้ว',
  'purchase request quantity exceeds contract remaining after pending reservations':
    'จำนวนที่ขอรวมกับ PR ที่รอยืนยันเกินจำนวนคงเหลือในสัญญา',
  'contract item quantity cannot be below committed or pending reservations':
    'จำนวนในสัญญาต่ำกว่ายอดที่ใช้หรือจองไว้แล้ว',
  'only a confirmed purchase request can be received outside stock':
    'รับของโดยหน่วยงานได้เฉพาะใบ PR ที่ยืนยันแล้ว',
  'only a purchase-order request can be received outside stock':
    'รับของโดยหน่วยงานได้เฉพาะใบ PR ที่ออก PO',
  'cancel the open or posted goods receipt before receiving outside stock':
    'ใบ PR นี้มีใบรับเข้าคลังอยู่แล้ว กรุณายกเลิกฉบับร่างหรือใช้ขั้นตอนรับเข้าคลังให้เสร็จ',
  'a purchase request with posted goods receipts cannot be reversed':
    'PR นี้มีใบรับเข้าแล้ว จึงยกเลิกไม่ได้',
  'cancel the open draft goods receipt before reversing the purchase request':
    'กรุณายกเลิกใบรับเข้าฉบับร่างก่อน แล้วจึงยกเลิก PR นี้',
  'releasing a purchase order number requires a reason':
    'กรุณาระบุเหตุผลที่ปลดเลข PO',
  'only a cancelled or reversed purchase request can release its purchase order number':
    'ปลดเลข PO ได้เฉพาะ PR ที่ยกเลิกแล้ว',
  'purchase request has no purchase order number to release':
    'ใบ PR นี้ไม่มีเลข PO ให้ปลด',
  'purchase order number has already been released':
    'เลข PO นี้ถูกปลดไปแล้ว',
  'cannot release a purchase order number after a PO file was attached':
    'ไม่สามารถปลดเลข PO ได้ เนื่องจากมีการแนบเอกสาร PO แล้ว',
  'cannot release a purchase order number while a goods receipt is active':
    'ไม่สามารถปลดเลข PO ได้ เนื่องจากมีใบรับเข้าที่ยังมีผลอยู่ กรุณาตรวจสอบหรือยกเลิกใบรับเข้าก่อน',
  'cannot release a purchase order number after a LINE notification was attempted':
    'ไม่สามารถปลดเลข PO ได้ เนื่องจากมีประวัติส่งแจ้งเตือน LINE แล้ว',
}

export type PurchaseRequestActionError = {
  ok: false
  message: string
}

export function isPurchaseRequestActionError(value: unknown): value is PurchaseRequestActionError {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return candidate.ok === false && typeof candidate.message === 'string'
}

export function formatPurchaseRequestMutationError(operation: string, message: string): string {
  const copy = message.toLowerCase().includes('purchase_requests_po_number_key')
    ? 'เลขที่ใบสั่งซื้อ (PO) นี้ถูกใช้กับใบ PR อื่นแล้ว ไม่สามารถใช้เลขซ้ำได้ กรุณาตรวจสอบเลข PO'
    : PURCHASE_REQUEST_ERROR_COPY[message] ?? message
  return `${operation} ไม่สำเร็จ: ${copy}`
}
