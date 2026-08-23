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
}

export function formatPurchaseRequestMutationError(operation: string, message: string): string {
  return `${operation} ไม่สำเร็จ: ${PURCHASE_REQUEST_ERROR_COPY[message] ?? message}`
}
