# Auto logout หลังไม่มีการใช้งาน 30 นาที

## สถานะ

Design นี้ได้รับการอนุมัติจากผู้ใช้แล้วเมื่อ 4 กันยายน 2026

## เป้าหมาย

ผู้ใช้ที่อยู่ใน protected routes จะถูกนำออกจากระบบเมื่อไม่มี interaction เป็นเวลา 30 นาที และจะได้รับข้อความเตือนล่วงหน้า 1 นาทีเพื่อกดใช้งานต่อได้

ฟีเจอร์นี้เป็น client-side idle timeout สำหรับ session ใน browser ปัจจุบัน ไม่เปลี่ยนสิทธิ์หรือ session authority ฝั่ง server และไม่กระทบหน้า login

## ขอบเขตพฤติกรรม

1. เมื่อ protected shell แสดงผล ให้เริ่มจับเวลา inactivity 30 นาที
2. กิจกรรมต่อไปนี้ถือเป็นการใช้งานและเริ่มเวลาใหม่: `pointerdown`, `keydown`, `touchstart`, `wheel` และ `scroll`
3. เมื่อ idle ครบ 29 นาที ให้เปิด modal เตือนว่า session จะออกจากระบบในอีก 1 นาที พร้อม countdown
4. ปุ่ม `ใช้งานต่อ` จะปิด modal และเริ่มจับเวลา 30 นาทีใหม่
5. เมื่อครบ 30 นาที ให้เรียก `supabase.auth.signOut({ scope: 'local' })` แล้วนำทางไป `/login`
6. ระหว่างการ logout อัตโนมัติให้ป้องกันการกดซ้ำและแสดงสถานะกำลังออกจากระบบ
7. หาก sign out ล้มเหลว ให้คง modal ไว้ แสดงข้อผิดพลาดภาษาไทย และให้ลองใหม่ได้ เพื่อไม่ให้ผู้ใช้กลับไปใช้งาน protected UI โดยยังไม่ clear session
8. modal ไม่มี close action ที่เลี่ยง timeout ได้; การกด Escape ต้องไม่ปิดคำเตือนโดยไม่ reset timer

การนับเวลาเป็นรายแท็บตามที่อนุมัติไว้ ไม่ซิงก์กิจกรรมระหว่างแท็บหรืออุปกรณ์อื่น การ sign out แบบ `local` อาจทำให้ session ของ origin เดียวกันในแท็บอื่นถูก clear ตามกลไกของ Supabase browser client

## แนวทางที่เลือก

ใช้ idle timer ฝั่ง browser ภายใน protected shell

- ไม่ต้องเพิ่มตาราง, migration, API หรือ state ฝั่ง server
- ใช้ Supabase browser client และรูปแบบ redirect เดียวกับ `LogoutButton` ที่มีอยู่แล้ว
- แยก logic timer ออกจาก UI เพื่อให้ทดสอบ transition ได้โดยไม่ต้องรอ 30 นาทีจริง

แนวทาง server-side activity tracking และการซิงก์ข้ามแท็บไม่อยู่ใน scope ของรอบนี้ เพราะเพิ่ม state/ความซับซ้อนโดยไม่จำเป็นต่อ requirement ปัจจุบัน

## โครงสร้างที่เสนอ

### `lib/auth/idle-timeout.ts`

โมดูล pure สำหรับ state และ transition ของ idle timeout โดยกำหนดค่า timeout 30 นาทีและ warning lead time 1 นาที รับ clock/timer dependency ที่ฉีดได้สำหรับเทสต์ และรองรับ transition `active` → `warning` → `expired` รวมถึงการ reset จาก activity และปุ่มใช้งานต่อ

### `components/ui/IdleSessionGuard.tsx`

Client component ที่ mount ครั้งเดียวใน protected `AppShell` ทำหน้าที่เชื่อม browser events กับ idle-timeout module, จัดการ timer lifecycle และ render warning modal เมื่อ state เป็น `warning` เมื่อ state เป็น `expired` จะเรียก `signOut` แบบ local และใช้ `router.replace('/login')` พร้อม refresh ตามรูปแบบ logout ปัจจุบัน

ใช้ native modal pattern และ `Button`/class naming ของระบบที่มีอยู่ ไม่สร้าง auth client ใหม่หรือใช้ service-role credential ใน browser

### `components/ui/AppShell.tsx`

เพิ่ม `IdleSessionGuard` ภายใน shell ของ protected routes เพื่อให้ทุกหน้าที่ผ่าน `app/(protected)/layout.tsx` ได้รับ behavior เดียวกัน โดยไม่ติดตั้ง guard บน `/login` หรือ public routes

### `app/globals.css`

เพิ่ม style เฉพาะ warning modal ให้สอดคล้องกับ `.app-dialog`, responsive layout และ reduced-motion behavior ที่มีอยู่

## Data flow และ error handling

```text
browser activity
  -> idle-timeout controller reset
  -> active state / rescheduled timers

29 minutes idle
  -> warning modal + countdown
  -> ใช้งานต่อ -> reset หรือครบ 30 นาที -> expired

expired
  -> Supabase local signOut
  -> /login
```

การเปลี่ยนหน้าและการ unmount ต้อง clear timers และ event listeners ทุกตัว หาก session ถูก sign out จากภายนอกก่อน timer หมด component ต้องหยุดทำงานและไม่พยายาม logout ซ้ำ

## Accessibility และข้อความ

Modal ใช้ `role="dialog"`, `aria-modal="true"`, heading ที่อ้างอิงด้วย `aria-labelledby` และให้ focus อยู่กับปุ่ม `ใช้งานต่อ` เมื่อเปิด คำเตือนใช้ข้อความภาษาไทยที่บอกเหตุผลและเวลาที่เหลืออย่างชัดเจน เช่น:

> ไม่มีการใช้งาน ระบบจะออกจากระบบอัตโนมัติในอีก 1 นาที

ปุ่มหลักใช้ label `ใช้งานต่อ`; ข้อผิดพลาดจาก sign out ใช้ `role="alert"` และปุ่ม retry ที่เข้าถึงได้ด้วย keyboard

## การทดสอบและเกณฑ์ยอมรับ

- unit/behavior test ของ idle-timeout module ต้องตรวจว่าเริ่มเป็น `active`, activity reset เวลา, idle 29 นาทีเปิด `warning`, `ใช้งานต่อ` reset กลับ `active`, และครบ 30 นาทีเปลี่ยนเป็น `expired`
- ตรวจว่า `IdleSessionGuard` เรียก `signOut` ด้วย `{ scope: 'local' }`, redirect ไป `/login`, cleanup timer/listener และไม่ render บน login โดยเพิ่ม contract assertions ในชุด auth/app-shell ที่มีอยู่ตามความเหมาะสม
- ตรวจ warning modal ด้วย keyboard และ responsive layout ผ่าน browser smoke test หากสภาพแวดล้อม E2E พร้อม โดยใช้ timeout ที่ฉีดได้เพื่อไม่ต้องรอเวลาจริง
- รันชุด auth/app-shell tests และ typecheck/build ที่เกี่ยวข้อง โดยผลต้องไม่มี error หรือ warning ใหม่

เกณฑ์ยอมรับหลักคือ ผู้ใช้ที่มี interaction ต่อเนื่องจะไม่ถูก logout, ผู้ใช้ที่ idle จะเห็นคำเตือนที่นาที 29, ปุ่มใช้งานต่อยืด session ได้อีก 30 นาที และผู้ใช้ถูกพาไป login หลัง timeout สำเร็จ
