/**
 * Railway-image dependency guard for the OpenCode CLI integration point
 * (host tree, vitest).
 *
 * The Railway host image (`railway/Dockerfile.railway`, created by the
 * railway-deployment plan's Task 11) must ship the same global CLIs as the
 * agent image — including `opencode-ai@1.4.17`, the pinned CLI the OpenCode
 * provider invokes — and it installs them the same data-driven way:
 * `install-cli-tools.sh` against `container/cli-tools.json` (see
 * `src/opencode-dockerfile.test.ts` for the manifest pin canary).
 *
 * The Dockerfile does not exist yet (Task 11 creates it), so this guard
 * activates the moment it lands: while the file is absent the suite stays
 * green (`describe.runIf`), and once it exists the install invocation must be
 * present or this goes red. Task 11 must include the `install-cli-tools.sh`
 * invocation in `railway/Dockerfile.railway`.
 */
import fs from 'fs';
import path from 'path';

import { describe, it, expect } from 'vitest';

/** Read a repo-root-relative file, walking up from this test's location so it works wherever it is copied. */
function repoFile(relPath: string): string | null {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, relPath);
    if (fs.existsSync(candidate)) return fs.readFileSync(candidate, 'utf8');
    dir = path.dirname(dir);
  }
  return null;
}

const railwayDockerfile = repoFile(path.join('railway', 'Dockerfile.railway'));

describe.runIf(railwayDockerfile !== null)('railway/Dockerfile.railway installs the CLIs from the manifest', () => {
  it('runs install-cli-tools.sh against cli-tools.json', () => {
    expect(railwayDockerfile!).toMatch(/sh \/tmp\/install-cli-tools\.sh \/tmp\/cli-tools\.json/);
  });
});
