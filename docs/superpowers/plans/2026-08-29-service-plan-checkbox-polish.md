# Service Plan Checkbox Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (\`- [ ]\`) syntax for tracking.

**Goal:** Make the two service-plan condition checkboxes compact, legible, and keyboard-friendly without changing their meaning or adding helper copy.

**Architecture:** Keep the existing controlled inputs and labels in \`ServicePlanForm\`. Add a scoped visual treatment for \`.checkbox-row\` in the shared stylesheet, overriding only the generic form-control sizing that currently stretches checkbox inputs. Use existing semantic tokens and the current responsive grid.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, global CSS, \`tsx\` UI contract tests, Playwright for rendered verification.

## Global Constraints

- Keep the current panel, labels, colors, typography, and two-column layout.
- Render each condition as a compact, full-row label with a native checkbox sized at approximately 18×18px.
- Keep the entire label row keyboard- and pointer-friendly with at least a 44px minimum row height and visible hover/focus treatment.
- Give selected rows a quiet semantic tint/border so state is legible without relying on the checkbox alone.
- Keep disabled “ทำสัญญา” styling clear when the plan already has PRs.
- Preserve the one-column responsive behavior at the existing breakpoint.
- Do not add helper text below “ทำสัญญา”.
- Do not change service-plan actions, schemas, copy, or database behavior.
- Work on the \`main\` branch as requested.

## File Map

- Modify package.json so the service-procurement test command runs the new regression test.
- Create \`scripts/service-plan-form-ui.test.ts\` for source-level regression assertions.
- Modify \`components/service-procurement/ServicePlanForm.tsx\` for state-aware visual classes only.
- Modify \`app/globals.css\` for scoped checkbox-row layout and interaction states only.

### Task 1: Add the checkbox regression contract

**Files:**
- Modify: package.json:25
- Create: \`scripts/service-plan-form-ui.test.ts\`

**Interfaces:**
- Consumes: source text from \`ServicePlanForm.tsx\` and \`app/globals.css\`.
- Produces: a runnable test that fails until the approved state classes and sizing rules exist.

- [ ] **Step 1: Write the failing test**

Create this source-level contract test:

~~~ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(path, 'utf8')
const form = read('components/service-procurement/ServicePlanForm.tsx')
const css = read('app/globals.css')

assert.ok(form.includes("className={'checkbox-row' + (isRedCross ? ' is-checked' : '')}"))
assert.ok(form.includes("className={'checkbox-row' + (requiresContract ? ' is-checked' : '') + (hasRequests ? ' is-disabled' : '')}"))
assert.ok(form.includes('<span>สภากาชาดไทย</span>'))
assert.ok(form.includes('<span>ทำสัญญา {hasRequests'))
assert.ok(!form.includes('เมื่อเปิดใช้'))
assert.ok(css.includes('.service-plan-form .checkbox-row {'))
assert.ok(css.includes('.service-plan-form .checkbox-row input[type="checkbox"] {'))
assert.ok(css.includes('min-height: 44px;'))
assert.ok(css.includes('width: 18px;'))
assert.ok(css.includes('height: 18px;'))
assert.ok(css.includes('.service-plan-form .checkbox-row.is-checked {'))
assert.ok(css.includes('.service-plan-form .checkbox-row.is-disabled {'))

console.log('service plan form checkbox UI: ok')
~~~

- [ ] **Step 2: Run the test to verify it fails**

Run:

~~~bash
npx tsx scripts/service-plan-form-ui.test.ts
~~~

Expected: FAIL because the current labels do not expose state classes and no scoped checkbox-row rules exist.

### Task 2: Add state-aware checkbox markup

**Files:**
- Modify: \`components/service-procurement/ServicePlanForm.tsx:53\`

**Interfaces:**
- Consumes: existing \`isRedCross\`, \`requiresContract\`, and \`hasRequests\` values.
- Produces: the same controlled inputs, handlers, submitted values, and disabled behavior with visual-only state classes.

- [ ] **Step 1: Update the two existing label class names**

Keep the existing handlers and labels, changing only their className expressions to:

~~~tsx
<label className={'checkbox-row' + (isRedCross ? ' is-checked' : '')}>
  <input type="checkbox" checked={isRedCross} onChange={(event) => { setIsRedCross(event.target.checked); if (!event.target.checked) setItems([]) }} />
  <span>สภากาชาดไทย</span>
</label>
<label className={'checkbox-row' + (requiresContract ? ' is-checked' : '') + (hasRequests ? ' is-disabled' : '')}>
  <input type="checkbox" checked={requiresContract} disabled={hasRequests} onChange={(event) => setRequiresContract(event.target.checked)} />
  <span>ทำสัญญา {hasRequests && <small>(ล็อกแล้วเพราะมี PR อ้างแผนนี้)</small>}</span>
</label>
~~~

- [ ] **Step 2: Run the contract test**

Run \`npx tsx scripts/service-plan-form-ui.test.ts\`.

Expected: FAIL only on the CSS assertions; the markup and copy assertions pass.

### Task 3: Add the compact visual treatment

**Files:**
- Modify: \`app/globals.css\` after the shared \`.form-grid\` control rules near lines 1553–1595.

**Interfaces:**
- Consumes: existing \`--lab-*\`, \`--radius-control\`, \`--motion-fast\`, and \`--ease-out\` tokens.
- Produces: a scoped row style that wins over generic \`.form-grid input\` sizing without changing other forms.

- [ ] **Step 1: Add these scoped rules**

~~~css
.service-plan-form .checkbox-row {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 44px;
  padding: 10px 14px;
  color: var(--lab-ink);
  background: var(--lab-surface);
  border: 1px solid var(--lab-border);
  border-radius: var(--radius-control);
  font-size: 13px;
  font-weight: 700;
  line-height: 1.4;
  cursor: pointer;
  transition: background-color var(--motion-fast) var(--ease-out), border-color var(--motion-fast) var(--ease-out);
}

.service-plan-form .checkbox-row:hover {
  background: var(--lab-hover);
  border-color: var(--lab-border-strong);
}

.service-plan-form .checkbox-row:focus-within {
  border-color: var(--lab-primary);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--lab-primary) 16%, transparent);
}

.service-plan-form .checkbox-row.is-checked {
  background: var(--lab-primary-soft);
  border-color: color-mix(in srgb, var(--lab-primary) 34%, var(--lab-border));
}

.service-plan-form .checkbox-row input[type="checkbox"] {
  width: 18px;
  height: 18px;
  min-height: 18px;
  flex: 0 0 18px;
  margin: 0;
  padding: 0;
  accent-color: var(--lab-primary);
}

.service-plan-form .checkbox-row > span {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 5px;
  min-width: 0;
}

.service-plan-form .checkbox-row small {
  color: var(--lab-muted);
  font-size: 11px;
  font-weight: 500;
}

.service-plan-form .checkbox-row.is-disabled {
  color: var(--lab-muted);
  background: var(--lab-surface-muted);
  cursor: not-allowed;
  opacity: .72;
}

.service-plan-form .checkbox-row input[type="checkbox"]:disabled {
  cursor: not-allowed;
}
~~~

- [ ] **Step 2: Run the source contract**

Run \`npx tsx scripts/service-plan-form-ui.test.ts\`.

Expected: PASS with \`service plan form checkbox UI: ok\`.

- [ ] **Step 3: Inspect the diff**

Run:

~~~bash
git diff -- components/service-procurement/ServicePlanForm.tsx app/globals.css scripts/service-plan-form-ui.test.ts
~~~

Expected: only visual classes, scoped CSS, and the regression test are changed. No service action, schema, copy, or database changes appear.

### Task 4: Verify the feature and finish

**Files:**
- Test: \`scripts/service-plan-form-ui.test.ts\`
- Test: \`scripts/service-plan-responsible-picker.test.ts\`
- Verify: \`components/service-procurement/ServicePlanForm.tsx\` and \`app/globals.css\` through the detector and rendered route.

**Interfaces:**
- Consumes: completed checkbox markup and CSS.
- Produces: verified desktop and narrow-width behavior while preserving unrelated worktree changes.

- [ ] **Step 1: Run focused tests**

Run:

~~~bash
npm run test:service-procurement
npm run test:required-field-markers
~~~

Expected: both commands exit 0 and report their existing success messages.

- [ ] **Step 2: Run lint and typecheck**

Run:

~~~bash
npm run lint
npm run typecheck
~~~

Expected: both commands exit 0 with no new diagnostics.

- [ ] **Step 3: Run the required Impeccable detector once**

Run:

~~~bash
node C:\Users\User\.agents\skills\impeccable\scripts\detect.mjs --json components/service-procurement/ServicePlanForm.tsx app/globals.css
~~~

Expected: no new high-severity findings for oversized controls, focus states, or missing interaction states. Review output against the approved design system.

- [ ] **Step 4: Run a production build**

Run \`npm run build\`.

Expected: Next.js production build exits 0. Preserve the pre-existing \`next-env.d.ts\` change and do not include it in the feature commit unless independently required by the build.

- [ ] **Step 5: Commit the implementation**

Run:

~~~bash
git add -- app/globals.css components/service-procurement/ServicePlanForm.tsx scripts/service-plan-form-ui.test.ts docs/superpowers/plans/2026-08-29-service-plan-checkbox-polish.md
git commit -m "fix: polish service plan checkboxes"
~~~

Expected: a focused commit contains the implementation, regression test, and plan; unrelated \`next-env.d.ts\` remains unstaged.
