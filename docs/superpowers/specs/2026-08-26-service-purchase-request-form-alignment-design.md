# Service Purchase Request Form Alignment Design

## Goal

ทำให้ฟอร์มสร้างใบ PR (งานจ้าง) ใช้ภาษาโครงสร้างและ interaction เดียวกับ `/purchase-requests/new` โดยคง business rules, payload และ server action ของงานจ้างไว้เหมือนเดิม

## Evidence and problem

`ServicePurchaseRequestForm` เป็น JSX ก้อนเดียวที่ใช้ class `service-*` เฉพาะหน้า จึงไม่ได้ใช้ pattern สำคัญของ `PurchaseRequestForm`: `ThaiDateInput`, `field-row`, `ContractItemPicker`, การแยก `SELECT ITEMS`/`REQUEST LINES`, `StickyScroll`, mobile line cards และ checklist content regions ผลคือ search field ไม่มี inset, selected table มี `min-width: 700px` โดยไม่มี mobile fallback และ sticky action bar บังช่องกรอกตามภาพที่แนบมา

## Design

1. **Request header** ใช้โครง panel และ `field-row` ของ PR เดิม: หน่วยงาน/ชื่อผู้ขอในแถวแรก วันที่ขอ/หมายเหตุในแถวที่สอง และใช้ `ThaiDateInput` เพื่อให้วันที่และการแสดงผลเป็นภาษาไทยสอดคล้องกัน
2. **Plan & method** ยังคงเลือกแผน, วิธีจัดซื้อ, วงเงิน และเดือนทำ PO ตาม service workflow แต่จัดกลุ่มเป็น decision panel พร้อม budget callout ที่มี `role="status"`/`role="alert"`
3. **Select items** ใช้ `ContractItemPicker` ในโหมด service ที่ซ่อน facts ที่ไม่เกี่ยวกับงานจ้าง แต่คง search states, result rows, manual item validation, minimum touch targets และ spacing เดิมไว้ โดยเพิ่มราคาต่อหน่วยของ manual itemเป็น optional fieldใน mode นี้
4. **Request lines** แยกเป็น panel ใหม่ ใช้ desktop table ที่ครอบด้วย `StickyScroll`, total summary และ mobile editable cards ตามโครง `PurchaseRequestForm`; ไม่มี page-level horizontal overflow
5. **Checklist** แยก file attachments และ committee groups ด้วย interior wrappers ที่ align กับ panel header, required markers, `min-width: 0` และ responsive one-column fallback โดยไม่เปลี่ยนชื่อ field หรือ validation ของ service action
6. **Action bar** อยู่ท้ายฟอร์มด้วย summary ของจำนวนรายการ/ยอดรวมและสถานะ loading/error; เพิ่มพื้นที่ท้ายฟอร์มและ scroll margin เพื่อไม่ให้ sticky bar บัง controls ที่กำลังแก้ไข

## Boundaries

- ไม่เปลี่ยน `createServicePurchaseRequest`, payload shape, service schema, authorization หรือ route
- ไม่เปลี่ยน semantics ของ `annual_items` และ `laboratory_testing`
- ใช้ design tokens และ class family เดิมใน `app/globals.css`; ไม่เพิ่ม inline styles หรือ dependency
- ยังคง copy ภาษาไทยเดิม ยกเว้นข้อความช่วยเหลือ/empty/error ที่จำเป็นต่อการทำงานของ control

## Acceptance criteria

- Header, plan/method, item picker, request lines และ checklist มี hierarchy และ horizontal inset เดียวกับ `/purchase-requests/new`
- Search, empty, result, manual-add, selected-line และ submit states มี visible labels และ feedback
- ที่ 375px ไม่มี horizontal page overflow; selected lines ใช้ cards และ action buttons มี target อย่างน้อย 44px
- ที่ desktop ตารางรายการอยู่ใน scroll container และ sticky action bar ไม่บดบัง content ที่ focus อยู่
- Existing service domain/action tests และ PR UI tests ผ่าน; เพิ่ม source-level regression assertions สำหรับ shared structure

## Verification

- TDD: เพิ่ม assertions ใน `scripts/service-procurement-ui.test.ts`, รันให้ fail ก่อน implementation แล้วรันให้ pass
- รัน `npm run test:service-procurement`, `npm run typecheck`, `npm run lint`, `npm run build`
- รัน Impeccable detector แบบ layout กับ changed targets และตรวจ rendered desktop/mobile อย่างน้อยหนึ่งรอบ
