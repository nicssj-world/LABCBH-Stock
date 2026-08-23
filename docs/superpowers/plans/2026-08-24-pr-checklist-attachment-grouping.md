# PR Checklist Attachment Grouping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** จัดกลุ่มช่องแนบเอกสาร PR เป็น “เอกสารหลัก” และ “ใบเสนอราคาจากบริษัท” พร้อมสถานะและตัวนับที่ชัดเจน โดยไม่ใช้เลขวงกลมที่กำกวม

**Architecture:** คง `derivePurchaseRequestChecklist()` และ attachment slot key เป็น source of truth แล้วสร้าง presentation model ภายใน `PurchaseRequestChecklistFields` เพื่อแยกรายการตาม `kind` และคำนวณ complete count จาก validation เดิม Markup ใช้ section ต่อกลุ่มและ render card ผ่าน helper เดียว ส่วน responsive layout อยู่ใน `.pr-checklist*` ของ `app/globals.css`

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, CSS custom properties, `node:assert/strict` UI contract tests

## Global Constraints

- ทำงานและ commit บน branch `main`; ไม่สร้าง worktree
- ไม่เปลี่ยน purchase method policy, schema, API, Cloudflare R2 storage หรือ upload flow
- คง MIME validation, ขนาดสูงสุด 20 MB, drag-and-drop, click-to-select และ existing-file replacement เดิม
- ใช้ design tokens `--lab-*` และ class naming เดิม; ไม่เพิ่ม dependency หรือ inline style
- Visible status ใช้ `รอแนบ` และ check SVG พร้อมข้อความ `แนบแล้ว`; color ไม่ใช่ตัวสื่อความหมายเพียงอย่างเดียว
- Layout ใช้ 3/2/1 คอลัมน์ที่ breakpoint 1180px และ 700px ตาม design spec

---

### Task 1: Group attachment semantics and remove ambiguous numbers

**Files:**
- Modify: `scripts/pr-checklist-ui.test.ts:8-18`
- Modify: `components/pr/PurchaseRequestChecklistFields.tsx:280-380`

**Interfaces:**
- Consumes: `PurchaseRequestChecklistPolicy.attachments`, `purchaseRequestAttachmentSlotKey()`, `validatePurchaseRequestAttachment()`, `files`, `existingBySlot`
- Produces: local `attachmentItems`, `primaryAttachments`, `quotationAttachments`, `completeAttachmentCount`, and grouped semantic markup

- [ ] **Step 1: Write the failing grouping contract test**

เพิ่ม assertions ต่อจาก dropzone assertions เดิม:

```ts
assert.match(fields, /เอกสารหลัก/, 'primary attachments need a visible group heading')
assert.match(fields, /ใบเสนอราคาจากบริษัท/, 'quotation attachments need a visible group heading')
assert.match(fields, /primaryAttachments/, 'attachments must be grouped by document kind')
assert.match(fields, /quotationAttachments/, 'quotation slots must stay together')
assert.match(fields, /บริษัทที่ \{item\.requirement\.slot\}/, 'quotation order needs an explicit company label')
assert.match(fields, /แนบแล้ว \{completeAttachmentCount\}\/\{policy\.attachments\.length\} ไฟล์/, 'overall file count must show progress')
assert.doesNotMatch(fields, /complete \? '✓' : requirement\.slot/, 'slot numbers must not be rendered as ambiguous card markers')
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npx tsx scripts/pr-checklist-ui.test.ts`

Expected: FAIL at `primary attachments need a visible group heading` because the component still renders one flat `.pr-checklist__files` grid.

- [ ] **Step 3: Build the attachment presentation model**

ภายใน `PurchaseRequestChecklistFields` หลัง `committeeErrors` สร้าง model โดยใช้ validation เดิม:

```tsx
  const attachmentItems = policy.attachments.map((requirement) => {
    const key = purchaseRequestAttachmentSlotKey(requirement.kind, requirement.slot)
    const file = files[key]
    const existing = existingBySlot.get(key)
    const mimeType = file ? purchaseRequestFileMime(file) : ''
    const errors = file
      ? validatePurchaseRequestAttachment({ kind: requirement.kind, mimeType, sizeBytes: file.size })
      : []
    return {
      requirement,
      key,
      file,
      existing,
      errors,
      complete: errors.length === 0 && Boolean(file || existing),
      isDragging: draggingSlotKey === key,
      dropzoneHintId: `pr-checklist-${requirement.kind}-${requirement.slot}-hint`,
    }
  })
  const primaryAttachments = attachmentItems.filter((item) => item.requirement.kind !== 'quotation')
  const quotationAttachments = attachmentItems.filter((item) => item.requirement.kind === 'quotation')
  const completeAttachmentCount = attachmentItems.filter((item) => item.complete).length
```

