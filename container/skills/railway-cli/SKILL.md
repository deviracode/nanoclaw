---
name: railway-cli
description: Manage Railway deployments via the railway CLI — status, logs, deployments, IaC plans. Use when asked about the nanoclaw Railway deployment, deploys, or logs.
---

# Railway CLI

You can inspect and manage the NanoClaw Railway deployment with the `railway`
CLI (project `nanoclaw` on the Deviracode workspace).

## Auth

Auth is handled by OneCLI — the HTTPS_PROXY injects the real token into
`api.railway.com` requests automatically. The CLI needs `RAILWAY_API_TOKEN`
(already set as a placeholder) to skip its login check.

Before any operation, verify auth:

```bash
railway whoami
```

If it fails with an auth error, ask the user to add a Railway token to OneCLI
(host pattern `api.railway.com`, header `Authorization`, format
`Bearer {value}`) and grant it to the agent.

## Core workflows

```bash
# Project context (no login prompt needed)
railway whoami
railway status
railway list

# The nanoclaw project
railway status --project nanoclaw
railway logs --service nanoclaw --lines 100
railway deployment list --service nanoclaw
```

## Notes

- Never run `railway login` — the token flows through the proxy, and the CLI
  treats the placeholder `RAILWAY_API_TOKEN` as authenticated.
- Prefer read-only commands (`status`, `logs`, `deployment list`, `config
  plan`) unless the user explicitly asks for a change.
- `railway variable` commands expose secret VALUES in output — avoid dumping
  variable lists; use `--json` and redact values if you must.
