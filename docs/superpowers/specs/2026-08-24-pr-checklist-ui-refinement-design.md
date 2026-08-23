# PR Checklist UI Refinement Design

## Goal

ทำให้ส่วน checklist เอกสารและรายชื่อกรรมการในฟอร์ม PR สื่อ affordance ชัดขึ้น ใช้งานลากไฟล์ได้จริง และอ่านง่ายขึ้นโดยไม่เปลี่ยนกติกาการตรวจสอบหรือการอัปโหลดเดิม

## Scope

- ปรับเฉพาะ `components/pr/PurchaseRequestChecklistFields.tsx` และสไตล์ `.pr-checklist*` ใน `app/globals.css`
- ช่องเอกสารแต่ละรายการรองรับ drag & drop ไฟล์หนึ่งไฟล์, click-to-select และ keyboard activation
- คงชนิดไฟล์, ขนาดสูงสุด 20 MB, error message และ callback `onFileChange` เดิม
- ปรับ committee combobox ให้มีกรอบ, padding, focus state และตำแหน่ง helper text ที่อ่านง่าย
- รักษา responsive layout เดิม: สองคอลัมน์บน desktop และหนึ่งคอลัมน์บนหน้าจอแคบ

## Interaction design

แต่ละรายการเอกสารจะมี dropzone แบบเส้นประเต็มพื้นที่ action โดยมีข้อความและ hint ชนิดไฟล์อยู่ในพื้นที่เดียวกัน ปุ่ม/label file input ยังคงเป็น fallback สำหรับผู้ใช้ที่ไม่ลากไฟล์ เมื่อ drag เข้า dropzone จะมี state สีหลักและข้อความที่ช่วยยืนยันตำแหน่งวาง; เมื่อแนบสำเร็จจะแสดงชื่อไฟล์และสถานะ complete ตาม logic เดิม

Dropzone จะรับไฟล์แรกจาก `DataTransfer.files`, ป้องกัน browser เปิดไฟล์โดยอัตโนมัติ, และไม่ผูกการใช้งานไว้กับ hover อย่างเดียว ผู้ใช้คีย์บอร์ดยังคง tab ไปยัง input และกด Enter/Space เพื่อเปิด file picker ได้

## Visual design

ยึด design tokens ของ Laboratory Control Bench: surface ขาว, border cool blue-gray, primary blue สำหรับ focus/drag state, radius 10–12px และ spacing ตาม 4/8px rhythm การ์ดและ fieldset เพิ่ม horizontal padding เพื่อไม่ให้ข้อความชิดขอบ ช่องค้นหากรรมการสูงอย่างน้อย 44px มี border ชัดเจน, padding ซ้าย–ขวา 12px และ focus ring 3px ที่มี contrast เพียงพอ

## Verification

- `npm run typecheck`
- `npm run lint`
- `node C:\Users\User\.agents\skills\impeccable\scripts\detect.mjs --json components/pr/PurchaseRequestChecklistFields.tsx app/globals.css`
- ตรวจด้วยชุด UI test เดิมของ PR checklist เพื่อยืนยัน callback/validation ไม่เปลี่ยน
