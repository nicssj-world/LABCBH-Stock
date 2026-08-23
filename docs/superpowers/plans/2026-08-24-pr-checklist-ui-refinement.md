# PR Checklist UI Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** เพิ่ม drag & drop ที่แนบเอกสาร และปรับกรอบ/padding/spacing ของ checklist และ committee inputs ให้ชัดเจนและใช้งานง่ายขึ้น

**Architecture:** เก็บ drag state ใน `PurchaseRequestChecklistFields` แล้วส่งไฟล์ผ่าน `onFileChange` callback เดิม เพื่อไม่แตะ storage หรือ validation layer ใช้ CSS tokens ใน `app/globals.css` เป็นแหล่งสไตล์เดียว และรักษา responsive breakpoint เดิม

**Tech Stack:** Next.js App Router, React client component, TypeScript, CSS custom properties, existing PR checklist tests

## Global Constraints

- ไฟล์แนบต่อไฟล์ต้องไม่เกิน 20 MB และชนิดไฟล์ต้องผ่าน policy เดิม
- ผู้ใช้ต้องเลือกบุคลากรจากระบบเท่านั้น; ห้ามเปลี่ยน committee data flow
- ต้องรองรับ keyboard focus และ touch target อย่างน้อย 44px
- ห้ามเพิ่ม dependency ใหม่หรือเปลี่ยน Cloudflare R2 upload flow

---

### Task 1: Add accessible drag-and-drop file selection

**Files:**
- Modify: `components/pr/PurchaseRequestChecklistFields.tsx`

**Interfaces:**
- Consumes: existing `PurchaseRequestChecklistFieldsProps.onFileChange` callback and per-slot `requirement` metadata
- Produces: per-slot drag state and drop handlers that call `onFileChange(slotKey, File | undefined)`

- [ ] **Step 1: Add slot-level drag state**

เพิ่ม `draggingSlotKey` state และ handler functionsใน component เพื่อรับไฟล์แรกจาก `DataTransfer.files`, เรียก `preventDefault`, กำหนด `dropEffect = 'copy'`, และล้าง state เมื่อ drop/leave

- [ ] **Step 2: Replace the button-only action with a dropzone**

ห่อ hidden file input ด้วย label ที่มี class `pr-checklist__dropzone`, แสดงข้อความลากวางและปุ่มเลือกไฟล์เดิม, ใส่ `aria-describedby`, และผูก drag handlers ต่อ slot โดยยังใช้ `onChange` เดิม

- [ ] **Step 3: Keep cancel and existing-file behavior intact**

คงปุ่มยกเลิก/เปลี่ยนไฟล์, existing attachment display และ error rendering โดยไม่เปลี่ยน callback หรือ validation logic

### Task 2: Improve committee and checklist spacing

**Files:**
- Modify: `app/globals.css`

**Interfaces:**
- Consumes: existing `.pr-checklist`, `.committee-picker`, and file action class names
- Produces: dropzone states, bordered inputs, visible focus states, and responsive spacing

- [ ] **Step 1: Style the dropzone states**

กำหนด min-height 92px, padding 14–16px, dashed border, neutral surface และ state `.is-dragging`/`:focus-within` ด้วย primary border/ring โดยไม่ใช้ shadow ตกแต่งบน resting surface

- [ ] **Step 2: Style committee inputs and content insets**

กำหนด border `var(--lab-border-strong)`, padding `10px 42px 10px 12px`, min-height 46px, background surface, line-height 1.45 และ focus ring 3px; เพิ่ม padding fieldset/card และ gap ตาม token

- [ ] **Step 3: Verify responsive behavior**

เพิ่มกฎหน้าจอแคบให้ dropzone และ action buttons ไม่ล้น, committee grid ยุบเป็นหนึ่งคอลัมน์ และคง touch target ≥44px

### Task 3: Verify UI quality and regression safety

**Files:**
- Test: `scripts/pr-checklist-ui.test.ts`
- Test: existing TypeScript/lint/build scripts

- [ ] **Step 1: Run UI checklist regression test**

รัน `npm run test:pr` และตรวจว่า checklist validation, file callback และ committee behavior ผ่านเหมือนเดิม

- [ ] **Step 2: Run static checks**

รัน `npm run typecheck` และ `npm run lint`

- [ ] **Step 3: Run Impeccable detector**

รัน `node C:\Users\User\.agents\skills\impeccable\scripts\detect.mjs --json components/pr/PurchaseRequestChecklistFields.tsx app/globals.css` แล้วแก้เฉพาะ finding ที่เกิดจากงานนี้
