# Annual Plans and Stock Officer Module Design

## Goal

เพิ่มโมดูลหลัก `แผนประจำปี` สำหรับเก็บและเผยแพร่ PDF แผนจัดซื้อ/แผนจัดจ้างตามปีงบประมาณ และจัดกลุ่มงาน `เจ้าหน้าที่คลัง` ให้เป็นพื้นที่จัดการสิทธิ์ผู้ใช้งาน โดยรักษาโครงสร้างการทำงานและ visual language ของ LABCBH Stock เดิม

ฟีเจอร์นี้ต้องทำให้ผู้ใช้ทั่วไปเปิดดูและดาวน์โหลดแผนได้จากหน้าเดิม ขณะที่ `admin` และ `stock_officer` อัปโหลดหรือแทนที่ไฟล์ได้ และระบบ hard delete ไฟล์ที่พ้นช่วงเก็บรักษา

## Approved decisions

- โมดูล `แผนประจำปี` เป็นเมนูหลักถัดจาก `Dashboard`
- กลุ่ม `เจ้าหน้าที่คลัง` แสดงเฉพาะ `admin` และ `stock_officer`
- `สิทธิ์ผู้ใช้งาน` เป็นเมนูย่อยของ `เจ้าหน้าที่คลัง`
- `admin` จัดการ role ได้ทุกชนิด
- `stock_officer` จัดการได้เฉพาะ `head`, `stock_officer` และ `viewer`; ห้ามมอบหรือถอน `admin`
- แผนมี 2 ประเภท: แผนจัดซื้อ และแผนจัดจ้าง
- แสดงและอัปโหลดได้ 2 ปีงบประมาณ: ปีปัจจุบันและปีก่อนหน้า
- ปี/ประเภทเดียวกันมีไฟล์ใช้งานได้ 1 ไฟล์; การอัปโหลดซ้ำแทนที่ไฟล์เดิม
- รับเฉพาะ PDF และเปิดดูภายในหน้าเดิมได้
- ไฟล์และรายการเอกสารที่พ้นช่วง 2 ปีถูก hard delete; ไม่ใช้ถังขยะหรือ `deleted_at`
- audit log ของการเปลี่ยนแปลงเก็บไว้เพื่อการตรวจสอบย้อนหลัง แต่ไม่เก็บเนื้อหาไฟล์เดิม

## Design direction

ใช้โหมด Operate และโลกภาพ `Laboratory Control Bench` ที่มีอยู่แล้ว:

1. **เรียบและตรวจสอบได้** — ใช้พื้นผิว flat, เส้นแบ่งบาง, Noto Sans Thai และ semantic accent เดิม ไม่เพิ่ม gradient หรือ decorative dashboard
2. **เอกสารเป็น working set** — แสดง 2 ปีงบประมาณแบบเรียงลำดับจากปัจจุบันไปอดีต และให้แต่ละแผนมีพื้นที่ทำงานของตัวเอง
3. **การอัปโหลดต้องมีทางเลือกที่เข้าถึงได้** — drag & drop เป็น affordance หลัก แต่มีปุ่มเลือกไฟล์และการใช้งานด้วยคีย์บอร์ดเสมอ
4. **สีไม่ใช่ความหมายเพียงอย่างเดียว** — สถานะทุกแบบมีข้อความและ icon/label กำกับ; สีเขียว/amber/red ใช้เฉพาะ success, attention และ error
5. **การเปิดเอกสารคงบริบท** — ใช้ dialog ภายในหน้าเดิม พร้อมปุ่มดาวน์โหลด/เปิดแท็บใหม่และเส้นทางปิดที่ชัดเจน

## Navigation and authorization

### Navigation structure

แก้ `components/ui/AppShell.tsx` ให้มีลำดับเชิงโครงสร้างดังนี้:

```text
Dashboard
แผนประจำปี
สัญญา
ใบ PR
รับเข้า
เบิกจ่าย
คงคลัง
Out Lab

เจ้าหน้าที่คลัง
└── สิทธิ์ผู้ใช้งาน
```

`เจ้าหน้าที่คลัง` เป็นกลุ่มเมนูที่มี child item และต้องคงการทำงานของ sidebar แบบ collapsed/mobile เดิมไว้ โดย child มี accessible label และ active state เมื่ออยู่ที่ `/settings/access`

### Permission boundaries

