# Progressive Operations Dashboard Design

## Status

Approved direction: Progressive Operations Dashboard (A). The top area shown in the 2026-08-24 reference screenshot is locked and must remain visually and behaviorally unchanged.

## Goal

ทำให้ Dashboard บริหารสัญญารองรับการใช้งานจริงเมื่อข้อมูลเพิ่มขึ้น โดยยังคงความเร็วในการอ่านรายการเร่งด่วน, ไม่สร้าง scroll ซ้อน, ไม่ทำให้หน้าแรกหนักเกินจำเป็น และรักษาภาษา/visual world ของ Laboratory Control Bench เดิม

## Audience and operating modes

- **Admin/เจ้าหน้าที่คลัง:** เห็นภาพรวมทั้งหมดและดำเนินการกับคิวงานที่มีสิทธิ์ เช่น PR, รับเข้า, ใบเบิก, และรายการเตือนจากคลัง
- **Manager:** เห็นภาพรวมทั้งหมดแบบ read-only เพื่อประเมินสถานการณ์ แต่ action ที่เปลี่ยนข้อมูลเปิดเฉพาะรายการ/ขอบเขตที่ตนรับผิดชอบ
- ใช้ permission และ authorization ที่มีอยู่แล้วเป็นแหล่งตัดสินสิทธิ์ ไม่สร้าง role model ใหม่ในงานนี้

## Locked surface

คงส่วนบนตามภาพที่ผู้ใช้อนุมัติ:

- eyebrow `EXECUTIVE CONTROL BENCH`
- heading และคำอธิบายหน้า
- ปุ่ม `สร้างใบ PR` และ `สร้างใบเบิก` ในตำแหน่งและ visual hierarchy เดิม
- KPI cards `สัญญาใช้งานอยู่`, `ระหว่างดำเนินการ`, `มูลค่าสัญญารวม`, `มูลค่าคงเหลือในสัญญา`
- scope toggle `รวม / เช่า / อื่นๆ`

งานนี้ไม่ปรับข้อความ ขนาด ลำดับ สี หรือ interaction ของส่วนบน เว้นแต่จำเป็นต่อ responsive/accessibility ที่ไม่เปลี่ยนเจตนาเดิม

## Selected direction: Progressive Operations Dashboard

พื้นที่หลัง KPI ใช้โครงสร้างสองคอลัมน์แบบใน reference:

- **ซ้ายประมาณ 2/3:** Watchlist รายการตามสัญญาคงเหลือต่ำ
- **ขวาประมาณ 1/3:** สัญญาเช่าที่ต้องติดตาม และ Six-stage pipeline
- **ด้านล่างเต็มความกว้าง:** Contract Mix และลิงก์ไปทะเบียนสัญญา

Watchlist เริ่มแสดง 5 แถวแรกที่เรียงจาก remaining percentage ต่ำสุดตาม read model เดิม จากนั้นมี disclosure control ที่ชัดเจน:

- ปุ่ม `แสดงเพิ่มเติม` แสดงจำนวนที่เหลือ และเติมครั้งละ 10 แถวในพื้นที่เดิม
- ปุ่ม `ยุบรายการ` กลับไปเหลือ 5 แถวแรก
- เมื่อไม่มีแถวเพิ่ม ให้ซ่อนปุ่มและแสดงข้อความสรุป `แสดงครบแล้ว · แสดง N จาก N รายการ`
- ไม่ใช้ nested scroll ภายใน Watchlist; ความสูงของหน้าเพิ่มตามข้อมูล
- เมื่อ Watchlist ขยาย แผงด้านขวายังคงเริ่มจากขอบบนของส่วน operations และ Contract Mix อยู่หลัง operations ทั้งชุด

Row identity, balance track, remaining quantity และลิงก์ `เปิดสัญญา` ยังคงความหมายเดิม แต่ต้องคงการอ่านได้เมื่อชื่อยาว: desktop ใช้การ wrap ที่เหมาะสมโดยไม่ตัดข้อมูลสำคัญ และ mobile เปลี่ยนเป็น task card แนวตั้ง

## Interaction and state behavior

- เปิดหน้าแรกด้วย preview 5 แถวและแสดงจำนวนรายการทั้งหมด/จำนวนที่แสดง เพื่อให้ผู้ใช้รู้ว่ามีข้อมูลต่อ
- กด `แสดงเพิ่มเติม` แล้วรักษาตำแหน่ง scroll และย้าย focus ไปยังแถวแรกของ batch ใหม่อย่างสุภาพสำหรับ keyboard/screen reader
- ปุ่มและลิงก์ทุกตัวมีพื้นที่กดอย่างน้อย 44px, visible focus ring และ label ที่สื่อความหมายโดยไม่พึ่งสีอย่างเดียว
- Manager ยังคงเห็นชื่อและสถานะรายการทั่วทั้งระบบ แต่ action ที่ไม่มีสิทธิ์จะไม่ถูกเสนอเป็น primary action; ถ้าจำเป็นต้องแสดง จะมีข้อความ read-only ชัดเจนและไม่หลอกให้กด
- รองรับ loading ระหว่างขอ batch ใหม่, retry เมื่ออ่านข้อมูลไม่สำเร็จ, empty state เมื่อไม่มี watchlist และ `ไม่มีรายการเพิ่มเติม` เมื่ออ่านครบแล้ว
- Disclosure state ไม่เปลี่ยน metric หรือ sorting และเก็บใน query parameter `watchlist=expanded` ด้วย shallow URL replace เพื่อให้ back/forward และ deep link รักษาสถานะได้