- [ ] **Step 4: Render both semantic groups through one card helper**

สร้าง `renderAttachmentCard` ภายใน component เพื่อคง action/error/dropzone เดิมและเปลี่ยนเฉพาะหัวการ์ด:

```tsx
  const renderAttachmentCard = (item: (typeof attachmentItems)[number]) => {
    const { requirement, key, file, existing, errors, complete, isDragging, dropzoneHintId } = item
    const visibleLabel = requirement.kind === 'quotation'
      ? `บริษัทที่ ${requirement.slot}`
      : requirement.label

    return (
      <article className={`pr-checklist__file${complete ? ' is-complete' : ''}`} key={key}>
        <div className="pr-checklist__file-copy">
          <div>
            <strong>{visibleLabel}</strong>
            <small>{requirement.kind === 'tor' ? 'PDF เท่านั้น' : 'PDF, JPG, PNG หรือ WEBP'} · สูงสุด 20 MB</small>
          </div>
          <span className={`pr-checklist__file-state${complete ? ' is-complete' : ''}`}>
            {complete && (
              <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">
                <path d="m2.25 6.25 2.2 2.2 5.3-5.3" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
              </svg>
            )}
            {complete ? 'แนบแล้ว' : 'รอแนบ'}
          </span>
        </div>
        {(file || existing) && (
          <p className="pr-checklist__file-name">
            {file?.name ?? existing?.fileName} · {formatFileSize(file?.size ?? existing?.sizeBytes ?? 0)}
            {file && existing && <small>จะแทนที่ไฟล์เดิมเมื่อบันทึก</small>}
          </p>
        )}
        {errors.map((message) => <p className="field-error" key={message}>{message}</p>)}
        <div className="pr-checklist__file-actions">
          <label
            className={`pr-checklist__dropzone${isDragging ? ' is-dragging' : ''}`}
            aria-disabled={disabled}
            onDragEnter={(event) => handleFileDragOver(event, key)}
            onDragOver={(event) => handleFileDragOver(event, key)}
            onDragLeave={(event) => handleFileDragLeave(event, key)}
            onDrop={(event) => handleFileDrop(event, key)}
          >
            <svg className="pr-checklist__dropzone-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M12 15.5V4m0 0L7.5 8.5M12 4l4.5 4.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
              <path d="M5 14.5v3A2.5 2.5 0 0 0 7.5 20h9a2.5 2.5 0 0 0 2.5-2.5v-3" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
            </svg>
            <span className="pr-checklist__dropzone-copy">
              <strong>{isDragging ? 'วางไฟล์ที่นี่' : file || existing ? 'ลากไฟล์ใหม่มาวางเพื่อเปลี่ยน' : 'ลากไฟล์มาวางที่นี่'}</strong>
              <small id={dropzoneHintId}>หรือคลิกเลือกไฟล์ · {requirement.kind === 'tor' ? 'PDF เท่านั้น' : 'PDF, JPG, PNG หรือ WEBP'}</small>
            </span>
            <input
              key={file ? checklistFileFingerprint(file) : 'empty'}
              type="file"
              accept={requirement.accept.join(',')}
              disabled={disabled}
              aria-label={`แนบ ${requirement.label}`}
              aria-describedby={dropzoneHintId}
              onChange={(event) => onFileChange(key, event.target.files?.[0])}
            />
          </label>
          {file && (
            <Button variant="ghost" type="button" disabled={disabled} onClick={() => onFileChange(key, undefined)}>
              ยกเลิกไฟล์ที่เลือก
            </Button>
          )}
        </div>
      </article>
    )
  }
```

แทน flat grid เดิมด้วย overall count และสอง sections ที่ render เฉพาะเมื่อมีรายการ:

