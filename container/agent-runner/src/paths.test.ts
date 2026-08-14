import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

const PATH_ENV_VARS = ['WORKSPACE_DIR', 'AGENT_DIR', 'SRC_DIR', 'SKILLS_DIR', 'EXTRA_DIR'] as const;
let savedEnv: Partial<Record<(typeof PATH_ENV_VARS)[number], string | undefined>> = {};

beforeEach(() => {
  savedEnv = {};
  for (const k of PATH_ENV_VARS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  const restore = (k: string, v: string | undefined) => (v === undefined ? delete process.env[k] : (process.env[k] = v));
  for (const k of PATH_ENV_VARS) restore(k, savedEnv[k]);
});

describe('paths', () => {
  test('defaults to docker layout when env is unset', async () => {
    const m = await import('./paths.js?defaults=1');
    expect(m.WORKSPACE_DIR).toBe('/workspace');
    expect(m.AGENT_DIR).toBe('/workspace/agent');
    expect(m.SRC_DIR).toBe('/app/src');
    expect(m.SKILLS_DIR).toBe('/app/skills');
    expect(m.EXTRA_DIR).toBe('/workspace/extra');
  });

  test('env overrides are honored: WORKSPACE_DIR roots AGENT_DIR and EXTRA_DIR, others standalone', async () => {
    process.env.WORKSPACE_DIR = '/data/railway';
    process.env.SRC_DIR = '/data/src';
    process.env.SKILLS_DIR = '/data/skills';

    const m = await import('./paths.js?override=1');
    expect(m.WORKSPACE_DIR).toBe('/data/railway');
    expect(m.AGENT_DIR).toBe('/data/railway/agent');
    expect(m.EXTRA_DIR).toBe('/data/railway/extra');
    expect(m.SRC_DIR).toBe('/data/src');
    expect(m.SKILLS_DIR).toBe('/data/skills');
  });

  test('AGENT_DIR is honored directly when set', async () => {
    process.env.AGENT_DIR = '/custom/agent-dir';
    const m = await import('./paths.js?agent=1');
    expect(m.AGENT_DIR).toBe('/custom/agent-dir');
  });
});