## Data loading and scale contract

ข้อมูลสรุปบนส่วนบนยังมาจาก authenticated SSR read เดิม แต่การแสดง Watchlist ต้องมี boundary สำหรับ progressive loading:

- initial payload ส่ง preview 5 แถว พร้อม `totalCount` และ cursor/offset ที่ deterministic
- expansion อ่าน batch ถัดไปครั้งละ 10 แถวผ่าน authenticated server read path เดิม/RLS; ห้ามใช้ service-role ใน browser และห้ามคำนวณยอดใหม่ใน client effect
- sort ต้อง deterministic: `remainingPercent` ต่ำสุดก่อน ตามด้วย stable contract/item identifiers เพื่อไม่ให้รายการซ้ำหรือข้ามเมื่อโหลด batch
- realistic ranges: 0 รายการ (empty), 1–5 (preview เต็ม), 6–50 (ขยายได้หลาย batch), 51–500 (ต้องไม่ส่งทุกรายการใน first paint)
- data fetch failure ของ batch ต้องไม่ล้าง rows ที่โหลดสำเร็จแล้ว และต้องมี retry เฉพาะ batch
- component รับ read options ที่แยกจาก disclosure state เพื่อเพิ่ม URL filters ในอนาคต (ปีงบประมาณ, หน่วยงาน, ประเภทสัญญา, severity) โดยรอบนี้ยังไม่เพิ่ม filter UI และไม่ผูก component กับ hard-coded จำนวนข้อมูล

## Responsive layout

- Desktop: ใช้ named layout/column contract ที่ทำให้ขนาด Watchlist เติบโตตามเนื้อหาโดยไม่ทำให้แผงขวากระโดด
- Tablet: ลดเป็นหนึ่งคอลัมน์ตาม breakpoint เดิม โดยเรียง Watchlist → Lease watchlist → Pipeline → Contract Mix
- Mobile: แต่ละ row เป็น card; identity, remaining value, progress, flags และ action อยู่ในลำดับอ่านเดียวกัน; ไม่มี horizontal page overflow
- รักษา 4/8px spacing rhythm, Noto Sans Thai สำหรับข้อความ และ DM Mono เฉพาะ identifiers/tabular figures

## Scope boundaries

รวม:

- progressive disclosure และ responsive presentation ของ Watchlist
- scalable read boundary สำหรับการโหลด batch
- permission-aware action presentation บน Dashboard
- loading/empty/error/no-more states และ keyboard/focus behavior
- targeted CSS/component refactor ที่จำเป็นกับหน้า Dashboard และชุดทดสอบที่เกี่ยวข้อง

ไม่รวม:

- การเปลี่ยนส่วนบนที่ผู้ใช้อนุมัติแล้ว
- การเปลี่ยนสูตรยอดสัญญา, threshold ต่ำกว่า 30%, lease budget logic หรือ procurement stage logic
- การเพิ่ม minimum-stock/lot/PR/requisition queues ใหม่จาก approved product spec เดิมในรอบนี้; จะเว้น extension points ไว้สำหรับรอบถัดไป
- การเปลี่ยน role, RLS policy, หรือ workflow mutation

## Verification contract

- static/UI tests ยืนยันว่า top surface เดิมยังอยู่, preview/batch/disclosure states ครบ และ role copy ไม่ทำให้ Manager เห็น mutation ที่ไม่มีสิทธิ์
- `npm run typecheck`
- `npm run lint`
- focused dashboard tests และ Playwright smoke ที่ 1440px, 1024px และ 375px โดยทดสอบ 0, 5, 6 และ 50+ watchlist rows
- ตรวจ keyboard focus, reduced motion, contrast, 44px targets และ no horizontal overflow
- หลัง UI implementation ให้รัน Impeccable detector หนึ่งครั้งกับไฟล์ที่เปลี่ยน ตาม `context.mjs` directive

## Design decision

ใช้ Progressive Operations Dashboard เป็น baseline สำหรับ implementation: ส่วนบนคงเดิม, ส่วน operations ขยายตามข้อมูล, disclosure แบบ 5 + 10, no nested scroll, และ read boundary ที่รองรับข้อมูลจำนวนมากตั้งแต่แรก
