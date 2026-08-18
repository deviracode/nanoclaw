import path from 'path';
import { afterEach, describe, expect, test, vi } from 'vitest';

describe('host runtime config', () => {
  const saved = { runtime: process.env.NANOCLAW_RUNTIME, home: process.env.NANOCLAW_HOME, port: process.env.PORT };
  afterEach(() => {
    const envKey = { runtime: 'NANOCLAW_RUNTIME', home: 'NANOCLAW_HOME', port: 'PORT' } as const;
    for (const [key, value] of Object.entries(saved)) {
      const envName = envKey[key as keyof typeof envKey];
      if (value === undefined) delete process.env[envName];
      else process.env[envName] = value;
    }
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

  test('default data dirs resolve under the project root when NANOCLAW_HOME unset', async () => {
    delete process.env.NANOCLAW_HOME;
    const { DATA_DIR, GROUPS_DIR, STORE_DIR } = await import('./config.js');
    const root = process.cwd();
    expect(DATA_DIR).toBe(path.resolve(root, 'data'));
    expect(GROUPS_DIR).toBe(path.resolve(root, 'groups'));
    expect(STORE_DIR).toBe(path.resolve(root, 'store'));
  });

  test('health port defaults to 8080', async () => {
    delete process.env.PORT;
    const { HEALTH_PORT } = await import('./config.js');
    expect(HEALTH_PORT).toBe('8080');
  });

  test('shared surfaces resolve under the repo in docker runtime', async () => {
    delete process.env.NANOCLAW_RUNTIME;
    const { sharedSkillsDir, sharedClaudeMd, sharedMcpToolsDir } = await import('./config.js');
    const root = process.cwd();
    expect(sharedSkillsDir()).toBe(path.resolve(root, 'container', 'skills'));
    expect(sharedClaudeMd()).toBe(path.resolve(root, 'container', 'CLAUDE.md'));
    expect(sharedMcpToolsDir()).toBe(path.resolve(root, 'container', 'agent-runner', 'src', 'mcp-tools'));
  });

  test('shared surfaces resolve to /app paths in host runtime', async () => {
    process.env.NANOCLAW_RUNTIME = 'host';
    const { sharedSkillsDir, sharedClaudeMd, sharedMcpToolsDir } = await import('./config.js');
    expect(sharedSkillsDir()).toBe('/app/skills');
    expect(sharedClaudeMd()).toBe('/app/CLAUDE.md');
    expect(sharedMcpToolsDir()).toBe('/app/src/mcp-tools');
  });
});
