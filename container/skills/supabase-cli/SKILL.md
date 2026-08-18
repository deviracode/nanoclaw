---
name: supabase-cli
description: Work with Supabase projects via the supabase CLI — migrations, database queries, project management. Use when asked to run migrations or query a Supabase database.
---

# Supabase CLI

You can manage Supabase projects with the `supabase` CLI: migrations, database
queries, and project info.

## Auth

Auth is handled by OneCLI — the HTTPS_PROXY injects the real token into
`api.supabase.com` requests automatically. `SUPABASE_ACCESS_TOKEN` is already
set as a placeholder so the CLI skips its login check.

Before any operation, verify auth:

```bash
supabase projects list
```

If it fails with an auth error, ask the user to add a Supabase access token to
OneCLI (host pattern `api.supabase.com`, header `Authorization`, format
`Bearer {value}`) and grant it to the agent.

## Core workflows

```bash
# Projects
supabase projects list

# Migrations (run from a repo checkout with supabase config)
# cd into the project dir first (e.g. a cloned torup checkout):
supabase db push --project-ref <project-ref> --db-url "$SUPABASE_DB_URL"
supabase migration list --project-ref <project-ref> --db-url "$SUPABASE_DB_URL"

# Raw queries
supabase db execute --project-ref <project-ref> --db-url "$SUPABASE_DB_URL" \
  --file /tmp/query.sql
```

## Notes

- `--db-url` is required for db operations when the CLI can't link a local
  checkout — ask the user for the connection string if it isn't in the
  environment.
- Project-refs come from `supabase projects list` output.
- Never print database credentials or tokens.
