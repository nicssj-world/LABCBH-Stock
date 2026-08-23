# PR Stock Officer Workbench Design

## Goal

ทำให้ส่วน “การดำเนินการของเจ้าหน้าที่คลัง” อ่านเป็นลำดับงานเดียวกัน ลดช่องว่างที่ทำให้ผู้ใช้ต้องไล่สายตา และทำให้เหตุผลที่ยืนยันไม่ได้อยู่ใกล้กับปุ่มยืนยัน โดยคง business logic, permission, mutation และข้อมูลเดิมทั้งหมด

## Design direction

ใช้โครงแบบ operational flow ที่สอดคล้องกับ `LABCBH Stock` ในโหมด Operate และแนวคิด “Laboratory Control Bench”:

1. **ตรวจเอกสารและกรรมการ** — toolbar ภาษาไทย, เรียงไฟล์หลักก่อนใบเสนอราคา, และมีหัวข้อกลุ่มกรรมการที่ชัดเจน
2. **ข้อมูลอ้างอิง** — จัดเลข PR จาก E-Phis พร้อมปุ่มบันทึก/แก้ไขให้อยู่ในแถวเดียวกันบน desktop และเรียงเป็นแนวตั้งบน mobile
3. **ผลกระทบต่อยอดสัญญา** — คำอธิบายกับตารางอยู่ใน working region เดียวกัน ใช้ตัวเลขแบบ tabular เดิม
4. **ยืนยันใบ PR** — แยกเป็น action zone เดียว ปุ่มหลักอยู่ชิดขวาบน desktop และเต็มความกว้างบน mobile; blocker แสดงเหนือปุ่ม พร้อมข้อความสาเหตุและวิธีแก้

ไม่ใช้ตัวเลขวงกลมหรือ decorative icon, ไม่เพิ่ม card ซ้อน card, ไม่เปลี่ยนสิทธิ์หรือเงื่อนไขการยืนยัน และไม่เพิ่ม animation ที่ไม่สื่อความหมาย

## Content and interaction

- เปลี่ยนข้อความปุ่มดาวน์โหลดใน checklist เป็นภาษาไทยให้สอดคล้องกับพื้นที่เดียวกัน (`ดาวน์โหลดทั้งหมด`, `ดาวน์โหลด PDF กรรมการ`)
- ปุ่มยืนยันยัง disabled ตาม `checklistReadyForConfirmation` เดิม แต่ผู้ใช้จะเห็น blocker ก่อนถึงปุ่ม
- สถานะ loading/error ของ mutation เดิมต้องคงอยู่และยังประกาศผ่าน `role`/`aria-live` ตาม pattern ปัจจุบัน
- การเรียงไฟล์ในรายละเอียดใช้ลำดับ `TOR`, `แผนรายการ`, `ใบเสนอราคา` โดยไม่เปลี่ยนข้อมูลหรือ API

## Responsive behavior

- กว้าง: section header และ content ใช้แถวเดียวเมื่ออ่านได้; identifier row เป็น label/input + action
- กลาง: ลดเป็นหนึ่งคอลัมน์เฉพาะกลุ่มที่เริ่มแคบ และคง padding/target อย่างน้อย 44px
- มือถือ: ทุก working region เป็นหนึ่งคอลัมน์, ปุ่ม action กว้างเต็มพื้นที่, ตารางยังอยู่ใน container ที่เลื่อนได้ตาม pattern เดิม

## Verification

- เพิ่ม source/render contract สำหรับ heading order, Thai download labels, blocker placement, identifier row และ breakpoint rules
- รัน focused PR UI tests, typecheck, lint, build และ `npm run verify`
- รัน Impeccable detector หนึ่งครั้งหลัง UI เสร็จ
