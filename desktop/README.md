# LABCBH Backup desktop app

This folder contains the Windows desktop runner used to create PostgreSQL
custom-format backups on a trusted local machine. The app supports two
independent project profiles:

- `LABCBH Stock` (`stogulcfwsvunydmwrex`)
- `LabManagement Portal` (`fslagsuorkcckvvtrmyi`)

Choose the project from the profile selector before configuring or running a
backup. Each profile keeps its own connection credentials, local folder,
schedule, status, and backup history. The default folders are under
`Documents\LABCBH Backups\`.

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

1. Select `LABCBH Stock` or `LabManagement Portal`.
2. Enter that project's Supabase URL, service role key, and PostgreSQL direct
   connection string. The database URL must belong to the selected project.
3. Choose that profile's local backup folder and the `pg_dump.exe` path if it
   is not on `PATH`.
4. Test the connection, then run a manual backup or enable the monthly
   Windows Task Scheduler entry. Repeat for the other profile if both projects
   should be protected.

The app creates separate scheduled tasks named
`LABCBH Database Backup - stock` and `LABCBH Database Backup - portal`. A
schedule can be enabled for either project independently.

The scheduled task runs under the Windows account that configured the app;
the computer must be powered on and that account must be signed in when the
monthly task is due.

The service role key and database connection string are encrypted with
Electron's Windows protected storage. They are never returned to the
renderer, written to the app log, or sent through the Next.js/Vercel app.