```tsx
        <div className="pr-checklist__section-heading">
          <h3>เอกสารแนบ</h3>
          <span aria-live="polite">แนบแล้ว {completeAttachmentCount}/{policy.attachments.length} ไฟล์</span>
        </div>
        <div className="pr-checklist__attachment-groups">
          {primaryAttachments.length > 0 && (
            <section className="pr-checklist__file-group" aria-labelledby="pr-checklist-primary-files">
              <div className="pr-checklist__file-group-heading">
                <h4 id="pr-checklist-primary-files">เอกสารหลัก</h4>
                <span>แนบแล้ว {primaryAttachments.filter((item) => item.complete).length}/{primaryAttachments.length}</span>
              </div>
              <div className="pr-checklist__file-grid pr-checklist__file-grid--primary">
                {primaryAttachments.map(renderAttachmentCard)}
              </div>
            </section>
          )}
          {quotationAttachments.length > 0 && (
            <section className="pr-checklist__file-group" aria-labelledby="pr-checklist-quotation-files">
              <div className="pr-checklist__file-group-heading">
                <h4 id="pr-checklist-quotation-files">ใบเสนอราคาจากบริษัท</h4>
                <span>แนบแล้ว {quotationAttachments.filter((item) => item.complete).length}/{quotationAttachments.length}</span>
              </div>
              <div className="pr-checklist__file-grid pr-checklist__file-grid--quotation">
                {quotationAttachments.map(renderAttachmentCard)}
              </div>
            </section>
          )}
        </div>
```

- [ ] **Step 5: Run the focused test and static checks**

Run: `npx tsx scripts/pr-checklist-ui.test.ts && npm run typecheck`

Expected: both commands PASS with `purchase request checklist UI: ok` and no TypeScript errors.

- [ ] **Step 6: Commit semantic grouping**

```bash
git add scripts/pr-checklist-ui.test.ts components/pr/PurchaseRequestChecklistFields.tsx
git commit -m "feat: group PR checklist attachments"
```

### Task 2: Style group hierarchy and 3/2/1 responsive grids

**Files:**
- Modify: `scripts/pr-checklist-ui.test.ts:41-50`
- Modify: `app/globals.css:3893-3910,4000-4012`

**Interfaces:**
- Consumes: `.pr-checklist__attachment-groups`, `.pr-checklist__file-group`, `.pr-checklist__file-grid--primary`, `.pr-checklist__file-grid--quotation`, `.pr-checklist__file-state`
- Produces: visually separated groups, status styling, and deterministic 3/2/1 responsive layouts

- [ ] **Step 1: Write the failing CSS contract test**

เพิ่ม assertions ในส่วน style tests:

```ts
assert.match(styles, /\.pr-checklist__file-group \+ \.pr-checklist__file-group\s*\{[^}]*border-top:/s, 'attachment kinds need a visible divider')
assert.match(styles, /\.pr-checklist__file-grid--primary\s*\{[^}]*repeat\(2,/s, 'primary documents need at most two desktop columns')
assert.match(styles, /\.pr-checklist__file-grid--quotation\s*\{[^}]*repeat\(3,/s, 'quotation documents need three wide-desktop columns')
assert.match(styles, /\.pr-checklist__file-state\.is-complete/, 'completed cards need written-state styling')
assert.match(styles, /@media \(max-width: 1180px\)[\s\S]*pr-checklist__file-grid--quotation/, 'quotation grid needs a tablet breakpoint')
assert.match(styles, /@media \(max-width: 700px\)[\s\S]*pr-checklist__file-grid/, 'all attachment groups need a mobile breakpoint')
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npx tsx scripts/pr-checklist-ui.test.ts`

Expected: FAIL at `attachment kinds need a visible divider` because the new classes have no CSS rules yet.

- [ ] **Step 3: Replace the flat-grid and circle-marker styles**

แทน `.pr-checklist__files` และ marker rules เดิมด้วย:

