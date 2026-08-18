# Railway Deployment — Secrets (create & update)

The Railway deployment has **two credential stores**, split by who uses the
credential:

| Store | Holds | Used by | Example |
|---|---|---|---|
| **Railway service variables** (`nanoclaw` service) | Host-side credentials + config | The host process (channel adapters, bootstrap, gateway access) | `TELEGRAM_BOT_TOKEN`, `NANOCLAW_OWNER_ID`, `ONECLI_API_KEY` |
| **OneCLI vault** (gateway web UI) | Agent-facing credentials | The agent's outbound HTTP calls (injected at request time via the proxy) | DeepSeek API key (`api.deepseek.com`) |

Rule of thumb: if the **agent** calls the API (LLM, MCP services), the key goes
in **OneCLI**. If the **host** calls it (Telegram/WhatsApp APIs), it goes in
**Railway variables**.

---

## 1. Railway service variables (host-side secrets)

### Create / update

Dashboard: project → `nanoclaw` service → **Variables** → add/edit a row →
**Deploy** the service.

CLI (value overwrites on re-set):

```bash
railway variable set --service nanoclaw --skip-deploys "TELEGRAM_BOT_TOKEN=<token>"
railway variable delete --service nanoclaw TELEGRAM_BOT_TOKE   # fix a typo'd name
railway redeploy --service nanoclaw --from-source -y            # apply after --skip-deploys
```

### Typical variables

| Variable | Purpose |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Telegram adapter (host-side) |
| `WHATSAPP_PHONE_NUMBER`, `WHATSAPP_ENABLED=true` | WhatsApp adapter (host-side) |
| `NANOCLAW_OWNER_ID` | `channel:handle` owner identity (`telegram:905808239`) |
| `NANOCLAW_BOOTSTRAP=1` + `NANOCLAW_BOOTSTRAP_CHANNELS` | First-run provisioning (no-op once a user exists) |
| `ONECLI_API_KEY` | Host → gateway API key (generated in the OneCLI UI, below) |
| `OPENCODE_PROVIDER/MODEL/SMALL_MODEL`, `ANTHROPIC_BASE_URL` | OpenCode provider config (DeepSeek: `deepseek/deepseek-chat`, `https://api.deepseek.com/v1`) |
| `TZ` | Install timezone, e.g. `Asia/Jerusalem` |

Secrets are `preserve()`-declared in `.railway/railway.ts` — IaC applies never
overwrite them, and they never land in git.

---

## 2. OneCLI vault (agent-facing secrets)

The gateway runs as its own service (`nanoclaw-onecli`), web UI on port
**10254**, proxy on **10255** (both pinned; Railway's injected `PORT` would
otherwise collide).

### Reach the UI

```bash
ssh -L 10254:127.0.0.1:10254 railway-nanoclaw-onecli   # keep this terminal open
# browser → http://127.0.0.1:10254
```

(Refresh the instance after a redeploy: `railway ssh config`.)

### Create a secret (e.g. DeepSeek)

UI: **Secrets → Create**:

| Field | DeepSeek example |
|---|---|
| Name | `DeepSeek` |
| Type | `generic` |
| Value | `sk-...` (the real API key) |
| Host pattern | `api.deepseek.com` |
| Header | `Authorization` |
| Value format | `Bearer {value}` |

Agents auto-created by the host default to **`all` secret mode** — every vault
secret whose host pattern matches is injected automatically, no per-agent
assignment needed. (If an agent is in `selective` mode it gets nothing until
assigned: `onecli agents set-secrets --id <agent-id> --secret-ids ...`.)

### Update / rotate a secret

UI: **Secrets → edit** the row, save — new value applies from the next agent
request (no redeploy needed; the gateway resolves per request). Or via CLI:

```bash
onecli secrets update --id <secret-id> --value <new-value>
```

### Generate the host's `ONECLI_API_KEY`

UI: **Settings → API keys → Create** → copy the key → set it on the host
service (section 1), then redeploy the host.

---

## 3. Where things break (and what it means)

| Symptom | Cause / fix |
|---|---|
| `Channel credentials missing, skipping channel="telegram"` | Variable name typo (e.g. `TELEGRAM_BOT_TOKE`) or set on the wrong service; fix + redeploy |
| `OneCLI gateway not applied — refusing to spawn agent` in host logs | `ONECLI_API_KEY` unset/invalid, or gateway unreachable — message stays pending, retried by the sweep |
| Agent `401` from an API whose key *is* in the vault | Agent is in `selective` mode — assign the secret (`onecli agents set-secrets`), or switch to `all` |
| Every credentialed call hangs | Host approval callback not running (see `src/modules/approvals/onecli-approvals.ts`) or a gateway rule asks for approval nobody answered |
| Secret changed but agent still uses the old one | Gateway resolves per request — check the secret's host pattern matches the URL the agent actually calls |

---

## 4. Rotation checklist

1. Create the new value in the right store (Railway variable or OneCLI secret).
2. Railway variables: redeploy the `nanoclaw` service. OneCLI secrets: nothing
   to redeploy.
3. Verify with a fresh agent message and `railway logs --service nanoclaw`.
4. Remove the old value only after the new one is confirmed working.
