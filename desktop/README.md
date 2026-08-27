# LABCBH Backup desktop app

This folder contains the Windows desktop runner used to create PostgreSQL
custom-format backups on a trusted local machine. The app supports two logical
system profiles that point to the same Production database:

- `LABCBH Stock` (`fslagsuorkcckvvtrmyi`)
- `LabManagement Portal` (`fslagsuorkcckvvtrmyi`)

Choose the system from the profile selector before configuring or running a
backup. Both profiles are aliases for the shared Production database, so one
connection setup and one dump protect both LABCBH Stock and LabManagement
Portal. The default folder is under `Documents\LABCBH Backups\LABCBH Production (Stock + Portal)\`.

The staging project `stogulcfwsvunydmwrex` is intentionally excluded. The app
rejects it even if someone enters the staging URL manually.

## Build and run

From the repository root:

```text
npm run backup:desktop
npm run backup:desktop:build
```

The installer is emitted under `release/` after `backup:desktop:build`.

The app intentionally does not commit a PostgreSQL client binary. During
first-run setup, choose an existing `pg_dump.exe` or place a compatible,
licensed client bundle in `desktop/postgresql/` before building.

## First-run setup

1. Select `LABCBH Stock` or `LabManagement Portal` as the system label.
2. Use the shared Production Supabase URL
   `https://fslagsuorkcckvvtrmyi.supabase.co`, then enter its service role key
   and PostgreSQL direct connection string. The database URL must belong to
   project `fslagsuorkcckvvtrmyi`.
3. Choose the local backup folder and the `pg_dump.exe` path if it
   is not on `PATH`.
4. Test the connection, then run a manual backup or enable the monthly
   Windows Task Scheduler entry. Do not configure a second task for the other
   profile; it points to the same database.

The app keeps the profile-specific task names
`LABCBH Database Backup - stock` and `LABCBH Database Backup - portal` for
compatibility, but only one of them should be enabled for the shared database.
The recommended task is `LABCBH Database Backup - stock`.

The scheduled task runs under the Windows account that configured the app;
the computer must be powered on and that account must be signed in when the
monthly task is due.

The service role key and database connection string are encrypted with
Electron's Windows protected storage. They are never returned to the
renderer, written to the app log, or sent through the Next.js/Vercel app.
