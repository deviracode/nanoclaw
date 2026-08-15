# NanoClaw Railway Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy NanoClaw v2 to Railway with OpenCode (DeepSeek) as the agent provider, WhatsApp + Telegram channels, and a separate OneCLI gateway service — while keeping this fork cleanly mergeable with upstream `nanocoai/nanoclaw`.

**Architecture:** A `NANOCLAW_RUNTIME=host` mode replaces per-session `docker run` with direct Bun child-process spawns (mounts become env vars). Agent-runner paths become env-configurable. OneCLI host-mode wiring uses the SDK's `getContainerConfig` translated to env/certs instead of docker args. A Railway IaC file (`railway.ts`) declares host + OneCLI + Postgres services. Channels and the OpenCode provider are committed into the fork from upstream branches. First-run provisioning is env-driven via a bootstrap module.

**Tech Stack:** Node 22 + pnpm (host), Bun (agent-runner), Railway IaC (`railway` npm pkg, DSL `railway/iac`), Docker (image build), vitest (host tests), bun:test (container tests).

Spec: `docs/superpowers/specs/2026-08-14-railway-deployment-design.md`

---

## File Map

| File | Responsibility |
|---|---|
| `container/agent-runner/src/paths.ts` (new) | Env-configurable roots: `WORKSPACE_DIR`, `AGENT_DIR`, `SRC_DIR`, `SKILLS_DIR` (docker defaults) |
| `container/agent-runner/src/{config,index,formatter}.ts`, `db/connection.ts`, `cli/ncl.ts`, `mcp-tools/core.ts`, `memory/{context,scaffold}.ts`, `providers/claude.ts` | Use `paths.ts` instead of hardcoded `/workspace`, `/app` paths |
| `src/config.ts` | `NANOCLAW_RUNTIME`, `NANOCLAW_HOME` (DATA_DIR/GROUPS_DIR/STORE_DIR under it), health `PORT` |
| `src/container-runtime.ts` | Host-mode seam: `spawnHostRunner`, `killHostRunner`, `translateMountsToHostEnv`, runtime guards |
| `src/onecli-host-mode.ts` (new) | Pure translation: `applyOnecliConfigHostMode`, `rewriteProxyHost` |
| `src/container-runner.ts` | Branch at spawn: docker path unchanged; host path via runtime seam; `buildAgentGroupImage` guard; `killContainer` host branch |
| `src/health.ts` (new) | Tiny HTTP `ok` server (host runtime only) |
| `src/modules/bootstrap/wire-dm-agent.ts` (new) | Extracted wiring logic from `scripts/init-first-agent.ts` (user, role, group, messaging group, wiring, welcome) |
| `src/bootstrap.ts` (new) | Env-gated first-run provisioning calling `wireDmAgent` |
| `scripts/init-first-agent.ts` | Refactored to call shared `wireDmAgent` + shared welcome sender |
| `src/index.ts` | Start health server + bootstrap (host runtime, after CLI server) |
| `src/channels/{whatsapp,telegram}.ts` + helpers/tests (new) | Copied from `upstream/channels` |
| `container/skills/whatsapp-formatting/` (new) | Copied from `upstream/channels` |
| `src/providers/opencode.ts` + registration test (new) | Copied from `upstream/providers` |
| `container/agent-runner/src/providers/{opencode,mcp-to-opencode}.ts` + tests (new) | Copied from `upstream/providers` |
| `package.json`, `pnpm-lock.yaml` | Channel deps + `railway` devDep |
| `container/agent-runner/package.json`, `bun.lock` | `@opencode-ai/sdk@1.4.17` |
| `container/cli-tools.json` | Add `opencode-ai@1.4.17` |
| `railway/Dockerfile.railway` (new) | Host image: Bun agent-runner + host + Chromium + CLIs |
| `railway/entrypoint.sh` (new) | /data setup + `node dist/index.js` |
| `railway.json` (root, new) | `{ build: { builder: "DOCKERFILE" } }` |
| `.railway/railway.ts` (new) | IaC: nanoclaw + nanoclaw-onecli + postgres |
| `railway/README.md` (new) | Sync/ops runbook |
| `src/opencode-dockerfile.test.ts` (new) | Copied from `.agents/skills/add-opencode/` |

---

## Phase 1 — Agent-runner path configurability

### Task 1: `paths.ts` with env-configurable roots

**Files:**
- Create: `container/agent-runner/src/paths.ts`
- Test: `container/agent-runner/src/paths.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from 'bun:test';
import { AGENT_DIR, SKILLS_DIR, SRC_DIR, WORKSPACE_DIR } from './paths';

describe('paths', () => {
  test('defaults to docker layout when env is unset', () => {
    expect(WORKSPACE_DIR).toBe('/workspace');
    expect(AGENT_DIR).toBe('/workspace/agent');
    expect(SRC_DIR).toBe('/app/src');
    expect(SKILLS_DIR).toBe('/app/skills');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd container/agent-runner && bun test src/paths.test.ts`
Expected: FAIL — `Cannot find module './paths'`

- [ ] **Step 3: Write minimal implementation**

```ts
/**
 * Runtime roots for the agent-runner. In the Docker runtime these are fixed
 * mount paths; in host runtime (Railway) the host passes each per-session
 * path via env. Defaults match the docker layout exactly.
 */
import path from 'path';

export const WORKSPACE_DIR = process.env.WORKSPACE_DIR || '/workspace';
export const AGENT_DIR = process.env.AGENT_DIR || path.join(WORKSPACE_DIR, 'agent');
export const SRC_DIR = process.env.SRC_DIR || '/app/src';
export const SKILLS_DIR = process.env.SKILLS_DIR || '/app/skills';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd container/agent-runner && bun test src/paths.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add container/agent-runner/src/paths.ts container/agent-runner/src/paths.test.ts
git commit -m "feat(agent-runner): env-configurable runtime roots (paths.ts)"
```

### Task 2: Switch hardcoded path sites to `paths.ts`

**Files:**
- Modify: `container/agent-runner/src/config.ts:10`
- Modify: `container/agent-runner/src/index.ts:43,58-69`
- Modify: `container/agent-runner/src/formatter.ts:279`
- Modify: `container/agent-runner/src/db/connection.ts:23-25`
- Modify: `container/agent-runner/src/cli/ncl.ts:34-35`
- Modify: `container/agent-runner/src/mcp-tools/core.ts:119,135,141`
- Modify: `container/agent-runner/src/memory/context.ts:11,21-22`
- Modify: `container/agent-runner/src/memory/scaffold.ts:23`
- Modify: `container/agent-runner/src/providers/claude.ts:303`
- Test: existing tests still green

- [ ] **Step 1: Update `config.ts`**

Replace `const CONFIG_PATH = '/workspace/agent/container.json';` with:

```ts
import { AGENT_DIR } from './paths.js';
const CONFIG_PATH = path.join(AGENT_DIR, 'container.json');
```

`path` is already imported in `config.ts`. Update the header comment to mention `AGENT_DIR`.

- [ ] **Step 2: Update `index.ts`**

- Replace `const CWD = '/workspace/agent';` with:

```ts
import { AGENT_DIR, EXTRA_DIR, SRC_DIR } from './paths.js';
const CWD = AGENT_DIR;
```

