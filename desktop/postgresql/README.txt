Place a compatible PostgreSQL client bundle here before building if the
installer should include pg_dump.exe.

Expected layout:
  pg_dump.exe
  *.dll

The repository intentionally does not commit PostgreSQL binaries. The app
also supports selecting an existing pg_dump.exe during first-run setup.
