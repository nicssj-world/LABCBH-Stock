# CLAUDE.md

Guidance for Claude Code working in this repository. Read [README.md](README.md)
first for what the system does; this file covers how to work in it and the
things that have already cost time.

## Non-negotiables

- **All writes go through a Postgres RPC called with `supabaseAdmin`.** Never
  write to a table from application code. The rules that must not be bypassed —
  over-budget, FIFO, idempotent posting, concurrency guards — live in those
  functions under row locks, in the same transaction as the write. Application
  checks exist only so the UI can hide what the database would refuse.
- **Migrations are forward-only.** Add a new file; never edit an applied one.
- **Never touch `public.contract_usage`'s rows.** The table belongs to the
  legacy portal and holds two years of real financial history.
- **Nothing is deleted from Cloudflare R2.** Contract documents are copied out;
  originals stay so a rollback leaves the portal working.
- Thai user-facing copy, matching `lib/contracts/presenter.ts`.

## Current operating state

LABCBH Stock is the live contract-management surface. The Lab Management Portal
links **บริหารสัญญา** to `/dashboard` here; preserve that handoff and do not
replace live reads with mock data. The portal remains the shared identity and
profile-image source.

Current application roles are `admin`, `head`, `stock_officer`, and `viewer`.
The UI calls `head` **หัวหน้างาน** and `viewer` **ผู้ดูข้อมูล**. `reporter` was
retired by a forward migration: do not add it back to schemas, access controls,
or UI. The portal's `Manager` role remains an intrinsic `head` role, and E-Phis
`9495` remains intrinsic `admin`.

The existing portal-user seed grants missing active profiles the `viewer` role;
an explicit membership selected by an admin always wins. Do not confuse this
one-time/default import with permission to overwrite an administrator's choice.

## Domain: two contract modes

Read the table in the README. When touching anything contract-shaped, ask which
mode it belongs to. `contractMode(contractType)` in `lib/contracts/budget.ts` is
the single place that decides; use it rather than comparing strings.

A lease has **no line items**, and four separate layers enforce that — the two
zod schemas, and the `create_contract` and `update_contract` RPCs. Changing one
without the others moves the failure rather than fixing it.

### Contract register behaviour

- The default register shows the latest five fiscal years and excludes ended
  contracts. `showOlder=1` and `showEnded=1` are intentional, independent URL
  visibility controls; preserve them when adding or clearing interactive
  filters.
- Selecting a fiscal year must always show that year, including older years.
- `expired` is the effective terminal state. Only admins can manually end a
  started contract; archiving is only for a mistaken or duplicate record, not a
  normal contract ending.
- Started contracts collapse the six-stage history behind `StageHistoryDisclosure`
  and do not show the next-stage action.
- Lease spending is entered per month through the budget flow. It has to retain
  its database over-budget guard, its responsible-user exception, exports,
  selected history limit, and in-page private-file preview.

## Module conventions

`lib/<domain>/` splits the same way every time:

| File | Holds |
|---|---|
| `schema.ts` | zod input schemas, the `as const` enums |
| `types.ts` | types inferred from those schemas, plus record interfaces |
| `authorization.ts` | actor predicates mirroring the RPC's rules |
| `queries.ts` | reads, parsed with zod before mapping to camelCase |
| `actions.ts` | `'use server'`, `requireActor()` then `supabaseAdmin.rpc(...)` |
| `presenter.ts` | display labels and derived strings |

A `'use server'` file may only export async functions. Pure helpers need their
own module — see `lib/contracts/files.ts` next to `file-actions.ts`, and
`lib/receipts/storage.ts` next to `actions.ts`.

## Testing

Suites are plain `node:assert/strict` scripts run with `tsx`, registered in
`package.json` and chained into `verify`. Comments explain *why* a case matters,
not what it asserts.

Schema and transaction tests **assert against migration SQL text**, not a live
database — see `scripts/contracts-schema.test.ts`. They check that a lock is
taken before a sum is computed, that grants are revoked, that a guard exists.
When a claim needs a real database, use Docker (below) and record the output in
the commit message.

### Proving something against a real database

```bash
docker run -d --name scratch -e POSTGRES_PASSWORD=postgres -p 55434:5432 postgres:17
# apply the portal base schema, then every migration in filename order
docker rm -f scratch
```

`docs/runbooks/rollback-rehearsal.md` documents the harness. Plain `postgres:17`
needs stubs the migrations assume: the `anon` / `authenticated` / `service_role`
roles, an `auth` schema with `uid()` and `role()`, `public.get_my_role()`, and a
`storage` schema with `buckets` and `objects`.

### End-to-end

`docs/runbooks/e2e-staging.md` is the procedure. Three things are not
discoverable from the specs:

- `--workers=1` is required. In parallel the receiving spec posts the same draft
  receipt the dashboard spec expects to still be a draft.
- Run against `npm run build && npm start`, not `next dev`. On a cold dev server
  the login form can submit natively before hydration, which sends the password
  as a query parameter and fails the login.
- Under Git Bash, set `MSYS_NO_PATHCONV=1` and pass absolute fixture URLs, or a
  leading `/` is rewritten into a Windows path.

Fixtures are consumed by the runs that use them; reseed before each run.

## Supabase projects

| | Ref | Use |
|---|---|---|
| Lab_management Project | `fslagsuorkcckvvtrmyi` | **Production.** Legacy portal data. Not yet migrated. |
| LABCBH Stock Staging | `stogulcfwsvunydmwrex` | Development and E2E. Carries all migrations. |

`.env.local` decides which one the app talks to. Check it before assuming what
you are looking at.

**`supabase db push` silently applies nothing** while `[db.migrations] enabled`
is `false` in `supabase/config.toml`, which is how it ships. To push, set that
one line to `true` and restore it afterwards. Do not do a blanket replace of
`enabled = false` — it also switches on `[auth.sms.twilio]`, and the push then
fails validation on its empty `account_sid`.

## Money

Compared in satang: `Math.round(value * 100)`. Float drift otherwise leaves a
fraction on an exactly-exhausted budget.

A `null` total means the ceiling is **unknown**, not zero. The two mean opposite
things to whoever is deciding whether there is room to spend, so the UI says
"ไม่ระบุ" rather than drawing an empty bar.

## UI

Follow the existing design system — `bench-panel`, `data-table`, `section-kicker`,
`identifier`, `empty-state`, `form-error`, `StatusChip`, `Button`. Styles live in
`app/globals.css` against the `--lab-*` custom properties. Do not introduce
inline styles or a second styling approach.

`AppShell` has two navigation modes: at desktop width its header control toggles
the compact icon-only side menu; at `800px` and below the separate menu control
opens the slide-in rail. Retain labels through `aria-label` and `title` whenever
the text is visually hidden, and keep the mobile overlay/Escape close behaviour.

Client components that mutate follow `StageAdvanceControl.tsx`: `useTransition`,
try/catch around the action, surface the server error verbatim — it carries the
authoritative number.

Playwright's `toBeVisible()` does **not** detect occlusion. An element can pass
that assertion while sitting under the sticky `.form-action-bar`. Compare
bounding boxes when layout is the thing in question.

## Before claiming something works

Run the command and read the output. `npm run verify` is the gate. For anything
touching the database, prove it against a real one. For anything touching the
UI, open it — a build that compiles is not a page that renders.
