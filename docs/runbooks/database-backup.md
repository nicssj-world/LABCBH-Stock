# Local database backup runner

ระบบสำรองฐานข้อมูลนี้ให้เว็บสร้างคำขอและบันทึกสถานะ ส่วนเครื่อง Local เป็นผู้
เชื่อมต่อ PostgreSQL โดยตรงและเก็บไฟล์จริงไว้ใน `BACKUP_ROOT` ไฟล์ dump จะไม่ผ่าน
Vercel และไม่รวม object bytes ใน Supabase Storage

## ใช้งานด้วยไฟล์ติดตั้ง Windows

สำหรับผู้ใช้ทั่วไปให้ใช้ `LABCBH-Backup-Setup-1.0.0.exe` จากโฟลเดอร์ `release/` แทนการเปิด
Command Prompt:

1. ติดตั้งแอป แล้วเปิด `LABCBH Backup`
2. เลือกชื่อระบบจากตัวเลือกด้านบน:
   - `LABCBH Stock` — ฐานข้อมูล Production `fslagsuorkcckvvtrmyi`
   - `LabManagement Portal` — ใช้ฐานข้อมูล Production เดียวกัน
3. กรอก Supabase project URL `https://fslagsuorkcckvvtrmyi.supabase.co`, service role key และ PostgreSQL connection string ของ Production
4. เลือกโฟลเดอร์ปลายทางร่วม และเลือก `pg_dump.exe` หากแอปหาเองไม่พบ
5. กดบันทึกและตรวจสอบการเชื่อมต่อ จากนั้นกด `สำรองข้อมูลตอนนี้`
6. การสำรองครั้งเดียวครอบคลุมทั้ง LABCBH Stock และ LabManagement Portal เพราะใช้ฐานข้อมูลเดียวกัน ไม่ต้องตั้งค่าซ้ำ
7. หากต้องการอัตโนมัติ ให้เปิดสำรองอัตโนมัติที่โปรไฟล์ `LABCBH Stock` เพียงโปรไฟล์เดียว เพื่อไม่ให้สร้างงานซ้ำ

โปรเจค Staging `stogulcfwsvunydmwrex` ไม่อยู่ในรายการเป้าหมายและแอปจะปฏิเสธ URL นี้

ตัว installer ไม่ฝัง `pg_dump.exe` ที่เป็น binary ภายนอกไว้ใน repository โดยค่าเริ่มต้น จึงควรติดตั้ง
PostgreSQL client ที่เชื่อถือได้ก่อน หรือวางชุด client ที่ได้รับอนุญาตไว้ใน `desktop/postgresql/` แล้ว build ใหม่
ค่าลับจะถูกเก็บด้วย Windows protected storage ของผู้ใช้เครื่องนั้น และไฟล์ dump จะอยู่ในโฟลเดอร์ Local ที่เลือก

หากต้องการ build installer ใหม่:

```bash
npm run backup:desktop:build
```

## เตรียมเครื่อง Local

ติดตั้ง Node.js 22 ขึ้นไป และ PostgreSQL client ที่มี `pg_dump`/`pg_restore` อยู่ใน
`PATH` หรือระบุ `PG_DUMP_PATH` เป็น path เต็มของ `pg_dump.exe` จากนั้นกำหนดค่าใน
`.env.local` ของโปรเจกต์บนเครื่อง Local เท่านั้น:

```text
NEXT_PUBLIC_SUPABASE_URL=https://fslagsuorkcckvvtrmyi.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
BACKUP_DATABASE_URL=postgresql://<db-user>:<db-password>@db.fslagsuorkcckvvtrmyi.supabase.co:5432/postgres?sslmode=require
BACKUP_EXPECTED_PROJECT_REF=fslagsuorkcckvvtrmyi
BACKUP_ROOT=D:\LABCBH-Backups
BACKUP_RUNNER_ID=labcbh-stock-runner-01
```

`BACKUP_DATABASE_URL` และ `SUPABASE_SERVICE_ROLE_KEY` เป็นความลับ ห้ามใส่ใน
Vercel, `NEXT_PUBLIC_*`, git หรือ log ของ Task Scheduler

## ทดสอบและเปิดใช้งาน

จากโฟลเดอร์โปรเจกต์:

```bash
npm install
npm run backup:database -- --once
```

หากต้องการให้ runner รอรับคำขอจากหน้าเว็บตลอดเวลา:

```bash
npm run backup:database -- --watch
```

ไฟล์ของฐานข้อมูลร่วมจะอยู่ใต้โฟลเดอร์ Local ที่เลือก เช่น
`LABCBH Backups\LABCBH Production (Stock + Portal)\database\<run-id>\` พร้อม `manifest.json`
และ checksum SHA-256 โดยเก็บไฟล์สำเร็จล่าสุดเสมอ และล้างไฟล์อื่นที่เกิน 30 วัน

## ตั้ง Windows Task Scheduler

ถ้าใช้โหมดติดตั้งบน Windows ให้เปิดตารางเวลาที่โปรไฟล์ `LABCBH Stock` เพียงจุดเดียว
แอปจะสร้างงานชื่อ `LABCBH Database Backup - stock` ให้เอง โดยไม่ต้องสร้าง Basic Task ด้วยมือ

ถ้าต้องสร้างเองด้วย CLI ให้สร้าง Basic Task เดียวสำหรับ Production และใช้โฟลเดอร์
โปรเจค/ไฟล์ environment ของ runner เป็น working directory:

1. Trigger: Monthly, วันที่ 1, เวลา 02:00 น.
2. Action: Start a program
3. Program: `cmd.exe`
4. Arguments: `/d /s /c "npm run backup:database -- --scheduled"`
5. Start in: โฟลเดอร์ root ของโปรเจกต์ เช่น `C:\LABCBH-Stock`
6. เปิด `Run whether user is logged on or not` และตั้ง account ที่อ่าน/เขียน
   `BACKUP_ROOT` ได้

runner จะข้ามการสร้างคำขอใหม่ถ้ามีงานค้างอยู่ หรือมี backup สำเร็จภายใน 30 วัน
และจะรับงานที่อยู่ในคิวต่อในรอบเดียวกัน

## ตรวจสอบผล

เปิด `/settings/backup` ด้วยบัญชี `admin` หรือ `stock_officer` เพื่อดู runner,
สถานะ, เวลา, ขนาดไฟล์, checksum และ error ล่าสุด หน้าเว็บไม่มีปุ่ม Restore

การกู้คืนให้ผู้ดูแลทำผ่าน CLI หลังตรวจสอบ manifest และทดสอบบน staging ก่อน เช่น:

```bash
pg_restore --clean --if-exists --no-owner --dbname="<staging-db-url>" \
  "D:\LABCBH-Backups\database\<run-id>\database-<run-id>.dump"
```

หากสถานะเป็น `ไม่พบ runner` ให้ตรวจว่า Task Scheduler/คำสั่ง `--watch` ทำงานอยู่,
ค่า `BACKUP_EXPECTED_PROJECT_REF` ตรงกับ URL และ `pg_dump` อยู่ใน PATH ก่อนดู
รายละเอียด error ในประวัติหน้าเว็บ
