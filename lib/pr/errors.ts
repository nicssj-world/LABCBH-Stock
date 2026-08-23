const PURCHASE_REQUEST_ERROR_COPY: Record<string, string> = {
  'allocation exceeds contracted quantity':
    'ยอดคงเหลือในสัญญาไม่พอสำหรับจำนวนที่ขอ อาจมี PR อื่นถูกยืนยันไปแล้ว',
  'purchase request quantity exceeds contract remaining after pending reservations':
    'จำนวนที่ขอรวมกับ PR ที่รอยืนยันเกินจำนวนคงเหลือในสัญญา',
  'contract item quantity cannot be below committed or pending reservations':
    'จำนวนในสัญญาต่ำกว่ายอดที่ใช้หรือจองไว้แล้ว',
}

export function formatPurchaseRequestMutationError(operation: string, message: string): string {
  return `${operation} ไม่สำเร็จ: ${PURCHASE_REQUEST_ERROR_COPY[message] ?? message}`
}
