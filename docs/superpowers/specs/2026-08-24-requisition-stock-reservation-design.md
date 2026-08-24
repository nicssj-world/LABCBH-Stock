# ใบเบิกกันยอดคงคลัง — Design Spec

## เป้าหมาย

เมื่อสร้างหรือแก้ไขใบเบิก ระบบต้องกันยอดรายการที่อยู่ในสถานะ `รอจ่าย` ทันที เพื่อไม่ให้ใบเบิกหลายใบจองของก้อนเดียวกันได้ ใบที่จ่ายแล้วหรือยกเลิกแล้วต้องไม่กินยอดที่พร้อมให้ใบใหม่ใช้

## ผู้ใช้และผลลัพธ์

- ผู้ขอเบิกเห็นยอดที่ยังเบิกได้จริงหลังหักใบเบิกที่รอจ่าย และไม่สามารถส่งจำนวนเกินยอดนั้นได้
- เจ้าหน้าที่คลังยังเป็นผู้เลือกล็อตและจ่ายจริงตาม FIFO; reservation ไม่ตัดบัญชี stock ก่อนการจ่าย
- ระบบปฏิเสธการสร้าง/แก้ไขแบบ atomic เมื่อยอดไม่พอ แม้มีผู้ใช้อีกคนกำลังทำรายการพร้อมกัน
- การยกเลิกหรือการจ่ายเปลี่ยนสถานะใบเบิก จึงคืนหรือใช้ reservation โดยไม่ต้องแก้ stock ledger ย้อนหลัง

## โมเดลข้อมูลที่เลือก

ไม่เพิ่มตาราง reservation แยก ใบเบิกที่มีสถานะ `waiting` เป็น reservation โดยนัย:

```text
ยอดพร้อมกันใบใหม่ = ยอดล็อตที่ยังใช้ได้
                    − SUM(requested_quantity ของ requisition_items ที่อยู่ใน waiting)
```

ยอดล็อตที่ยังใช้ได้ต้องมี balance มากกว่า 0 และยังไม่หมดอายุ ณ `public.lab_stock_today()`. ยอด `on_hand` ทางกายภาพยังคงอ่านจาก `stock_movements` เหมือนเดิม และ reservation ไม่เขียน `requisition_issue` movement.

## Transaction และ concurrency

`create_requisition`, `update_requisition`, `cancel_requisition` และ `fulfill_requisition` ต้องล็อกแถว `inventory_items` ของรายการที่เกี่ยวข้องตาม `id` เรียงลำดับเดียวกันก่อนตรวจหรือเขียนข้อมูล เพื่อให้คำขอที่แตะรายการเดียวกัน serialise กันและไม่ overbook.

- สร้าง: ล็อก inventory items → ตรวจ usable stock หัก waiting reservations → insert requisition/items
- แก้ไข: ล็อก requisition และ inventory items ของชุดเก่า+ใหม่ → ตรวจชุดใหม่โดยไม่หัก reservation ของใบตัวเอง → replace items
- ยกเลิก: ล็อก requisition และ inventory items → เปลี่ยนเป็น `cancelled`; waiting reservation หายจากสูตรทันที
- จ่าย: ล็อก requisition และ inventory items → ล็อกล็อตที่เลือก → ตรวจ/เขียน issue movement → เปลี่ยนเป็น `fulfilled`

Reservation เป็น item-level ไม่ผูกล็อตล่วงหน้า เพื่อให้เจ้าหน้าที่คลังยังเลือกล็อตจริงตาม FIFO ณ เวลาจ่ายได้ ล็อตที่เลือกยังถูกตรวจ balance, expiry และ FIFO guard ใน RPC เดิม

## Query และ UI

- เพิ่ม security-invoker view สำหรับ `usable_on_hand`, `waiting_reserved` และ `available_to_request`
- catalog ใบเบิกใช้ `available_to_request` เป็นตัวกรองและแสดงยอดที่ผู้ใช้จองได้จริง
- ช่องจำนวนมี `max` ตามยอด available ที่อ่านมา และแสดง blocker แบบรายบรรทัดเมื่อเกิน
- server RPC เป็น source of truth; ถ้ายอดเปลี่ยนระหว่างเปิดฟอร์ม ให้แสดง error ใกล้ action และให้ผู้ใช้ refresh/แก้จำนวน
- ลบ `รวมที่ขอ` จาก list/detail/summary dialog เพราะหน่วยต่างกัน
- เปลี่ยนข้อความช่วยเหลือจาก “ยอดยังไม่ถูกตัดจนกว่าจะจ่ายจริง” เป็น “ระบบกันยอดไว้ระหว่างรอจ่าย และตัดยอดจริงเมื่อเจ้าหน้าที่คลังจ่าย”

## Legacy และ edge cases

- ใบ `waiting` ที่มีอยู่ก่อน migration นับเป็น reservation โดยสูตรใหม่ทันที ไม่ต้องเขียน movement ย้อนหลัง
- ใบเก่าที่รวมกันเกินยอดจะยังอ่านได้ แต่ใบใหม่/การแก้ไขที่ทำให้ overbook จะถูกปฏิเสธจนกว่ายอดจะคลาย
- วันที่หมดอายุใช้ Bangkok business date เดียวกับ FIFO guard
- ยกเลิก/แก้ไขหลัง `fulfilled` ยังถูกปฏิเสธตามกฎ append-only เดิม

## Acceptance criteria

1. สร้างใบสองใบพร้อมกันสำหรับรายการเดียวกันไม่ได้ถ้ายอดรวมเกิน usable stock
2. ใบ `waiting` ลด `available_to_request`; ใบ `cancelled` และ `fulfilled` ไม่ลดยอด
3. แก้ไขใบต้อง re-check ยอดแบบ atomic และไม่หัก reservation เก่าของใบตัวเองซ้ำ
4. จ่ายจริงยังเขียน stock movement เพียงครั้งเดียวและไม่ทำให้ lot balance ติดลบ
5. UI ไม่ให้เลือก item ที่ available เป็นศูนย์ และไม่ให้ส่งจำนวนเกินยอด available ที่แสดง
