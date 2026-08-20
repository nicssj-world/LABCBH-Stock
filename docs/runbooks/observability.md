# Operational checks without changing workflow

These checks are read-only. They are intended to make a release auditable
without adding a new approval, posting, receiving, or stock-issue state.

## Before applying the lot identity migration

Set the env file and expected project ref explicitly, then run:

```bash
LOT_PREFLIGHT_ENV_FILE=.env.local \
LOT_PREFLIGHT_EXPECTED_REF=stogulcfwsvunydmwrex \
npm run preflight:lots
```

The command stops when two rows for the same inventory item normalize to the
same lot key (`UPPER(TRIM(lot_number))`). The migration also stops at that
point; neither step silently merges lots or rewrites `stock_movements`.

## Release gates

- Run `npm run verify` for static, type, domain, schema, and build checks.
- Run `npm run test:e2e:strict` only with isolated staging/preview fixtures and
  `E2E_ALLOW_MUTATIONS=1`. The preflight refuses missing fixture URLs or
  credentials.
- Keep the staging run serial (`--workers=1`) because the receiving smoke test
  posts its fixture and the other smoke tests read it.

## After a release

Check Vercel runtime logs for unexpected errors, Supabase Database Advisor and
Auth/Storage logs for the release window, and record the migration list and
E2E report in the release ticket. A failed read-only check is a release
blocker; it does not justify changing a business-state rule at runtime.

The free plan has no PITR in this project. Before a production schema/data
change, create and hash the approved manual backup using the cutover runbook;
do not treat a green UI smoke test as a backup or rollback proof.
