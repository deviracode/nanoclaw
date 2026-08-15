/**
 * Dependency guard for the OpenCode CLI integration point (host tree, vitest).
 *
 * add-opencode ships the `opencode-ai` CLI globally in the agent container
 * image. A globally-installed CLI binary is not importable or typed, so
 * neither `tsc` nor a runtime import can catch its removal — only the
 * container image build would, and the skill's validate step does not rebuild
 * the image in CI. This structural test stands in for that build leg.
 *
 * This fork installs global CLIs data-driven: `container/Dockerfile` runs
 * `install-cli-tools.sh` against `container/cli-tools.json` (pinned name@version
 * entries), rather than the upstream per-CLI `ARG OPENCODE_VERSION` + pnpm
 * block. The canary therefore has two halves: the manifest pins
 * `opencode-ai` at the exact SDK version the container provider imports, and
 * the Dockerfile still invokes the manifest installer. Drop or drift either
 * and this goes red.
 *
 * Pinning matters here beyond reproducibility: the `opencode-ai` CLI version
 * must match the `@opencode-ai/sdk` version the container provider imports. An
 * unpinned `latest` would silently upgrade the CLI past the SDK's compatible
 * range and break sessions. The test therefore rejects `latest`.
 */
import fs from 'fs';
import path from 'path';

import { describe, it, expect } from 'vitest';

/** The `@opencode-ai/sdk` version the container provider imports — the CLI must match it. */
const OPENCODE_SDK_VERSION = '1.4.17';

/** Read a repo-root-relative file, walking up from this test's location so it works wherever it is copied. */
function repoFile(relPath: string): string {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, relPath);
    if (fs.existsSync(candidate)) return fs.readFileSync(candidate, 'utf8');
    dir = path.dirname(dir);
  }
  throw new Error(`${relPath} not found walking up from ${__dirname}`);
}

describe('opencode-ai CLI ships in agent images via the cli-tools manifest', () => {
  const manifest = JSON.parse(repoFile(path.join('container', 'cli-tools.json'))) as Array<{
    name: string;
    version: string;
  }>;

  it('pins opencode-ai in cli-tools.json at the SDK version (never latest)', () => {
    const entry = manifest.find((tool) => tool.name === 'opencode-ai');
    expect(entry, 'opencode-ai entry missing from container/cli-tools.json').toBeDefined();
    expect(entry!.version, 'opencode-ai CLI version must match the @opencode-ai/sdk pin').toBe(OPENCODE_SDK_VERSION);
    expect(entry!.version).not.toBe('latest');
  });

  it('container/Dockerfile installs the CLIs from the manifest', () => {
    const text = repoFile(path.join('container', 'Dockerfile'));
    expect(text).toMatch(/sh \/tmp\/install-cli-tools\.sh \/tmp\/cli-tools\.json/);
  });
});