```css
.pr-checklist__attachment-groups { display: grid; gap: 20px; }
.pr-checklist__file-group { display: grid; gap: 14px; }
.pr-checklist__file-group + .pr-checklist__file-group { padding-top: 20px; border-top: 1px solid var(--lab-border); }
.pr-checklist__file-group-heading { display: flex; gap: 12px; align-items: baseline; justify-content: space-between; }
.pr-checklist__file-group-heading h4 { margin: 0; color: var(--lab-navy-strong); font-size: 15px; }
.pr-checklist__file-group-heading span { color: var(--lab-muted); font-size: 12px; }
.pr-checklist__file-grid { display: grid; gap: 14px; }
.pr-checklist__file-grid--primary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.pr-checklist__file-grid--quotation { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.pr-checklist__file { display: grid; gap: 14px; min-width: 0; padding: 18px; background: var(--lab-surface); border: 1px solid var(--lab-border); border-radius: 12px; }
.pr-checklist__file.is-complete { background: color-mix(in srgb, var(--lab-success) 3%, var(--lab-surface)); border-color: color-mix(in srgb, var(--lab-success) 38%, var(--lab-border)); }
.pr-checklist__file-copy { display: flex; min-width: 0; gap: 12px; align-items: flex-start; justify-content: space-between; }
.pr-checklist__file-copy > div { min-width: 0; }
.pr-checklist__file-state { display: inline-flex; flex: 0 0 auto; align-items: center; min-height: 24px; color: var(--lab-muted); font-size: 12px; font-weight: 700; white-space: nowrap; }
.pr-checklist__file-state svg { width: 12px; height: 12px; margin-right: 5px; }
.pr-checklist__file-state.is-complete { color: var(--lab-success); }
```

คง rules ของ title/helper text เดิม และแก้ responsive rules:

```css
@media (max-width: 1180px) {
  .pr-checklist__file-grid--quotation { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

@media (max-width: 700px) {
  .pr-checklist__section { padding-inline: 16px; }
  .pr-checklist__committees fieldset { padding: 16px; }
  .pr-checklist__file-grid { grid-template-columns: 1fr; }
  .pr-checklist__dropzone { min-height: 84px; padding-inline: 14px; }
}
```

- [ ] **Step 4: Run the focused test and static checks**

Run: `npx tsx scripts/pr-checklist-ui.test.ts && npm run typecheck && npm run lint`

Expected: all commands PASS without warnings introduced by the changed files.

- [ ] **Step 5: Commit responsive presentation**

```bash
git add scripts/pr-checklist-ui.test.ts app/globals.css
git commit -m "style: clarify PR attachment groups"
```

### Task 3: Verify the complete PR checklist flow

**Files:**
- Test: `scripts/pr-checklist-ui.test.ts`
- Test: existing PR domain, schema, backend and UI suites from `npm run test:pr`
- Inspect: `components/pr/PurchaseRequestChecklistFields.tsx`
- Inspect: `app/globals.css`

**Interfaces:**
- Consumes: completed grouped attachment UI
- Produces: regression, accessibility, responsive and Impeccable detector evidence

- [ ] **Step 1: Run the full PR regression suite**

Run: `npm run test:pr`

Expected: every PR test prints its `ok` marker and the command exits 0.

- [ ] **Step 2: Run repository static checks**

Run: `npm run typecheck && npm run lint`

Expected: both commands exit 0.

- [ ] **Step 3: Run the Impeccable mechanical detector once**

Run:

```bash
node C:\Users\User\.agents\skills\impeccable\scripts\detect.mjs --json components/pr/PurchaseRequestChecklistFields.tsx app/globals.css
```

Expected: no blocking findings caused by the changed targets. If the detector reports a regression from this work, fix all related findings in one patch and rerun the focused UI test, typecheck and lint once.

- [ ] **Step 4: Inspect the rendered page at target widths**

เปิดหน้าเพิ่มหรือแก้ไขใบ PR ที่ใช้ใบเสนอราคา 3 บริษัท แล้วตรวจที่ 1440px, 900px และ 375px:

```text
1440px: เอกสารหลัก 2 columns; ใบเสนอราคา 3 columns
900px:  เอกสารหลัก 2 columns; ใบเสนอราคา 2 columns
375px:  ทุกกลุ่ม 1 column; ไม่มี horizontal scroll
```

ตรวจเพิ่มว่า Tab order เดินจากเอกสารหลักไปใบเสนอราคาบริษัทที่ 1–3, focus ring มองเห็น, status มีข้อความ, drag/click ยังเลือกไฟล์ได้ และชื่อไฟล์/error ไม่ล้นการ์ด

- [ ] **Step 5: Commit detector or inspection fixes if needed**

หาก Step 3–4 ทำให้ต้องแก้ไฟล์:

```bash
git add components/pr/PurchaseRequestChecklistFields.tsx app/globals.css scripts/pr-checklist-ui.test.ts
git commit -m "fix: finish PR attachment grouping"
```

หากไม่ต้องแก้ ให้ไม่สร้าง empty commit และบันทึกผล verification ใน handoff เท่านั้น