- `app/(protected)/annual-plans/page.tsx` ให้ active LAB Stock users ทุก role เข้าอ่านได้
- การอัปโหลด/แทนที่ใช้ `canOperateStock(actor)` ซึ่งยอมรับ `admin` และ `stock_officer`
- `/settings/access` อนุญาต `admin` และ `stock_officer`
- `listMemberships` และ `setMembership` ต้องตรวจ actor ฝั่ง server ด้วย helper ใหม่หรือ helper ที่ปรับชื่อให้สื่อว่าเป็น membership manager
- PostgreSQL RPC ต้องตรวจ actor ซ้ำ โดยไม่เชื่อผลจาก UI หรือ Server Action
- เมื่อ actor เป็น `stock_officer` และ `p_role = 'admin'` ต้อง reject ด้วย permission error
- intrinsic `admin` ของ E-Phis `9495` และ intrinsic `head` จาก Portal Manager ยังคงแสดงเป็น read-only ตามพฤติกรรมเดิม
- Access matrix ให้ `stock_officer` แก้ toggle ของ `head`, `stock_officer`, `viewer` ได้ และแสดงช่อง `admin` เป็น read-only พร้อมข้อความ `สงวนสิทธิ์สำหรับผู้ดูแลระบบ`

## Annual plans experience

### Page structure

หน้า `/annual-plans` ใช้ `route-stack` และ `page-heading` เดิม:

- eyebrow: `ANNUAL PLANS`
- heading: `แผนประจำปี`
- helper: อธิบายว่าเก็บเฉพาะปีงบประมาณปัจจุบันและย้อนหลัง 1 ปี
- status summary ขนาดกะทัดรัดบอกจำนวนช่องที่มีเอกสารของแต่ละปี โดยไม่ยกตัวเลขให้เด่นกว่ารายการที่ต้องทำ

เอกสารแสดงเป็น 2 ส่วน:

```text
ปีงบประมาณ {current}
  [ แผนจัดซื้อ ] [ แผนจัดจ้าง ]

ปีงบประมาณ {previous}
  [ แผนจัดซื้อ ] [ แผนจัดจ้าง ]
```

Desktop ใช้ 2 คอลัมน์ต่อปี; ที่ความกว้างเล็กลงและบน mobile เรียงเป็น 1 คอลัมน์โดยไม่มี horizontal scroll

### Plan card states

แต่ละ card แสดงประเภทแผน ปีงบประมาณ และหนึ่งในสถานะต่อไปนี้:

- **มีไฟล์แล้ว** — ชื่อไฟล์, ขนาด, วันที่/เวลาอัปโหลด, ผู้อัปโหลด, ปุ่ม `เปิดดู`, `ดาวน์โหลด` และสำหรับ operator ปุ่ม `แทนที่ไฟล์`
- **ยังไม่มีไฟล์** — operator เห็น dropzone; ผู้ใช้ทั่วไปเห็นข้อความว่าเอกสารยังไม่ถูกอัปโหลด
- **กำลังอัปโหลด** — card หรือ dropzone แสดง progress/indicator, ปุ่มที่ชนกัน disabled และสถานะประกาศผ่าน `aria-live`
- **อัปโหลดสำเร็จ** — แสดง success feedback แล้ว refresh metadata ของ card
- **อัปโหลดไม่สำเร็จ** — error อยู่ใต้ card พร้อมเหตุผลและปุ่ม/ทางเลือก retry; ใช้ `role="alert"`

### Upload interaction

`AnnualPlanUploadDropzone` ใช้ native file input ที่มี label มองเห็นได้และรับ `accept="application/pdf"`:

- dragenter/dragover แสดง focus/active state โดยไม่เปลี่ยน layout bounds
- click, keyboard activation และ drag & drop เรียก validation เดียวกัน
- validate ชนิดไฟล์, ชื่อไฟล์, ขนาด และ PDF signature ฝั่ง client เพื่อ feedback เร็ว
- validate ซ้ำใน Server Action ก่อน Storage write; Server Action ถือเป็น public endpoint
- เมื่อมีไฟล์เดิม ต้องแสดงข้อความยืนยันว่าไฟล์เดิมจะถูกแทนที่
- ไม่เพิ่มปุ่มลบเอกสารทั่วไปใน scope นี้; การลบเกิดจากการแทนที่หรือ retention policy เท่านั้น

### PDF preview and download

`AnnualPlanPreviewDialog` ใช้ pattern `.app-dialog` เดิม:

- เปิดด้วยปุ่ม `เปิดดู` และจัด focus ไปยัง dialog/heading
- แสดง PDF ในพื้นที่อ่านเอกสารด้วย signed URL แบบ inline
- มีปุ่ม `ดาวน์โหลด`, `เปิดแท็บใหม่` และ `ปิด`
- ปิดด้วยปุ่ม, Escape และ cancel route ของ dialog โดยไม่ทำให้ผู้ใช้หลุดจากหน้าแผน
- หาก browser ไม่ render PDF ให้มี fallback link เปิดแท็บใหม่/ดาวน์โหลด
- signed URL มีอายุสั้นและสร้างได้เมื่อผู้ใช้ที่ผ่าน authentication ขอเท่านั้น

## Data model and storage lifecycle

### Tables and stable values

เพิ่ม migration ใหม่ตาม convention ของ repository:

`public.lab_stock_annual_plans`

- `id uuid primary key`
- `fiscal_year integer not null` พร้อม check ช่วงปีเดียวกับข้อมูลระบบ
- `plan_type text not null` check เป็น `procurement` หรือ `hiring`
- `file_path text not null`
- `file_name text not null`
- `file_mime_type text not null` และต้องเป็น `application/pdf`
- `file_size_bytes integer not null` โดยไม่เกิน 25 MB ตามเพดานเอกสาร private bucket เดิม
- `uploaded_by uuid not null references public.profiles(id)`
- `uploaded_at timestamptz not null default now()`
- unique `(fiscal_year, plan_type)`

`public.lab_stock_annual_plan_audit` เป็น append-only และเก็บ action (`uploaded`, `replaced`, `retention_hard_deleted`), actor, fiscal year, plan type, ชื่อไฟล์/ขนาดที่เกี่ยวข้อง และเวลา โดยไม่เก็บ binary content

### Private Storage

สร้าง bucket `lab-stock-annual-plans` แบบ private จำกัด MIME เป็น PDF และใช้ path ที่ namespace ด้วยปี/ประเภท เช่น:

```text
annual-plans/{fiscalYear}/{planType}/{uuid}-{safeFileName}.pdf
```

path helper ต้อง reject `..`, slash ที่ไม่คาดหมาย และ path ที่อยู่นอก namespace ของปี/ประเภทที่รับเข้ามา

Storage policies เป็น defense-in-depth:

- active authenticated LAB Stock users อ่านได้
- `admin`/`stock_officer` เท่านั้นที่ insert/update ได้
- client ไม่ได้สิทธิ์ delete; hard delete ทำผ่าน server/service role หลัง RPC ตรวจลำดับการลบ

### Fiscal-year retention

สร้าง pure helper สำหรับคำนวณปีงบประมาณตาม `Asia/Bangkok` และคืน retained years `[current, current - 1]`:

- page/query แสดงเฉพาะสองปีนี้
- upload/replace รับเฉพาะสองปีนี้ทั้งคู่
- ทุกการ upload/replace เรียก retention cleanup สำหรับปีที่เก่ากว่า
- เพิ่มขั้นตอน retention ใน existing daily storage-cleanup cron เพื่อ hard delete เอกสารเก่าต่อให้ไม่มีการ upload ในปีใหม่

Hard delete ต้องทำให้ไม่มี active document row และไม่มี Storage object ของรายการที่พ้น retention หลัง cleanup สำเร็จ หาก Storage ล้มเหลว ให้คงรายการไว้เพื่อ retry และไม่ทำ soft-delete หลอกว่าลบแล้ว

Retention cleanup ใช้ลำดับต่อรายการ: อ่าน row ที่พ้นอายุ, ลบ object จริงแบบ idempotent (object ที่หายไปแล้วถือว่าสำเร็จ), แล้วจึงเรียก RPC hard-delete row และเขียน audit event หาก RPC ล้มเหลวหลัง object ถูกลบ ให้เข้าคิว retry ที่อ้างอิง `plan_id`/path เดิมเพื่อ hard-delete row ซ้ำได้อย่างปลอดภัย คิว retry เป็น metadata ของงาน ไม่ใช่ document row และไม่สร้าง `deleted_at`

### Replacement and cleanup order

1. ตรวจ actor, fiscal year, plan type และ File ใน server
2. upload object ใหม่ด้วย unique path และ `upsert: false`
3. เรียก RPC upsert เพื่อบันทึก row ใหม่, audit replacement และคืน path เดิม
4. ลบ object เดิมออกจาก Storage จริง
5. หากลบไม่สำเร็จ ให้เข้าคิว cleanup job; row เดิมไม่มี active pointer แล้ว และไม่มี soft-deleted row
6. หาก RPC ล้มเหลว ให้ลบ object ใหม่ที่เพิ่ง upload; หากลบไม่สำเร็จให้เข้าคิว orphan cleanup
7. revalidate `/annual-plans` และ `/settings/access` ตาม mutation ที่เกี่ยวข้อง