(Add `EXTRA_DIR` to `paths.ts`:

```ts
export const EXTRA_DIR = process.env.EXTRA_DIR || path.join(WORKSPACE_DIR, 'extra');
```

- Replace `const extraBase = '/workspace/extra';` with `const extraBase = EXTRA_DIR;`
- Update the header doc comment lines that mention `/workspace/`, `/app/src/`, `/app/skills/`, `/home/node/.claude/` to reference the paths module. Comment-only edits.

- [ ] **Step 3: Update `formatter.ts:279`**

Replace:

```ts
const localPath = a.localPath ? `/workspace/${a.localPath}` : '';
```

with:

```ts
import { WORKSPACE_DIR } from './paths.js';
const localPath = a.localPath ? `${WORKSPACE_DIR}/${a.localPath}` : '';
```

- [ ] **Step 4: Update `db/connection.ts:23-25`**

Replace the three `DEFAULT_*` constants:

```ts
import { WORKSPACE_DIR } from '../paths.js';
const DEFAULT_INBOUND_PATH = path.join(WORKSPACE_DIR, 'inbound.db');
const DEFAULT_OUTBOUND_PATH = path.join(WORKSPACE_DIR, 'outbound.db');
const DEFAULT_HEARTBEAT_PATH = path.join(WORKSPACE_DIR, '.heartbeat');
```

(`path` and the existing env-override logic that reads `NANOCLAW_INBOUND_DB` etc. must be preserved — read the current function bodies before editing.)

- [ ] **Step 5: Update `cli/ncl.ts:34-35`**

```ts
import { WORKSPACE_DIR } from '../paths.js';
const INBOUND_DB = path.join(WORKSPACE_DIR, 'inbound.db');
const OUTBOUND_DB = path.join(WORKSPACE_DIR, 'outbound.db');
```

- [ ] **Step 6: Update `mcp-tools/core.ts:119,135,141`**

- Tool description string: replace `/workspace/agent/` with `AGENT_DIR` interpolation (description text only).
- `path.resolve('/workspace/agent', filePath)` → `path.resolve(AGENT_DIR, filePath)`
- `const outboxDir = path.join('/workspace/outbox', id)` → `path.join(WORKSPACE_DIR, 'outbox', id)`
- Import both from `../paths.js`.

- [ ] **Step 7: Update memory files**

`memory/context.ts`:
- `renderMemorySection(baseDir = '/workspace/agent')` → `renderMemorySection(baseDir = AGENT_DIR)` with import from `../paths.js`.
- Lines 21-22: `/workspace/agent/memory/...` strings → `${AGENT_DIR}/memory/...`.

`memory/scaffold.ts`:
- `ensureMemoryScaffold(baseDir = '/workspace/agent')` → `baseDir = AGENT_DIR`, import from `../paths.js`.

- [ ] **Step 8: Update `providers/claude.ts:303`**

Replace:

```ts
const conversationsDir = process.env.NANOCLAW_CONVERSATIONS_DIR || '/workspace/agent/conversations';
```

with:

```ts
import { AGENT_DIR } from '../paths.js';
const conversationsDir = process.env.NANOCLAW_CONVERSATIONS_DIR || path.join(AGENT_DIR, 'conversations');
```

- [ ] **Step 9: Update the memory hook command in `memory/session-hook.ts`**

The hook command `'bun /app/src/memory/hook.ts'` stays literal — in host runtime the Railway image bakes agent-runner source at `/app/src` (Task 10), so `/app/src` is a real path in both runtimes. No change.

- [ ] **Step 10: Run full container test suite + typecheck**

Run:
```bash
cd container/agent-runner && bun test
pnpm exec tsc -p container/agent-runner/tsconfig.json --noEmit
```
Expected: all PASS, no type errors. If a test asserts a hardcoded `/workspace/...` string, update it to the matching `paths` value.

- [ ] **Step 11: Commit**

```bash
git add container/agent-runner/src/
git commit -m "refactor(agent-runner): resolve runtime paths from paths.ts"
```

---

## Phase 2 — Host runtime mode

### Task 3: `config.ts` — runtime flag, `NANOCLAW_HOME`, health port

**Files:**
- Modify: `src/config.ts:52-60`
- Test: `src/config.test.ts` (new)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test, vi } from 'vitest';

