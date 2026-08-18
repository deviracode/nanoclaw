# NanoClaw on Railway — Deployment Design

Date: 2026-08-14
Status: Approved (design review)

## Context & Goals

Deploy NanoClaw v2 (this fork, `deviracode/nanoclaw`) to Railway, while keeping the
repo synced with upstream source `nanocoai/nanoclaw`. There is an existing v1-based
Railway port (`arnaudjnn/nanoclaw-railway`) whose approach we borrow conceptually
(child-process agents, persistent volume at `/data`, multi-stage image bundling
Chromium + CLIs) — but it is based on the old v1 codebase and cannot merge with v2.

Decisions taken during brainstorming:

| Topic | Decision |
|---|---|
| Base | v2 (this repo) |
| Deploy repo | This repo (fork of nanocoai/nanoclaw, upstream remote already configured) |
| Channels | WhatsApp + Telegram, committed into the fork (skill-pinned deps) |
| Agent provider | **OpenCode** (default), committed from the `providers` branch; `claude` stays available per-group as fallback |
| Credentials | OneCLI gateway as a separate Railway service (private network) — injects OpenCode provider keys via `HTTPS_PROXY` + `--host-pattern` (e.g. `openrouter.ai`, `api.deepseek.com`) |
| Deploy transport | Railway git auto-deploy on push to `main`; `railway up` optional |
| Build | Dockerfile (Nixpacks cannot express apt/Bun/global CLIs) |
| Config | Railway IaC (`.railway/railway.ts`), mirroring the torup project pattern |
| Sync | Manual `git fetch upstream && git merge`; conflicts limited to ~4 small files |

Railway constraints that shape the design:

- No Docker daemon, no privileged mode → v2's per-session `docker run` spawns must
  become child-process spawns (`NANOCLAW_RUNTIME=host`).
- Container filesystem is ephemeral → volume at `/data` for all state.
- No local shell → first-run provisioning must be env-driven.
- Agents are child processes sharing the host filesystem → no OS isolation
  (same trade-off the v1 railway project accepted for personal use).

## Part 1 — Host-runtime mode + agent-runner path config

### Runtime seam

`NANOCLAW_RUNTIME=host` env switch; default (unset) behavior is byte-identical to
today's Docker path.

- `src/container-runtime.ts` becomes the single spawn seam. The direct `docker`
  calls move out of `src/container-runner.ts` into it:
  - **Spawn**: instead of `docker run ...`, `spawn(bun, [src/index.ts], { env, cwd })`.
    Each `VolumeMount` translates to an env var (`WORKSPACE_DIR`, `AGENT_DIR`,
    `SRC_DIR`, `SKILLS_DIR`, `CLAUDE_HOME`). No RO mount enforcement — the agent
    can write its composed CLAUDE.md (documented trade-off; matches v1 railway).
  - **Stop**: `child.kill('SIGTERM')`. Heartbeat + host-sweep logic unchanged.
  - **No-ops**: `ensureContainerRuntimeRunning`, `cleanupOrphans` (children die
    with the Railway container), egress lockdown (no Docker network), resource
    caps / hardening / `--shm-size` flags (Railway service limits apply).
  - **Disabled with a clear error**: `buildAgentGroupImage` (self-mod
    `install_packages`) — "not supported in host runtime". `add_mcp_server`
    still works (no image rebuild needed).

### OneCLI in host mode

`onecli.applyContainerConfig(args)` appends docker args (`-e HTTPS_PROXY=...`,
cert mounts). Host mode needs a translation layer that yields the same two things
as env/cert-file form: gateway proxy env vars + CA cert written to a local file
(`NODE_EXTRA_CA_CERTS`). If the SDK exposes no host-mode API, parse the emitted
args locally. Same failure semantics: gateway unreachable → refuse to spawn,
inbound row stays pending, host-sweep retries.

### Agent-runner paths

New `container/agent-runner/src/paths.ts` reading env with docker defaults
(`/workspace`, `/workspace/agent`, `/app`, `/home/node/.claude`, DB paths).
~10 real code sites switch to it (config.ts, db/connection.ts, cli/ncl.ts,
mcp-tools/core.ts, memory/context.ts + scaffold.ts, formatter.ts, index.ts,
providers/claude.ts). Defaults unchanged → Docker mode and existing tests
untouched. This is what makes concurrent per-session child processes possible
(each gets its own env).

## Part 1b — OpenCode as the agent provider