การอ่าน/ดาวน์โหลดใช้ server action หรือ route helper ที่เรียก `requireActor`, ตรวจ path และสร้าง signed URL เท่านั้น

## Code boundaries

เพิ่ม domain ที่แยกจาก contracts/inventory:

```text
app/(protected)/annual-plans/page.tsx
components/annual-plans/
  AnnualPlanCard.tsx
  AnnualPlanGrid.tsx
  AnnualPlanPreviewDialog.tsx
  AnnualPlanUploadDropzone.tsx
lib/annual-plans/
  authorization.ts
  actions.ts
  cleanup.ts
  files.ts
  fiscal.ts
  presenter.ts
  queries.ts
  schema.ts
  types.ts
supabase/migrations/<timestamp>_lab_stock_annual_plans.sql
```

คง `/settings/access` เป็น URL เดิมเพื่อไม่ทำลาย deep link/refresh ของผู้ใช้ แต่เปลี่ยน menu ownership ไปอยู่ใต้ `เจ้าหน้าที่คลัง`

## Testing and verification

ทำตาม TDD red-green-refactor โดยทุก production behavior ใหม่ต้องมี test ที่ fail ก่อน:

- pure fiscal-year/retention tests รวม boundary 30 ก.ย./1 ต.ค. เวลา Bangkok
- schema/path/file validation tests สำหรับ PDF, size, safe path และสอง plan types
- authorization tests สำหรับ upload/read/membership matrix และ `stock_officer` ที่ห้าม role `admin`
- SQL contract tests สำหรับ unique slot, private bucket, RPC actor guard, hard-delete boundaries และ idempotent cleanup retry
- UI source/render contract tests สำหรับ navigation order, nested menu, dropzone keyboard fallback, inline preview, download และ responsive hooks
- เพิ่ม focused suite ใน `package.json` และรวมเข้ากับ `npm run verify` ตาม domain convention

ก่อนส่งมอบให้รันอย่างน้อย `npm run lint`, `npm run typecheck`, focused annual-plan/access suites, `npm run build`, `git diff --check` และ Impeccable detector หนึ่งครั้งบน changed UI targets ที่เสร็จแล้ว โดยตรวจที่ 375/768/1024/1440px และ reduced-motion behavior

## Scope boundaries

- ไม่เปลี่ยน business logic ของสัญญา, PR, รับเข้า, เบิกจ่าย หรือคงคลัง
- ไม่เปิด public bucket และไม่เพิ่ม integration ภายนอก
- ไม่ทำ version history ของ PDF หรือ rollback จาก UI; เก็บ audit metadata เท่านั้น
- ไม่เพิ่มการอนุมัติเอกสาร, workflow review หรือการแก้ไข PDF ใน scope นี้
- ใช้เพดานไฟล์ 25 MB ตาม private document bucket ที่มีอยู่ หากต้องการเพดานใหม่จะเป็นการตัดสินใจแยก

## Acceptance criteria

- ผู้ใช้ทุก role ที่ active เปิด `/annual-plans` และเห็นปีปัจจุบัน/ปีก่อนหน้าพร้อมสองประเภทแผน
- `admin` และ `stock_officer` อัปโหลด/แทนที่ PDF ได้ทั้งสองปี; role อื่นทำไม่ได้
- อัปโหลดซ้ำใน slot เดิมแทนที่ไฟล์เดิมและไฟล์เดิมถูก hard delete
- PDF เปิดดูภายในหน้าเดิมและดาวน์โหลดได้ด้วย signed URL
- ไฟล์เก่ากว่าสองปีถูก hard delete ทั้ง row และ Storage object เมื่อ retention cleanup สำเร็จ
- `admin` แก้ทุก role ได้; `stock_officer` แก้ได้เฉพาะ `head`, `stock_officer`, `viewer` และไม่สามารถมอบ `admin` ผ่าน RPC ได้
- เมนู `แผนประจำปี` อยู่ถัดจาก Dashboard และ `สิทธิ์ผู้ใช้งาน` อยู่ใต้ `เจ้าหน้าที่คลัง`
- keyboard, mobile, focus, error และ reduced-motion behavior ผ่านเกณฑ์ของระบบเดิม
