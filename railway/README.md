# Railway configuration — NanoClaw

This project defines its Railway infrastructure as code in `.railway/railway.ts`
(Railway Infrastructure-as-Code / IaC). It manages the **nanoclaw** Railway
project: the host (with its agent runtime), the OneCLI gateway, and the
Postgres database. The Railway deploy is a **host-runtime** deployment — the
host runs directly in one container (`NANOCLAW_RUNTIME=host`), no per-session
Docker containers.

```txt
.railway/railway.ts   # IaC declaration (host + onecli + postgres)
railway.json          # root deploy config (DOCKERFILE builder)
railway/Dockerfile.railway  # the host image
railway/entrypoint.sh # volume dirs + upgrade-marker stamp, then exec host
```

---

## Architecture

| Service | Source | Runs | Public domain? |
|---|---|---|---|
| `nanoclaw` | `railway/Dockerfile.railway` (this repo, `main` branch) | Node host + Bun agent-runner + Chromium, OpenCode/DeepSeek agent, WhatsApp (Baileys) + Telegram channels | ❌ default — only if you want the health endpoint exposed |
| `nanoclaw-onecli` | `ghcr.io/onecli/onecli:latest` (official image) | OneCLI gateway + web UI (ports 10254/10255) | ❌ **no — private network only** |
| `nanoclaw-db` | Railway-hosted Postgres | The central DB (`v2.db` lives in Postgres; session DBs are SQLite files under the host's volume) | ❌ internal only |

The host reaches the gateway over the **private network** via reference
variables (`${{nanoclaw-onecli.RAILWAY_PRIVATE_DOMAIN}}`). The gateway's
`DATABASE_URL` points at the Postgres resource the same way
(`${{nanoclaw-db.DATABASE_URL}}`).

---

## Prerequisites

- Railway CLI: `brew install railway` (or `railway upgrade --yes`)
- `railway login` from the repo root; verify with `railway whoami`
- The IaC runner ships as the `railway` devDependency (pinned `railway@3.8.1`)
  — `pnpm install` once after cloning, then `pnpm railway ...` works

---

## Deploy-from-scratch runbook

### 1. Create the project + link

```bash
railway init --name nanoclaw --workspace <workspace>
```

### 2. Plan + apply the IaC

```bash
pnpm railway config plan                      # review (safe, read-only)
pnpm railway config apply --yes --confirm-destructive
```

This creates the three resources and the group. `.railway/railway.ts` is
committed — always run the plan from the repo root where `.railway/` exists.

### 3. Set secret env vars (per service)

Secrets are declared as `preserve()` in `railway.ts` — the IaC apply never
overwrites them, and they never land in git. Set them once per service after
the first apply (use `--skip-deploys` while still setting up, then redeploy
when ready):

```bash
railway variable set --service nanoclaw --skip-deploys "KEY=value"
railway variable set --service nanoclaw-onecli --skip-deploys "KEY=value"
```

**`nanoclaw` preserve() vars:**

| Var | Value |
|---|---|
| `NANOCLAW_BOOTSTRAP` | `1` (first boot provisions the owner + DM agent from env) |
| `NANOCLAW_OWNER_ID` | your Telegram/WhatsApp identity, e.g. `telegram:<user-id>` |
| `NANOCLAW_OWNER_DISPLAY_NAME` | your display name |
| `NANOCLAW_AGENT_NAME` | the agent's name in channels |
| `NANOCLAW_BOOTSTRAP_CHANNELS` | `telegram,whatsapp` |
| `OPENCODE_PROVIDER` | `deepseek` |
| `OPENCODE_MODEL` | `deepseek/deepseek-chat` |
| `OPENCODE_SMALL_MODEL` | `deepseek/deepseek-chat` |
| `ANTHROPIC_BASE_URL` | `https://api.deepseek.com/v1` |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token |
| `WHATSAPP_PHONE` | WhatsApp phone number (pairing) |
| `WHATSAPP_PAIRING_CODE` | WhatsApp pairing code |
| `TZ` | install timezone, e.g. `Asia/Jerusalem` |
| `ONECLI_API_KEY` | OneCLI API key (see step 6) |

**`nanoclaw-onecli` preserve() vars:**

| Var | Value |
|---|---|
| `NEXTAUTH_SECRET` | random secret for the gateway web UI |

### 4. Attach volumes

- `nanoclaw` → mount path **`/data`** (the host's `NANOCLAW_HOME`; session
  SQLite DBs + groups + store persist here)
- `nanoclaw-onecli` → mount path **`/app/data`** (gateway state + vault keys)

Do this in the Railway dashboard (Service → Volumes → New Volume), or:

```bash
railway volume add --service nanoclaw --mount-path /data
railway volume add --service nanoclaw-onecli --mount-path /app/data
```

### 5. Trigger the first build

```bash
railway redeploy --service nanoclaw -y
railway redeploy --service nanoclaw-onecli -y
```

The `nanoclaw` build runs `railway/Dockerfile.railway` with the **repo root as
build context**. On boot the entrypoint stamps the upgrade marker
(`data/upgrade-state.json`, `via: "railway"`) so the host's boot gate passes —
every deploy ships code + marker as one image, a sanctioned state by
construction.

### 6. OneCLI setup

The gateway web UI runs on port 10254 (API on 10255) — **private network
only**, no public domain. Reach it via port-forward:

```bash
railway connect --service nanoclaw-onecli    # follow the interactive picker
# or, from a local shell with the CLI:
onecli --api-key <ONECLI_API_KEY> --help     # use the URL http://127.0.0.1:10254
```

1. Open the web UI at `http://127.0.0.1:10254`, log in, create an agent.
2. Register the DeepSeek secret with the matching host pattern:
   ```bash
   onecli secrets create \
     --host-pattern "api.deepseek.com" \
     --header-name Authorization \
     --value-format "Bearer {value}" \
     --value "<DEEPSEEK_API_KEY>"
   ```
3. Grant it to the agent (set-secrets **replaces** the list — read first,
   merge, then set; see `.agents/skills/add-opencode/SKILL.md`):
   ```bash
   onecli agents list
   onecli agents set-secrets --id <AGENT_ID> --secret-ids <MERGED_LIST>
   ```
4. Create an API key for the host and set it as the host's `ONECLI_API_KEY`
   (the host injects it via `ONECLI_URL` + `ONECLI_API_KEY` env).

### 7. WhatsApp pairing

Baileys pairing is QR-less on this setup — read the pairing code from the host
logs:

```bash
railway logs --service nanoclaw
# look for the pairing-code log line, then:
# WhatsApp > Settings > Linked Devices > Link a Device > Pair with a phone number
```

### 8. Verify

```bash
railway logs --service nanoclaw          # should show host boot + channels up
```

Telegram DM → welcome message → DeepSeek-backed reply (any provider you
configured). Check `railway logs --service nanoclaw` for the routing chain.

---

## Sync flow

```bash
git fetch upstream && git merge upstream/main
```

The conflict surface is the fork-local files: `src/container-runner.ts`,
`src/container-runtime.ts`, `src/config.ts`, agent-runner path defaults,
`package.json` deps, and the barrel imports. Resolve, then push to `main` —
Railway auto-deploys both services from the `main` branch (GitHub source).

---

## Known limitations

- **No OS isolation** — child processes (the Bun agent-runner, Chromium, CLIs)
  run inside the single host container, not per-session Docker containers.
- **No `install_packages`** — the self-mod install_packages flow rebuilds a
  Docker image; in host mode there's no image rebuild path. Node-level changes
  land only via a redeploy.
- **No egress lockdown** — the container has unrestricted outbound network.
- **`ncl` CLI is not reachable remotely** — the host's `ncl` Unix socket is
  local-only. Provisioning goes through the bootstrap env vars, and live
  queries via `railway exec --service nanoclaw` / logs.
- **Health endpoint** — `GET /healthz` (any path) returns 200 once the host is
  up; no public domain is generated by default.

---

## Pitfalls (learned on this project + torup)

1. **Build context = repo root — no `rootDirectory`.** `railway/Dockerfile.railway`
   COPYs repo-root paths (`container/...`, `package.json`). Setting
   `rootDirectory` breaks every COPY with "not found".
2. **Raw `${{...}}` strings only.** `env` values must be plain string literals
   like `"http://${{nanoclaw-onecli.RAILWAY_PRIVATE_DOMAIN}}:10254"`. Template
   literals (`\`http://${gateway.env.X}\``) interpolate a VariableValue object
   and produce `[object Object]` silently.
3. **`preserve()` must be imported** from `railway/iac`, or the plan fails
   with "preserve is not defined".
4. **Never overwrite reference variables via the CLI.** `railway variable set
   "ONECLI_URL=..."` with a literal value silently removes the canvas arrow.
5. **`pnpm railway config plan` needs `.railway/` in the worktree.** Run from
   the repo root with the directory committed/present; the runner compiles
   `railway.ts` with tsx on the fly.
6. **Upgrade marker is stamped by the entrypoint** (`via: 'railway'`) — the
   host's boot tripwire (`enforceUpgradeTripwire`) refuses to start without a
   matching `data/upgrade-state.json`, and a fresh volume has none. Never
   remove the stamp from `railway/entrypoint.sh`.
7. **Baileys `7.0.0-rc.9`** is upstream's pin and has a **known public
   advisory** (GHSA-qvv5-jq5g-4cgg, fixed in 6.7.22+/rc.12). Track the
   upstream bump before trusting WhatsApp in production.
8. **`railway config init --force` overwrites `railway.ts`.** Always restore
   the committed file after regenerating the scaffold.

---

## IaC reference

- `pnpm railway config plan` — safe preview, no changes.
- `pnpm railway config apply [--yes] [--confirm-destructive]` — applies the
  config to the linked project + environment.
- Full DSL reference: https://docs.railway.com/infrastructure-as-code
