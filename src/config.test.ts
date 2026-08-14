import { afterEach, describe, expect, test, vi } from 'vitest';

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