describe('host runtime config', () => {
  const saved = { runtime: process.env.NANOCLAW_RUNTIME, home: process.env.NANOCLAW_HOME, port: process.env.PORT };
  afterEach(() => {
    process.env.NANOCLAW_RUNTIME = saved.runtime;
    process.env.NANOCLAW_HOME = saved.home;
    process.env.PORT = saved.port;
    vi.resetModules();
  });

  test('host runtime flag', async () => {
    process.env.NANOCLAW_RUNTIME = 'host';
    const { IS_HOST_RUNTIME } = await import('./config.js');
    expect(IS_HOST_RUNTIME).toBe(true);
  });

  test('default runtime is docker', async () => {
    delete process.env.NANOCLAW_RUNTIME;
    const { IS_HOST_RUNTIME } = await import('./config.js');
    expect(IS_HOST_RUNTIME).toBe(false);
  });

  test('NANOCLAW_HOME relocates data + groups', async () => {
    process.env.NANOCLAW_HOME = '/data';
    const { DATA_DIR, GROUPS_DIR, STORE_DIR } = await import('./config.js');
    expect(DATA_DIR).toBe('/data/data');
    expect(GROUPS_DIR).toBe('/data/groups');
    expect(STORE_DIR).toBe('/data/store');
  });

  test('health port defaults to 8080', async () => {
    delete process.env.PORT;
    const { HEALTH_PORT } = await import('./config.js');
    expect(HEALTH_PORT).toBe('8080');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/config.test.ts`
Expected: FAIL — `IS_HOST_RUNTIME` is not exported.

- [ ] **Step 3: Implement in `src/config.ts`**

After the `HOME_DIR` block (around line 52), add:

```ts
/** Host runtime (Railway): agents run as child processes, no Docker daemon. */
export const IS_HOST_RUNTIME = (process.env.NANOCLAW_RUNTIME || '').toLowerCase() === 'host';

// Persistent-storage root. Defaults to the project root (local behavior);
// Railway mounts a volume at /data and sets NANOCLAW_HOME=/data.
const HOME_ROOT = process.env.NANOCLAW_HOME ? path.resolve(process.env.NANOCLAW_HOME) : PROJECT_ROOT;

export const STORE_DIR = path.resolve(HOME_ROOT, 'store');
export const GROUPS_DIR = path.resolve(HOME_ROOT, 'groups');
export const DATA_DIR = path.resolve(HOME_ROOT, 'data');

/** Health endpoint port — only bound in host runtime (Railway healthchecks). */
export const HEALTH_PORT = process.env.PORT || '8080';
```

Remove the now-duplicate `STORE_DIR`/`GROUPS_DIR`/`DATA_DIR` declarations (lines 57-59).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run src/config.test.ts`
Expected: PASS.

- [ ] **Step 5: Run full host test suite to catch hardcoded-path assumptions**

Run: `pnpm test`
Expected: PASS. If any test constructs `path.resolve(process.cwd(), 'data')` style assertions, they keep passing because `NANOCLAW_HOME` is unset in CI.

- [ ] **Step 6: Commit**

```bash
git add src/config.ts src/config.test.ts
git commit -m "feat(host): NANOCLAW_RUNTIME, NANOCLAW_HOME, health port"
```

### Task 4: Host-mode runtime seam in `container-runtime.ts`

**Files:**
- Modify: `src/container-runtime.ts`
- Test: `src/container-runtime.test.ts` (new)

- [ ] **Step 1: Write the failing test (pure translation)**

```ts
import { describe, expect, test } from 'vitest';
import { translateMountsToHostEnv } from './container-runtime.js';

const mounts = [
  { hostPath: '/data/sess', containerPath: '/workspace', readonly: false },
  { hostPath: '/data/groups/dm-x', containerPath: '/workspace/agent', readonly: false },
  { hostPath: '/data/claude-shared', containerPath: '/home/node/.claude', readonly: false },
  { hostPath: '/x/container.json', containerPath: '/workspace/agent/container.json', readonly: true },
  { hostPath: '/app-src', containerPath: '/app/src', readonly: true },
  { hostPath: '/app-skills', containerPath: '/app/skills', readonly: true },
];

describe('translateMountsToHostEnv', () => {
  test('maps workspace/agent/claude/src/skills mounts to env', () => {
    const env = translateMountsToHostEnv(mounts);
    expect(env.WORKSPACE_DIR).toBe('/data/sess');
    expect(env.AGENT_DIR).toBe('/data/groups/dm-x');
    expect(env.CLAUDE_HOME).toBe('/data/claude-shared');
    expect(env.SRC_DIR).toBe('/app-src');
    expect(env.SKILLS_DIR).toBe('/app-skills');
  });

  test('nested file mounts are ignored (physical paths work in host mode)', () => {
    const env = translateMountsToHostEnv(mounts);
    expect(Object.keys(env)).not.toContain('CONTAINER_JSON');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/container-runtime.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement in `src/container-runtime.ts`**

Append to the existing file (keep all docker functions untouched):

```ts
import { ChildProcess, spawn } from 'child_process';
import type { VolumeMount } from './providers/provider-container-registry.js';

/** Mount containerPath → child-process env var (host runtime). */
const MOUNT_ENV_MAP: Record<string, string> = {
  '/workspace': 'WORKSPACE_DIR',
  '/workspace/agent': 'AGENT_DIR',
  '/home/node/.claude': 'CLAUDE_HOME',
  '/app/src': 'SRC_DIR',
  '/app/skills': 'SKILLS_DIR',
};

export function translateMountsToHostEnv(mounts: VolumeMount[]): Record<string, string> {
  const env: Record<string, string> = {};
  for (const m of mounts) {
    const key = MOUNT_ENV_MAP[m.containerPath];
    if (key) env[key] = m.hostPath;
  }
  return env;
}

export function hostRuntimeEnv(mounts: VolumeMount[], extra: Record<string, string>): NodeJS.ProcessEnv {
  return {
    ...translateMountsToHostEnv(mounts),
    ...extra,
    TZ: process.env.TZ ?? 'UTC',
    NANOCLAW_RUNTIME: 'host',
  };
}

export function spawnHostRunner(opts: {
  bun: string;
  entry: string;
  env: NodeJS.ProcessEnv;
  cwd: string;
}): ChildProcess {
  return spawn(opts.bun, [opts.entry], {
    env: opts.env,
    cwd: opts.cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

export function killHostRunner(child: ChildProcess): void {
  if (!child.pid) return;
  try {
    child.kill('SIGTERM');
  } catch {
    /* already gone */
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run src/container-runtime.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/container-runtime.ts src/container-runtime.test.ts
git commit -m "feat(host): host-runtime spawn seam + mount translation"
```

### Task 5: OneCLI host-mode translation

**Files:**
- Create: `src/onecli-host-mode.ts`
- Test: `src/onecli-host-mode.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from 'vitest';
import { applyOnecliConfigHostMode, rewriteProxyHost } from './onecli-host-mode.js';

describe('rewriteProxyHost', () => {
  test('replaces host.docker.internal with the gateway host', () => {
    expect(rewriteProxyHost('http://host.docker.internal:10255', 'http://nanoclaw-onecli.railway.internal:10254')).toBe(
      'http://nanoclaw-onecli.railway.internal:10255',
    );
  });

  test('leaves already-valid hosts untouched', () => {
    expect(rewriteProxyHost('http://gateway.example:10255', 'http://x.railway.internal:10254')).toBe(
      'http://gateway.example:10255',
    );
  });

  test('handles unparseable input gracefully', () => {
    expect(rewriteProxyHost('not-a-url', 'http://x')).toBe('not-a-url');
  });
});

describe('applyOnecliConfigHostMode', () => {
  const config = {
    env: { HTTPS_PROXY: 'http://host.docker.internal:10255', DENO_CERT: '/tmp/onecli-combined-ca.pem' },
    caCertificate: '-----BEGIN CERTIFICATE-----\nMOCK\n-----END CERTIFICATE-----',
    caCertificateContainerPath: '/tmp/onecli-ca.pem',
    credentialStubs: [{ containerPath: '/workspace/agent/.auth', content: 'stub-content' }],
  };

  test('returns rewritten env, cert file, and stub files', () => {
    const out = applyOnecliConfigHostMode(config, 'http://nanoclaw-onecli.railway.internal:10254', '/data/onecli');
    expect(out.env.HTTPS_PROXY).toBe('http://nanoclaw-onecli.railway.internal:10255');
    expect(out.files.some((f) => f.path.endsWith('.pem') && f.content.includes('MOCK'))).toBe(true);
    expect(out.files.some((f) => f.path === '/workspace/agent/.auth' && f.content === 'stub-content')).toBe(true);
    expect(out.env.NODE_EXTRA_CA_CERTS).toBeTruthy();
    expect(out.env.SSL_CERT_FILE).toBe(out.env.NODE_EXTRA_CA_CERTS);
    expect(out.env.DENO_CERT).toBe(out.env.NODE_EXTRA_CA_CERTS);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/onecli-host-mode.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

/**
 * Host-runtime translation of the OneCLI container config. The docker path
 * calls `onecli.applyContainerConfig(args)` which appends `-e` / `-v` args;
 * here we produce the same effects as child-process env + local files.
 */

export interface OnecliContainerConfig {
  env: Record<string, string>;
  caCertificate: string;
  caCertificateContainerPath: string;
  credentialStubs?: { containerPath: string; content: string }[];
}

export interface HostModeFiles {
  path: string;
  content: string;
}

export function rewriteProxyHost(proxyUrl: string, oncliUrl: string): string {
  try {
    const proxy = new URL(proxyUrl);
    const gateway = new URL(oncliUrl);
    if (proxy.hostname === 'host.docker.internal' || proxy.hostname === 'host-gateway') {
      proxy.hostname = gateway.hostname;
    }
    return proxy.toString().replace(/\/$/, '');
  } catch {
    return proxyUrl;
  }
}

export function applyOnecliConfigHostMode(
  config: OnecliContainerConfig,
  oncliUrl: string,
  dataDir: string,
): { env: Record<string, string>; files: HostModeFiles[] } {
  const env: Record<string, string> = {};
  const files: HostModeFiles[] = [];

  for (const [key, value] of Object.entries(config.env)) {
    env[key] = key.toLowerCase().includes('proxy') ? rewriteProxyHost(value, oncliUrl) : value;
  }

  const certsDir = path.join(dataDir, 'onecli-certs');
  fs.mkdirSync(certsDir, { recursive: true });
  const certFile = path.join(certsDir, `ca-${crypto.createHash('sha1').update(config.caCertificate).digest('hex').slice(0, 12)}.pem`);
  fs.writeFileSync(certFile, config.caCertificate);
  files.push({ path: certFile, content: config.caCertificate });

  env.NODE_EXTRA_CA_CERTS = certFile;
  env.SSL_CERT_FILE = certFile;
  env.DENO_CERT = certFile;

  for (const stub of config.credentialStubs ?? []) {
    fs.mkdirSync(path.dirname(stub.containerPath), { recursive: true });
    fs.writeFileSync(stub.containerPath, stub.content);
    files.push({ path: stub.containerPath, content: stub.content });
  }

  return { env, files };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/onecli-host-mode.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/onecli-host-mode.ts src/onecli-host-mode.test.ts
git commit -m "feat(host): OneCLI host-mode translation (env + certs + stubs)"
```

### Task 6: Wire host mode into `container-runner.ts`

**Files:**
- Modify: `src/container-runner.ts:114-214` (spawn branch), `217-231` (kill), `553-626` (image build guard)

- [ ] **Step 1: Add the host branch to `spawnContainer`**

After the `buildMounts` call (line 147) and the mounts/env bookkeeping, insert a host-runtime early path. Read the current `spawnContainer` body first, then add at the top:

```ts
import { IS_HOST_RUNTIME } from './config.js';
import { spawnHostRunner, killHostRunner } from './container-runtime.js';
import { applyOnecliConfigHostMode } from './onecli-host-mode.js';

async function spawnContainerHost(session: Session, agentGroup: AgentGroup): Promise<void> {
  const containerConfig = materializeContainerJson(agentGroup.id);
  const providerName = resolveProviderName(session.agent_provider, containerConfig.provider);
  initGroupFilesystem(agentGroup, { provider: providerName });
  const { provider, contribution } = resolveProviderContribution(session, agentGroup, containerConfig);
  const mounts = buildMounts(agentGroup, session, containerConfig, provider, contribution);
  const mountEnv = translateMountsToHostEnv(mounts);

  const extraEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(contribution.env ?? {})) extraEnv[key] = value;
  extraEnv.TZ = containerConfig.timezone ?? TIMEZONE;

  const agentIdentifier = agentGroup.id;
  if (agentIdentifier) {
    await onecli.ensureAgent({ name: agentGroup.name, identifier: agentIdentifier });
  }
  const gatewayConfig = await onecli.getContainerConfig({ agent: agentIdentifier });
  if (!gatewayConfig) {
    throw new Error('OneCLI gateway not applied — refusing to spawn agent without credentials');
  }
  const onecliApplied = applyOnecliConfigHostMode(gatewayConfig, ONECLI_URL, DATA_DIR);
  Object.assign(extraEnv, onecliApplied.env);

  const env = { ...process.env, ...mountEnv, ...extraEnv, NANOCLAW_RUNTIME: 'host' };

  fs.rmSync(heartbeatPath(agentGroup.id, session.id), { force: true });

  const child = spawnHostRunner({
    bun: process.env.BUN_BIN || '/usr/local/bin/bun',
    entry: path.join(mountEnv.SRC_DIR ?? '/app/src', 'index.ts'),
    env,
    cwd: mountEnv.WORKSPACE_DIR ?? sessionDir(agentGroup.id, session.id),
  });

  activeContainers.set(session.id, { process: child, containerName: `host-${agentGroup.folder}-${session.id}` });
  markContainerRunning(session.id);

  child.stderr?.on('data', (data) => {
    for (const line of data.toString().trim().split('\n')) {
      if (!line) continue;
      log.debug(line, { agentGroup: agentGroup.folder });
    }
  });
  child.stdout?.on('data', () => {});

  child.on('close', (code) => {
    activeContainers.delete(session.id);
    markContainerStopped(session.id);
    stopTypingRefresh(session.id);
    log.info('Host-runner agent exited', { sessionId: session.id, code });
  });
  child.on('error', (err) => {
    activeContainers.delete(session.id);
    markContainerStopped(session.id);
    stopTypingRefresh(session.id);
    log.error('Host-runner spawn error', { sessionId: session.id, err });
  });
}
```

In `spawnContainer`, at the top (right after the agentGroup null check), add:

```ts
if (IS_HOST_RUNTIME) {
  await spawnContainerHost(session, agentGroup);
  return;
}
```

**Verify the SDK method exists before committing:** `onecli.getContainerConfig` is public on the OneCLI class (verified against `@onecli-sh/sdk@3.1.0`: `getContainerConfig = (options) => this.containerClient.getContainerConfig(options)`). Its return type is `Promise<OnecliContainerConfig | false>` — if the SDK types differ from the interface in `onecli-host-mode.ts`, widen the interface to match.

- [ ] **Step 2: Update `killContainer` for host mode**

At the top of `killContainer`, branch:

```ts
if (IS_HOST_RUNTIME) {
  const entry = activeContainers.get(sessionId);
  if (!entry) return;
  if (onExit) entry.process.once('close', onExit);
  log.info('Killing host-runner agent', { sessionId, reason });
  killHostRunner(entry.process);
  return;
}
```

- [ ] **Step 3: Guard `buildAgentGroupImage`**

At the top of `buildAgentGroupImage`, add:

```ts
if (IS_HOST_RUNTIME) {
  throw new Error('install_packages is not supported in host runtime (NANOCLAW_RUNTIME=host) — no Docker daemon');
}
```

- [ ] **Step 4: Typecheck + run host tests**

Run:
```bash
pnpm run build
pnpm test
```
Expected: clean build, all PASS. Existing docker-path tests must be untouched and green.

- [ ] **Step 5: Commit**

```bash
git add src/container-runner.ts
git commit -m "feat(host): route spawns through host-runtime seam when NANOCLAW_RUNTIME=host"
```

### Task 7: Health endpoint

**Files:**
- Create: `src/health.ts`
- Modify: `src/index.ts`
- Test: `src/health.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from 'vitest';
import { createHealthServer } from './health.js';

describe('health server', () => {
  test('responds 200 ok on any path', async () => {
    const server = createHealthServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address() as { port: number };
    const res = await fetch(`http://127.0.0.1:${addr.port}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
    await new Promise((resolve) => server.close(resolve));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/health.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import http from 'http';
import { log } from './log.js';

/** Minimal liveness endpoint so Railway can healthcheck the host. */
export function createHealthServer(): http.Server {
  return http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
  });
}

export function startHealthServer(port: string): http.Server {
  const server = createHealthServer();
  server.listen(Number(port), '0.0.0.0', () => log.info('Health server listening', { port }));
  server.on('error', (err) => log.warn('Health server failed', { err }));
  return server;
}
```

- [ ] **Step 4: Wire into `src/index.ts`**

In `main()`, after the DB init block (step 1), add:

```ts
import { HEALTH_PORT, IS_HOST_RUNTIME } from './config.js';
import { startHealthServer } from './health.js';

// 1c. Health endpoint (host runtime only — Railway healthchecks)
if (IS_HOST_RUNTIME) {
  startHealthServer(HEALTH_PORT);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm exec vitest run src/health.test.ts && pnpm run build`
Expected: PASS, clean build.

- [ ] **Step 6: Commit**

```bash
git add src/health.ts src/health.test.ts src/index.ts
git commit -m "feat(host): health endpoint bound in host runtime"
```

### Task 8: Env-driven bootstrap

**Files:**
- Create: `src/modules/bootstrap/wire-dm-agent.ts`
- Modify: `scripts/init-first-agent.ts`
- Create: `src/bootstrap.ts`
- Modify: `src/index.ts`
- Test: `src/bootstrap.test.ts`

- [ ] **Step 1: Extract wiring into a shared module**

Create `src/modules/bootstrap/wire-dm-agent.ts`. Move the DB-adjacent logic from `scripts/init-first-agent.ts` `main()` steps 1-4 (user upsert, owner/admin grant, group create + `ensureContainerConfig` with picked provider, membership, messaging group create, `wireIfMissing`) into:

```ts
export interface WireDmAgentOpts {
  channel: string;
  userId: string;
  platformId: string;
  displayName: string;
  agentName?: string;
  role?: 'owner' | 'admin' | 'member';
  engagePattern?: string;
  provider?: string | null;
}

export interface WireDmAgentResult {
  userId: string;
  agentGroup: AgentGroup;
  messagingGroup: MessagingGroup;
  folder: string;
}

export function wireDmAgent(opts: WireDmAgentOpts): WireDmAgentResult;
```

Move the private helpers `namespacedUserId`, `generateId`, `wireIfMissing`, and the welcome sender `sendWelcomeViaCliSocket` into the same module. Keep the exact logic — copy the bodies verbatim from the script (Task 8 does not change behavior).

- [ ] **Step 2: Refactor `scripts/init-first-agent.ts`**

`main()` becomes: parse args → `initDb` + `runMigrations` → `wireDmAgent({...})` → `sendWelcomeViaCliSocket(result.messagingGroup, args.welcome, { senderId, sender })` → console summary. Delete the moved bodies from the script. Verify no behavior change:

Run: `pnpm run build && pnpm exec tsc --noEmit scripts/init-first-agent.ts`
Expected: clean.

- [ ] **Step 3: Write the failing bootstrap test**

```ts
import { afterEach, describe, expect, test } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { initDb } from './db/connection.js';
import { runMigrations } from './db/migrations/index.js';
import { runBootstrap } from './bootstrap.js';
import { getUserRoles } from './modules/permissions/db/user-roles.js';

describe('bootstrap', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bootstrap-'));
  const dbPath = path.join(tmp, 'v2.db');

  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  test('seeds owner + agent + wiring from env on empty DB', async () => {
    const db = initDb(dbPath);
    runMigrations(db);
    const out = await runBootstrap({
      db,
      ownerId: 'telegram:12345',
      displayName: 'Yoav',
      agentName: 'Andy',
      channels: [{ channel: 'telegram', platformId: 'telegram:12345' }],
      provider: 'opencode',
      welcome: 'hello',
    });
    expect(out).toBe(true);
    const roles = getUserRoles('telegram:12345');
    expect(roles.some((r) => r.role === 'owner' && r.agent_group_id === null)).toBe(true);
  });

  test('no-op when users already exist', async () => {
    const db = initDb(dbPath);
    runMigrations(db);
    await runBootstrap({ db, ownerId: 'telegram:1', displayName: 'A', channels: [], provider: 'opencode' });
    const out = await runBootstrap({ db, ownerId: 'telegram:1', displayName: 'A', channels: [], provider: 'opencode' });
    expect(out).toBe(false);
  });
});
```

(Adjust to the actual users-table query available in `src/modules/permissions/db/users.ts` — if no count function exists, add one or query the table directly via the db handle.)

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm exec vitest run src/bootstrap.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 5: Implement `src/bootstrap.ts`**

```ts
import { initDb } from './db/connection.js';
import { wireDmAgent } from './modules/bootstrap/wire-dm-agent.js';

export interface BootstrapChannel {
  channel: string;
  platformId: string;
}

export interface BootstrapOpts {
  db: ReturnType<typeof initDb>;
  ownerId: string; // "channel:handle" or comma-separated list
  displayName?: string;
  agentName?: string;
  channels: BootstrapChannel[];
  provider?: string | null;
  welcome?: string;
}

/**
 * First-run provisioning for host runtime (Railway has no local shell).
 * Returns true when seeding happened, false when the DB already has users.
 */
export async function runBootstrap(opts: BootstrapOpts): Promise<boolean> {
  const hasUsers = /* count rows in users table via opts.db */;
  if (hasUsers) return false;

  for (const entry of opts.ownerId.split(',').map((s) => s.trim())) {
    const [channel, ...rest] = entry.split(':');
    const handle = rest.join(':');
    const platformId = opts.channels.find((c) => c.channel === channel)?.platformId ?? entry;
    wireDmAgent({
      channel,
      userId: entry,
      platformId,
      displayName: opts.displayName ?? handle,
      agentName: opts.agentName,
      role: 'owner',
      provider: opts.provider,
    });
  }
  return true;
}
```

The welcome message: after wiring, hand it to the running host via the CLI socket (the socket server is up during bootstrap — see Task 8 step 7). Reuse `sendWelcomeViaCliSocket` from the shared module for the first channel; log failures without crashing.

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm exec vitest run src/bootstrap.test.ts`
Expected: PASS.

- [ ] **Step 7: Wire into `src/index.ts`**

After `startCliServer(...)` in `main()`, add:

```ts
import { runBootstrap } from './bootstrap.js';

// 4b. First-run bootstrap (host runtime: no local shell to run init-first-agent).
if (IS_HOST_RUNTIME && process.env.NANOCLAW_BOOTSTRAP === '1') {
  try {
    const seeded = await runBootstrap({
      db,
      ownerId: process.env.NANOCLAW_OWNER_ID || '',
      displayName: process.env.NANOCLAW_OWNER_DISPLAY_NAME,
      agentName: process.env.NANOCLAW_AGENT_NAME,
      channels: (process.env.NANOCLAW_BOOTSTRAP_CHANNELS || '')
        .split(',')
        .filter(Boolean)
        .map((c) => ({ channel: c.trim(), platformId: `${c.trim()}:${process.env.NANOCLAW_OWNER_HANDLE || ''}` })),
      provider: process.env.NANOCLAW_PICKED_PROVIDER || 'opencode',
      welcome: process.env.NANOCLAW_BOOTSTRAP_WELCOME,
    });
    log.info('Bootstrap run', { seeded });
  } catch (err) {
    log.error('Bootstrap failed — continuing without it', { err });
  }
}
```

Notes: `NANOCLAW_OWNER_ID` is a comma list of `channel:handle`; the per-channel `platformId` defaults to the owner id itself (correct for telegram: `telegram:<userid>`, whatsapp: `whatsapp:<phone>`). The exact platform-id shape for each channel is verified during the deploy runbook (Task 12).

- [ ] **Step 8: Full host test + build**

Run: `pnpm test && pnpm run build`
Expected: all PASS, clean build.

- [ ] **Step 9: Commit**

```bash
git add src/bootstrap.ts src/bootstrap.test.ts src/modules/bootstrap/wire-dm-agent.ts scripts/init-first-agent.ts src/index.ts
git commit -m "feat(host): env-driven first-run bootstrap"
```

---

## Phase 3 — Channels + OpenCode provider (committed deps)

### Task 9: WhatsApp + Telegram channels from `upstream/channels`

**Files:**
- Create: `src/channels/whatsapp.ts`, `src/channels/whatsapp.test.ts`, `src/channels/whatsapp-registration.test.ts`
- Create: `src/channels/telegram.ts`, `src/channels/telegram-pairing.ts`, `src/channels/telegram-pairing.test.ts`, `src/channels/telegram-markdown-sanitize.ts`, `src/channels/telegram-markdown-sanitize.test.ts`, `src/channels/telegram-registration.test.ts`
- Create: `container/skills/whatsapp-formatting/` (SKILL.md + instructions.md)
- Create: `setup/pair-telegram.ts`
- Modify: `src/channels/index.ts` (append 2 imports)
- Modify: `setup/index.ts` (STEPS map: `'pair-telegram'`)
- Modify: `package.json` + `pnpm-lock.yaml`

- [ ] **Step 1: Fetch upstream branches**

Run:
```bash
git fetch upstream channels
```

- [ ] **Step 2: Copy WhatsApp adapter files**

Run:
```bash
git show upstream/channels:src/channels/whatsapp.ts                        > src/channels/whatsapp.ts
git show upstream/channels:src/channels/whatsapp.test.ts                   > src/channels/whatsapp.test.ts
git show upstream/channels:src/channels/whatsapp-registration.test.ts      > src/channels/whatsapp-registration.test.ts
mkdir -p container/skills/whatsapp-formatting
git show upstream/channels:container/skills/whatsapp-formatting/SKILL.md        > container/skills/whatsapp-formatting/SKILL.md
git show upstream/channels:container/skills/whatsapp-formatting/instructions.md > container/skills/whatsapp-formatting/instructions.md
```

- [ ] **Step 3: Copy Telegram adapter files**

**Deviations recorded during execution (Task 9, commit 0443a283):**
- `setup/pair-telegram.ts` was NOT copied — this fork maintains it in trunk with newer UX (commits 1a3c3eaf, 3b411710); the fork's `/add-telegram` skill states it is trunk-maintained and not copied. `setup/index.ts` already registers it.
- **Known-vulnerable pin:** `@whiskeysockets/baileys@7.0.0-rc.9` is deprecated on npm (GHSA-qvv5-jq5g-4cgg, message spoofing). It is upstream/channels' pin and the adapter is built against it — the fix must ride in from upstream/channels when it bumps. **Follow-up: smoke-test WhatsApp on Railway staging before production use; track upstream baileys bump via `/update-skills`.**

Run:
```bash
git show upstream/channels:src/channels/telegram.ts                        > src/channels/telegram.ts
git show upstream/channels:src/channels/telegram-pairing.ts                > src/channels/telegram-pairing.ts
git show upstream/channels:src/channels/telegram-pairing.test.ts           > src/channels/telegram-pairing.test.ts
git show upstream/channels:src/channels/telegram-markdown-sanitize.ts      > src/channels/telegram-markdown-sanitize.ts
git show upstream/channels:src/channels/telegram-markdown-sanitize.test.ts > src/channels/telegram-markdown-sanitize.test.ts
git show upstream/channels:src/channels/telegram-registration.test.ts      > src/channels/telegram-registration.test.ts
git show upstream/channels:setup/pair-telegram.ts                          > setup/pair-telegram.ts
```

- [ ] **Step 4: Append self-registration imports to `src/channels/index.ts`**

Append (skip if already present):

```typescript
// whatsapp (native, no Chat SDK)
import './whatsapp.js';

// telegram
import './telegram.js';
```

- [ ] **Step 5: Register the telegram pairing setup step**

In `setup/index.ts`, add to the `STEPS` map (skip if present):

```typescript
'pair-telegram': () => import('./pair-telegram.js'),
```

- [ ] **Step 6: Install pinned deps (release-age checkpoint)**

Run:
```bash
pnpm add @whiskeysockets/baileys@7.0.0-rc.9 qrcode@1.5.4 @types/qrcode@1.5.6 pino@9.6.0 @chat-adapter/telegram@4.29.0
```

**Checkpoint:** if pnpm rejects a package because of `minimumReleaseAge` (3 days) in `pnpm-workspace.yaml`, STOP and ask the user — do not add a `minimumReleaseAgeExclude` entry without explicit human approval (AGENTS.md supply-chain rule).

- [ ] **Step 7: Build + run registration tests**

Run:
```bash
pnpm run build
pnpm exec vitest run src/channels/whatsapp-registration.test.ts src/channels/telegram-registration.test.ts
```
Expected: build clean, both registration tests PASS.

- [ ] **Step 8: Commit**

```bash
git add src/channels/ container/skills/whatsapp-formatting/ setup/pair-telegram.ts setup/index.ts package.json pnpm-lock.yaml
git commit -m "feat(channels): WhatsApp + Telegram adapters from upstream/channels"
```

### Task 10: OpenCode provider from `upstream/providers`

**Deviations recorded during execution (commits ab996324, 5f95fd03):**
- `container/agent-runner/src/providers/cwd-shim.ts` also copied (byte-identical) — `mcp-to-opencode.ts` imports it.
- `container/agent-runner/src/providers/types.ts` hand-edited to upstream's richer `McpServerConfig` union (fork's was narrower; purely additive, claude provider unaffected).
- `src/opencode-dockerfile.test.ts` was **fork-adapted**: this fork installs global CLIs via `container/cli-tools.json` (data-driven), not the upstream per-CLI `ARG OPENCODE_VERSION` + `pnpm install -g` pattern. The adapted test asserts the manifest pins `opencode-ai` exactly `1.4.17` (never `latest`) and that `container/Dockerfile` runs `sh /tmp/install-cli-tools.sh /tmp/cli-tools.json`.
- New `src/opencode-dockerfile-railway.test.ts` — `describe.runIf`-guarded assertion that `railway/Dockerfile.railway` will contain the same cli-tools install invocation. **Task 11 MUST include `COPY container/cli-tools.json container/install-cli-tools.sh /tmp/` + `sh /tmp/install-cli-tools.sh /tmp/cli-tools.json`, or this guard goes red.**
- `/update-skills` re-runs of the bundled `add-opencode` skill will clobber the fork-adapted guard and re-add a dead ARG + duplicate install — a fork-local deviation note was added to `.agents/skills/add-opencode/SKILL.md`.

**Files:**
- Create: `src/providers/opencode.ts`, `src/providers/opencode-registration.test.ts`
- Create: `container/agent-runner/src/providers/opencode.ts`, `mcp-to-opencode.ts`, `mcp-to-opencode.test.ts`, `opencode.factory.test.ts`, `opencode-registration.test.ts`
- Create: `src/opencode-dockerfile.test.ts` (copy from `.agents/skills/add-opencode/opencode-dockerfile.test.ts`)
- Modify: `src/providers/index.ts` (append `import './opencode.js';`)
- Modify: `container/agent-runner/src/providers/index.ts` (append `import './opencode.js';`)
- Modify: `container/agent-runner/package.json` + `bun.lock` (`@opencode-ai/sdk@1.4.17`)
- Modify: `container/cli-tools.json` (add `opencode-ai@1.4.17`)

- [ ] **Step 1: Fetch upstream providers branch**

Run: `git fetch upstream providers`

- [ ] **Step 2: Copy host-side provider files**

Run:
```bash
git show upstream/providers:src/providers/opencode.ts                        > src/providers/opencode.ts
git show upstream/providers:src/providers/opencode-registration.test.ts      > src/providers/opencode-registration.test.ts
cp .agents/skills/add-opencode/opencode-dockerfile.test.ts src/opencode-dockerfile.test.ts
```

Append to `src/providers/index.ts` (skip if present):

```typescript
import './opencode.js';
```

- [ ] **Step 3: Copy container-side provider files**

Run:
```bash
git show upstream/providers:container/agent-runner/src/providers/opencode.ts            > container/agent-runner/src/providers/opencode.ts
git show upstream/providers:container/agent-runner/src/providers/mcp-to-opencode.ts     > container/agent-runner/src/providers/mcp-to-opencode.ts
git show upstream/providers:container/agent-runner/src/providers/mcp-to-opencode.test.ts > container/agent-runner/src/providers/mcp-to-opencode.test.ts
git show upstream/providers:container/agent-runner/src/providers/opencode.factory.test.ts > container/agent-runner/src/providers/opencode.factory.test.ts
git show upstream/providers:container/agent-runner/src/providers/opencode-registration.test.ts > container/agent-runner/src/providers/opencode-registration.test.ts
```

Append to `container/agent-runner/src/providers/index.ts` (skip if present):

```typescript
import './opencode.js';
```

- [ ] **Step 4: Add the SDK dependency (pinned)**

Run:
```bash
cd container/agent-runner && bun add @opencode-ai/sdk@1.4.17 && cd -
```
Must be exactly `1.4.17` — the 1.14.x SDK has a breaking session API. Then `cd container/agent-runner && bun install` to refresh `bun.lock`.

- [ ] **Step 5: Add the CLI to `container/cli-tools.json`**

Append:

```json
  ,
  { "name": "opencode-ai", "version": "1.4.17", "onlyBuilt": false }
```

- [ ] **Step 6: Run the four guard tests + builds**

Run:
```bash
pnpm run build
pnpm exec tsc -p container/agent-runner/tsconfig.json --noEmit
pnpm exec vitest run src/providers/opencode-registration.test.ts src/opencode-dockerfile.test.ts
cd container/agent-runner && bun test src/providers/opencode-registration.test.ts && cd -
```
Expected: build clean, all four PASS.

- [ ] **Step 7: Commit**

```bash
git add src/providers/ src/opencode-dockerfile.test.ts container/agent-runner/src/providers/ container/agent-runner/package.json container/agent-runner/bun.lock container/cli-tools.json
git commit -m "feat(provider): OpenCode provider from upstream/providers (SDK+CLI 1.4.17)"
```

---

## Phase 4 — Railway image + IaC overlay

### Task 11: `railway/Dockerfile.railway` + entrypoint

**Deviations recorded during execution (commit 4c6addf5):**
- `agent-deps` stage apt list needs `unzip` (the Bun installer hard-requires it — the agent image gets it via its apt list; the plan's staged list omitted it).
- Runner deps go to `/app/src/node_modules` (NOT merged into `/app/node_modules`) — the merge fails because both trees carry top-level `@types/node` (pnpm symlink vs bun real dir). `/app/src/node_modules` resolves first for all `/app/src/**` imports.
- **Upgrade tripwire:** `enforceUpgradeTripwire()` refuses to boot when `data/upgrade-state.json` is missing — a fresh Railway volume has none. The entrypoint must stamp the marker with the running image version (`via: 'railway'`) before exec'ing the host. See Task 12's entrypoint edit.
- Smoke test: host boots clean, `/healthz` → `ok`, channel imports resolve, opencode provider loads.

**Files:**
- Create: `railway/Dockerfile.railway`
- Create: `railway/entrypoint.sh`
- Test: local `docker build` validation

- [ ] **Step 1: Write `railway/Dockerfile.railway`**

Build context = repo root. Multi-stage; mirror `container/Dockerfile` conventions (apt list, Bun install, pnpm CLIs):

```dockerfile
# syntax=docker/dockerfile:1.7
# NanoClaw Railway host image — Bun agent-runner + Node host + Chromium in one.

ARG BUN_VERSION=1.3.12
ARG PNPM_VERSION=10.33.0

# ---- Stage 1: agent-runner deps (Bun) ---------------------------------------
FROM node:22-slim AS agent-deps
ARG BUN_VERSION
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl git && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL https://bun.sh/install | bash -s "bun-v${BUN_VERSION}" && \
    install -m 0755 /root/.bun/bin/bun /usr/local/bin/bun && \
    rm -rf /root/.bun
WORKDIR /build/agent-runner
COPY container/agent-runner/package.json container/agent-runner/bun.lock ./
RUN bun install --frozen-lockfile

# ---- Stage 2: host build (pnpm) ---------------------------------------------
FROM node:22-slim AS host-build
ARG PNPM_VERSION
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /build/host
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.json ./
COPY src/ ./src/
RUN pnpm install --frozen-lockfile && pnpm run build

# ---- Stage 3: final ----------------------------------------------------------
FROM node:22-slim
ARG BUN_VERSION
ARG PNPM_VERSION

RUN apt-get update && apt-get install -y --no-install-recommends \
        chromium \
        fonts-liberation \
        fonts-noto-color-emoji \
        libgbm1 \
        libnss3 \
        libatk-bridge2.0-0 \
        libgtk-3-0 \
        libx11-xcb1 \
        libxcomposite1 \
        libxdamage1 \
        libxrandr2 \
        libasound2 \
        libpangocairo-1.0-0 \
        libcups2 \
        libdrm2 \
        libxshmfence1 \
        ca-certificates \
        curl \
        git \
        tini \
        unzip \
    && rm -rf /var/lib/apt/lists/*

ENV AGENT_BROWSER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"

# Bun runtime (same pin as the agent image)
COPY --from=agent-deps /usr/local/bin/bun /usr/local/bin/bun

# pnpm + global CLIs (claude-code, agent-browser, opencode-ai — pinned in
# container/cli-tools.json; the host spawns `bun /app/src/index.ts` and the
# opencode/claude providers invoke these CLIs).
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
COPY container/cli-tools.json container/install-cli-tools.sh /tmp/
RUN --mount=type=cache,target=/root/.cache/pnpm \
    sh /tmp/install-cli-tools.sh /tmp/cli-tools.json

# Host (compiled)
WORKDIR /app
COPY --from=host-build /build/host/dist ./dist/
COPY --from=host-build /build/host/node_modules ./node_modules/
COPY --from=host-build /build/host/package.json ./

# Agent-runner source + deps at the docker-mode mount paths, so runner path
# defaults (/app/src, /app/skills, /app/CLAUDE.md) resolve in host mode.
COPY --from=agent-deps /build/agent-runner/node_modules /app/node_modules/
COPY container/agent-runner/src /app/src/
COPY container/skills /app/skills/
COPY container/CLAUDE.md /app/CLAUDE.md

# Data volume + entrypoint
RUN mkdir -p /data
COPY railway/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "dist/index.js"]
```

- [ ] **Step 2: Write `railway/entrypoint.sh`**

```bash
#!/bin/sh
# Railway host entrypoint — ensure volume dirs, then start the host.
set -e

DATA_ROOT="${NANOCLAW_HOME:-/data}"
mkdir -p "$DATA_ROOT/data" "$DATA_ROOT/groups" "$DATA_ROOT/store" "$DATA_ROOT/onecli-certs"
chmod -R u+rwX "$DATA_ROOT" 2>/dev/null || true

exec "$@"
```

- [ ] **Step 3: Validate the build locally**

Run: `docker build -f railway/Dockerfile.railway -t nanoclaw-railway:test .`
Expected: image builds. Fix any COPY path errors (build context must be repo root).

- [ ] **Step 4: Smoke-test the image**

Run:
```bash
docker run --rm -e NANOCLAW_RUNTIME=host -e NANOCLAW_HOME=/data -e NANOCLAW_BOOTSTRAP=0 nanoclaw-railway:test node dist/index.js 2>&1 | head -20
```
Expected: host boots (starts logging; may exit if channel creds are absent — that's fine, verify no module-load errors, e.g. `src/channels/index.js` imports resolve).

- [ ] **Step 5: Commit**

```bash
git add railway/Dockerfile.railway railway/entrypoint.sh
git commit -m "feat(railway): host image + entrypoint"
```

### Task 12: Railway IaC — `railway.ts`, `railway.json`, README

**Files:**
- Create: `.railway/railway.ts`
- Create: `railway.json`
- Create: `railway/README.md`
- Modify: `package.json` + `pnpm-lock.yaml` (devDep `railway`)

- [ ] **Step 1: Add the IaC dev dependency**

Run: `pnpm add -D railway@3.8.1`
(Version matches the torup project's working install. If `minimumReleaseAge` rejects it, ask the user before excluding.)

- [ ] **Step 2: Write `.railway/railway.ts`**

Mirror the torup pattern (raw `${{...}}` reference strings, `preserve()` secrets, no `rootDirectory`):

```ts
import { defineRailway, github, group, image, postgres, preserve, project, service } from "railway/iac";

export default defineRailway((ctx) => {
  const db = postgres("nanoclaw-db");

  const gateway = service("nanoclaw-onecli", {
    source: image("ghcr.io/onecli/onecli@latest"), // pin a digest after first deploy (Task 12 step 5)
    deploy: { numReplicas: 1, restartPolicyType: "ON_FAILURE", restartPolicyMaxRetries: 10 },
    env: {
      DATABASE_URL: "${{nanoclaw-db.DATABASE_URL}}",
      APP_URL: "http://${{nanoclaw-onecli.RAILWAY_PRIVATE_DOMAIN}}:10254",
      GATEWAY_API_URL: "http://${{nanoclaw-onecli.RAILWAY_PRIVATE_DOMAIN}}:10255",
      INTERNAL_API_URL: "http://localhost:10254",
      NEXTAUTH_SECRET: preserve(),
    },
  });

  const host = service("nanoclaw", {
    source: github("deviracode/nanoclaw", { branch: "main" }),
    build: {
      builder: "DOCKERFILE",
      dockerfilePath: "railway/Dockerfile.railway",
    },
    healthcheckPath: "/healthz",
    deploy: { numReplicas: 1, restartPolicyType: "ON_FAILURE", restartPolicyMaxRetries: 10 },
    env: {
      NODE_ENV: "production",
      NANOCLAW_RUNTIME: "host",
      NANOCLAW_HOME: "/data",
      NANOCLAW_BOOTSTRAP: preserve(),
      NANOCLAW_OWNER_ID: preserve(),
      NANOCLAW_OWNER_DISPLAY_NAME: preserve(),
      NANOCLAW_AGENT_NAME: preserve(),
      NANOCLAW_BOOTSTRAP_CHANNELS: preserve(),
      NANOCLAW_PICKED_PROVIDER: "opencode",
      OPENCODE_PROVIDER: preserve(),
      OPENCODE_MODEL: preserve(),
      OPENCODE_SMALL_MODEL: preserve(),
      ANTHROPIC_BASE_URL: preserve(),
      TELEGRAM_BOT_TOKEN: preserve(),
      WHATSAPP_PHONE: preserve(),
      WHATSAPP_PAIRING_CODE: preserve(),
      ONECLI_URL: "http://${{nanoclaw-onecli.RAILWAY_PRIVATE_DOMAIN}}:10254",
      ONECLI_API_KEY: preserve(),
      TZ: preserve(),
    },
  });

  return project("nanoclaw", {
    resources: [group("NanoClaw", [host, gateway]), db],
  });
});
```

**Verify before committing:** `image` must be imported from `railway/iac` (exported as `image` in railway@3.8.1). If `${{nanoclaw-db.DATABASE_URL}}` does not resolve (Railway postgres plugin exposes `DATABASE_URL` on the plugin), fall back to `DATABASE_URL: preserve()` + set it via CLI in the runbook. Typecheck the file: `pnpm exec tsc --noEmit .railway/railway.ts` — if `railway/iac` lacks types for the file, validate by running `pnpm railway config plan` after linking (Task 12 step 6).

- [ ] **Step 3: Write root `railway.json`**

```json
{
  "$schema": "https://railway.com/railway.schema.json",
  "build": {
    "builder": "DOCKERFILE"
  }
}
```

- [ ] **Step 4: Write `railway/README.md`**

Sections (torup README style):
- Architecture table: `nanoclaw` (host, public port optional), `nanoclaw-onecli` (private), `nanoclaw-db` (postgres).
- Prereqs: `brew install railway`, `pnpm add -D railway` (already in repo), `railway login`.
- Deploy-from-scratch runbook: `railway init --name nanoclaw --workspace <workspace>` → `pnpm railway config plan` → `pnpm railway config apply --yes` → set `preserve()` secrets via `railway variable set --service nanoclaw --skip-deploys "..."` (one per service) → volumes: create + mount at `/data` for `nanoclaw` (`railway volume add` / dashboard) and `/app/data` for `nanoclaw-onecli` → `railway redeploy`.
- WhatsApp pairing: start host, read pairing code from `railway logs --service nanoclaw`, pair in WhatsApp > Linked Devices.
- Sync flow: `git fetch upstream && git merge upstream/main`, resolve the ~4 small conflict files, push → auto-deploy.
- Known limitations: no OS isolation, no `install_packages`, no egress lockdown, ncl CLI not reachable remotely.
- Pitfalls learned from torup: build context = repo root (no `rootDirectory`), raw `${{...}}` strings only, `preserve()` must be imported, never overwrite reference vars via CLI.

- [ ] **Step 5: Pin the OneCLI image digest**

Run: `docker buildx imagetools inspect ghcr.io/onecli/onecli:latest --format '{{.Manifest.Digest}}'`
Replace `image("ghcr.io/onecli/onecli@latest")` with `image("ghcr.io/onecli/onecli@sha256:<digest>")`.

- [ ] **Step 6: Validate the IaC plan (requires a linked Railway project)**

Run: `pnpm railway config plan`
Expected: plan shows the three resources. Fix any DSL errors. (If no project is linked yet, run `railway init --name nanoclaw` first.)

- [ ] **Step 7: Commit**

```bash
git add .railway/railway.ts railway.json railway/README.md package.json pnpm-lock.yaml
git commit -m "feat(railway): IaC config, root railway.json, ops runbook"
```

---

## Phase 5 — Deploy runbook (manual, user-executed)

### Task 13: Deploy and verify on Railway

**Files:**
- None (operational runbook — follow `railway/README.md`)

- [ ] **Step 1: Prereqs** — `brew install railway`; `railway login`; `railway whoami`.
- [ ] **Step 2: Create project** — `railway init --name nanoclaw --workspace <your-workspace>`.
- [ ] **Step 3: Apply IaC** — `pnpm railway config plan` (review) → `pnpm railway config apply --yes --confirm-destructive`.
- [ ] **Step 4: Set secrets** (per service, `--skip-deploys`): `ONECLI_API_KEY`, `NANOCLAW_OWNER_ID`, `TELEGRAM_BOT_TOKEN`, `OPENCODE_PROVIDER=deepseek`, `OPENCODE_MODEL=deepseek/deepseek-chat`, `OPENCODE_SMALL_MODEL=deepseek/deepseek-chat`, `ANTHROPIC_BASE_URL=https://api.deepseek.com/v1`, `NANOCLAW_BOOTSTRAP=1`.
- [ ] **Step 5: Volumes** — create + mount `/data` on `nanoclaw`, `/app/data` on `nanoclaw-onecli`.
- [ ] **Step 6: OneCLI setup** — open the gateway web UI (`railway logs` for the URL, or port-forward via `railway connect`), create agent + register DeepSeek secret with `--host-pattern "api.deepseek.com"` + `--header-name Authorization --value-format "Bearer {value}"`, then grant it to the agent (set-secrets merge pattern from the add-opencode skill).
- [ ] **Step 7: Deploy + pair WhatsApp** — `railway redeploy --service nanoclaw -y`; read pairing code from logs; pair on phone; confirm auth persisted on volume.
- [ ] **Step 8: Verify** — send a Telegram DM to the bot; expect the welcome message, then a DeepSeek-backed reply; check `railway logs` for the poll loop + OneCLI gateway application per spawn.
- [ ] **Step 9: Sync smoke test** — `git fetch upstream && git merge upstream/main`; expect no conflicts beyond the known small files; push; confirm auto-deploy succeeds.

---

## Self-Review

**Spec coverage:**
- Host-runtime mode → Tasks 3-6 ✓
- Agent-runner paths → Tasks 1-2 ✓
- OneCLI host-mode + separate service → Tasks 5, 12 ✓
- Channels baked in → Task 9 ✓
- OpenCode/DeepSeek provider → Task 10 ✓
- Image (Chromium, Bun, CLIs, agent-runner at /app paths) → Task 11 ✓
- Volume / `NANOCLAW_HOME` → Tasks 3, 12 ✓
- Bootstrap → Task 8 ✓
- Health endpoint → Task 7 ✓
- IaC + sync workflow + ops docs → Task 12 ✓
- Deploy/verify → Task 13 ✓

**Placeholder scan:** No TBD/TODO. One intentional verify-flag (DATABASE_URL reference resolution, OneCLI image digest pin) has explicit fallbacks in-steps.

**Type consistency:** `translateMountsToHostEnv` (Task 4) consumed by `spawnContainerHost` (Task 6); `applyOnecliConfigHostMode` (Task 5) consumed by Task 6; `wireDmAgent` (Task 8) shared by script + bootstrap; `paths.ts` exports used consistently across Task 2 sites; `IS_HOST_RUNTIME`/`HEALTH_PORT`/`DATA_DIR` (Task 3) used in Tasks 6-8.