The Railway deployment defaults to **OpenCode** as the agent backend, not the
Claude Agent SDK. This is the `/add-opencode` skill's install, committed into
the fork (same pattern as channels):

- From the `providers` branch: `src/providers/opencode.ts` + registration
  test + barrel import (host), `container/agent-runner/src/providers/opencode.ts`
  + `mcp-to-opencode.ts` + tests + barrel import (container), and
  `src/opencode-dockerfile.test.ts` (the install guard).
- `@opencode-ai/sdk@1.4.17` added to `container/agent-runner/package.json`
  (pinned — the 1.14.x SDK has a breaking session API; never bump blindly).
- `opencode-ai@1.4.17` global CLI installed in the Railway image (same pin as
  the SDK, per the skill's rule). claude-code remains installed as fallback
  so any group can still be switched with `ncl groups config update --provider`.
- **Provider selection**: bootstrap creates groups with `provider: opencode`
  (or `DEFAULT_AGENT_PROVIDER=opencode` in Railway env). Host env:
  `OPENCODE_PROVIDER`, `OPENCODE_MODEL` (`provider/model` form), optional
  `OPENCODE_SMALL_MODEL`, and `ANTHROPIC_BASE_URL` = the upstream API base
  (e.g. `https://openrouter.ai/api/v1`) for non-`anthropic` providers.
- **Credentials**: provider API keys registered in OneCLI with matching
  `--host-pattern`; the gateway injects them via `HTTPS_PROXY` — keys never
  live in Railway env or the container environment. The OneCLI service
  decision in Part 2 is unchanged (and is what makes OpenCode-with-vault
  work on Railway).

## Part 2 — Railway IaC + image + OneCLI service

### `.railway/railway.ts` (committed, torup pattern)

- **`nanoclaw`** service: `source: github("deviracode/nanoclaw", { branch: "main" })`,
  `builder: "DOCKERFILE"`, `dockerfilePath: "railway/Dockerfile.railway"`, no
  `rootDirectory` (build context = repo root — torup pitfall #1).
  `deploy: { numReplicas: 1, restartPolicyType: "ON_FAILURE", restartPolicyMaxRetries: 10 }`.
  Env: `ONECLI_URL: "http://${{nanoclaw-onecli.RAILWAY_PRIVATE_DOMAIN}}:10254"`
  (raw string syntax, never template literals — torup pitfall #4), plus
  `preserve()` for `ONECLI_API_KEY`, `TELEGRAM_BOT_TOKEN`, WhatsApp creds,
  bootstrap vars, and OpenCode host env (`OPENCODE_PROVIDER`,
  `OPENCODE_MODEL`, `OPENCODE_SMALL_MODEL`, `ANTHROPIC_BASE_URL`).
- **`nanoclaw-onecli`** service: same repo source,
  `railway/Dockerfile.onecli` (node:22-slim + `npm install -g onecli@<pin>` +
  gateway serve command on port 10254 — exact subcommand verified at
  implementation). Vault key as `preserve()`, own volume for vault state.
- **`group("NanoClaw", [nanoclaw, nanoclaw-onecli])`** — canvas arrow
  host→gateway.
- Root `railway.json` stays minimal (`builder: "DOCKERFILE"` only) — torup
  coexistence pattern.
- Tooling: `pnpm add -D railway` (devDep) for `railway config plan/apply`;
  secrets set once via `railway variable set --service <name> --skip-deploys`.

### `railway/Dockerfile.railway` (multi-stage, build context = repo root)

- **Agent stage**: pinned Bun (`BUN_VERSION` from `container/Dockerfile`),
  `bun install --frozen-lockfile` in `container/agent-runner`, ship src +
  node_modules (no tsc — Bun runs TS).
- **Host stage**: corepack pnpm, `pnpm install --frozen-lockfile`, `pnpm run build`.
- **Channels committed into the fork**: `src/channels/whatsapp.ts`,
  `src/channels/telegram.ts` + registration tests, barrel appends in
  `src/channels/index.ts`, pinned deps in `package.json` + lockfile
  (`@whiskeysockets/baileys@7.0.0-rc.9`, `qrcode@1.5.4`, `@types/qrcode@1.5.6`,
  `pino@9.6.0`, `@chat-adapter/telegram@4.29.0` — exact pins from the
  `/add-whatsapp` and `/add-telegram` skills), plus the
  `whatsapp-formatting`/`telegram-formatting` container skills under
  `container/skills/`. Reproducible builds; occasional trivial `package.json`
  merge conflicts are the only sync cost.
- **OpenCode provider committed into the fork**: per Part 1b (provider files,
  `@opencode-ai/sdk@1.4.17` in agent-runner, `opencode-ai@1.4.17` CLI in the
  final stage).
- **Final stage**: node:22-slim + Chromium + fonts + git/curl/ca-certs (apt
  list from `container/Dockerfile`), host dist + node_modules, agent-runner
  src + node_modules at `/app/agent-runner`, `container/skills` → `/app/skills`,
  `container/CLAUDE.md` → `/app/CLAUDE.md`, opencode-ai + claude-code +
  agent-browser via the existing `container/install-cli-tools.sh` pins.
- **Entrypoint** (`railway/entrypoint.sh`): ensure `/data` dirs, then
  `node dist/index.js`.
- **Healthcheck**: v2 host has no HTTP server — add a tiny health endpoint
  (plain `ok` on `PORT`, only active in host runtime) so Railway fails the
  deploy fast if the host can't boot. Healthcheck path in `railway.ts` when
  a public/private domain exists; otherwise relies on restart policy.

## Part 3 — Data persistence, bootstrap, sync, ops

### Data & persistence

- Railway volume mounted at `/data` (host and gateway each have one). If
  `railway/iac` supports volumes, declare in `railway.ts`; else one-time
  `railway volume add` + mount config (implementation detail).
- New env `NANOCLAW_HOME=/data` in `src/config.ts` → `DATA_DIR`, `GROUPS_DIR`,
  `STORE_DIR` resolve under it (default = project root; local behavior
  unchanged). All per-session DBs, WhatsApp auth state, group memory live on
  the volume → survive redeploys.

### First-run bootstrap

- New module reusing `scripts/init-first-agent.ts`'s wiring functions: on
  startup, if zero users exist and `NANOCLAW_BOOTSTRAP=1`, create the owner
  user (`NANOCLAW_OWNER_ID=telegram:<id>`), agent group (provider set to
  `opencode`), messaging groups + wirings for configured channels, grant
  owner role, send a welcome DM through the normal delivery path. Skipped on
  later boots (DB already seeded).
- WhatsApp pairing is the one manual step: adapter prints QR/pairing code to
  logs → pair from phone; auth persists on the volume.
- Channel creds (`TELEGRAM_BOT_TOKEN`, WhatsApp) via Railway env `preserve()`,
  never in git.

### Sync workflow

- Keep `upstream = nanocoai/nanoclaw`. Railway changes touch exactly:
  `src/container-runner.ts`, `src/container-runtime.ts`, `src/config.ts`,
  `container/agent-runner/src/paths.ts` + ~10 sites, new `railway/` +
  `.railway/` dirs, channel files, `package.json`/lockfile. Defaults unchanged
  → `git fetch upstream && git merge` mostly clean.
- Push to `main` → Railway auto-deploys both services.
- `railway/README.md` documents the merge flow, `railway config plan/apply`,
  and secret setup (torup README style).

### Ops & known limitations

- No OS isolation (child processes on shared filesystem); composed CLAUDE.md
  loses RO protection.
- `install_packages` self-mod disabled (clear error); `add_mcp_server` works.
- No egress lockdown, no per-container resource caps (service-level limits).
- Host `ncl` CLI not reachable remotely — provisioning via bootstrap env.
- Logs via `railway logs`; container logs lost on exit (same as local `--rm`).
- Optional later: GH Action for automated upstream sync PR; PR the runtime
  mode upstream for long-term conflict-free sync.

## Open Items (verify at implementation)

1. `onecli` gateway serve subcommand + port + vault state layout.
2. `railway/iac` volume support (else one-time CLI step).
3. Exact barrel-append content of the `/add-whatsapp` / `/add-telegram`
   `nc:append` directives.
4. Telegram formatting skill name/path on the `channels` branch.
5. Whether `@onecli-sh/sdk` has a non-docker (host-mode) config API.
6. ~~OpenCode model/router choice for `OPENCODE_MODEL`~~ — **resolved: DeepSeek**
   (`OPENCODE_PROVIDER=deepseek`, `OPENCODE_MODEL=deepseek/deepseek-chat`,
   `OPENCODE_SMALL_MODEL=deepseek/deepseek-chat`,
   `ANTHROPIC_BASE_URL=https://api.deepseek.com/v1`; DeepSeek key registered
   in OneCLI with `--host-pattern "api.deepseek.com"`).
7. Confirm `providers` branch file list matches the skill's copy list
   (including `mcp-to-opencode.ts`).
