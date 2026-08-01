# Vercel environment recovery — design

Restore a usable deployment path without mixing Staging and Production data or
advancing the database cutover before its recovery prerequisites are ready.

## Why

The canonical deployment returns HTTP 500 for every route handled by
`proxy.ts`, including `/login`. Vercel reports the deployment as `Ready`, but
`vercel env ls production` reports no configured variables. Runtime logs show
the Supabase client aborting because its project URL and key are absent.

The deployed artifact is also stale: it was created on 2026-07-30, while the
current `main` contains the completed equipment-lease work through 2026-08-01.
This is an environment and release-state failure, not an application-logic
failure.

## Scope

In:

- configure the three runtime Supabase variables in Vercel with strict
  environment separation;
- deploy the current commit to Preview against Staging;
- verify public routing, authentication boundaries, the Staging smoke suite,
  and runtime logs;
- record the resulting deployment evidence and remaining cutover blocker.

Out:

- enabling PITR, which remains a Supabase Dashboard action for the release
  owner;
- applying any migration to Production;
- copying contract documents, importing data, promoting to Production, or
  changing the legacy portal;
- changing application behavior to hide a missing deployment secret.

## Environment boundary

The same three keys exist in both Vercel scopes, but their values come from
different ignored local sources:

| Vercel scope | Supabase target | Source of values |
|---|---|---|
| Preview | LABCBH Stock Staging (`stogulcfwsvunydmwrex`) | `.env.local` |
| Production | Lab_management Production (`fslagsuorkcckvvtrmyi`) | `.env.production-backup.local` |

The required keys are `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`. Only their
names and target project refs may appear in logs. Secret values must never be
printed, committed, or copied into tracked files.

Preview must never receive Production credentials, and the production alias
must never point at Staging. E2E fixture variables stay outside Vercel and are
supplied only to the explicit Staging test run.

## Deployment flow

1. Read each required value from its ignored source file and add it to the
   matching Vercel scope as a sensitive value.
2. List the Vercel variables for Preview and Production and verify the three
   names are present in each scope without displaying values.
3. Deploy the current `main` commit to an immutable Preview URL. Do not deploy
   or promote to Production.
4. Verify `/login` renders and unauthenticated protected routes redirect to it.
5. Run the Staging smoke procedure with isolated, freshly seeded fixtures and
   one Playwright worker.
6. Inspect Preview runtime logs for new errors and record the commit SHA,
   deployment ID, URL, target project ref, test result, and timestamp.
7. Update `docs/STATUS.md`: Preview is ready, while Production promotion stays
   blocked by PITR and the production migration gate.

Environment changes do not repair an existing deployment retroactively. The
currently broken production deployment remains unpromoted and must not be used
as evidence that the new configuration works.

## Failure handling

- If either source file is missing a required key, stop before changing Vercel.
- If the project ref does not match the table above, stop before deployment.
- If Vercel shows a required key in the wrong scope, correct the scope before
  deploying.
- If Preview returns 500, inspect its runtime logs and stop; do not compensate
  by pointing it at Production.
- If a smoke test mutates or consumes a fixture, reseed that fixture before a
  retry as documented in `docs/runbooks/e2e-staging.md`.
- If Preview passes, do not infer that Production is ready. Database migration,
  document copy, production smoke, approval, and portal handoff retain their
  separate gates.

## Verification

The recovery is accepted only when all of these have fresh evidence:

- Vercel lists exactly the required runtime key names in Preview and
  Production;
- the immutable Preview deployment identifies the current Git commit;
- `/login` returns 200 and an unauthenticated protected route redirects to
  `/login`;
- the full local verification gate passes;
- the fixture-backed Playwright smoke suite passes against Preview with
  `--workers=1`;
- a post-test Preview log scan contains no new application errors or secret
  values;
- `git diff --check` is clean and the status document reflects what is proven
  versus what remains blocked.

## Production gate

No production deployment, database migration, storage copy, import, or portal
handoff occurs in this recovery. The next release phase begins only after the
release owner enables PITR and records a restorable backup. At that point the
cutover runbook governs migration, production-targeted validation, explicit
approval, promotion, and rollback readiness.
