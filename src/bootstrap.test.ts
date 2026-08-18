import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type Database from 'better-sqlite3';

describe('runBootstrap', () => {
  let homeDir: string;

  beforeEach(() => {
    // wireDmAgent writes the group persona under GROUPS_DIR, and the welcome
    // socket path derives from DATA_DIR — both resolve from NANOCLAW_HOME at
    // import time, so the env must be set before any config-dependent module
    // is imported (dynamic imports + resetModules per test).
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nanoclaw-bootstrap-'));
    process.env.NANOCLAW_HOME = homeDir;
    vi.resetModules();
  });

  afterEach(async () => {
    const { closeDb } = await import('./db/connection.js');
    closeDb();
    delete process.env.NANOCLAW_HOME;
    vi.resetModules();
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  async function freshDb(): Promise<Database.Database> {
    const { initDb } = await import('./db/connection.js');
    const { runMigrations } = await import('./db/migrations/index.js');
    const db = initDb(path.join(homeDir, 'data', 'v2.db'));
    runMigrations(db);
    return db;
  }

  test('empty DB is seeded with an owner', async () => {
    const db = await freshDb();
    const { runBootstrap } = await import('./bootstrap.js');
    const seeded = await runBootstrap({
      db,
      ownerId: 'telegram:12345',
      displayName: 'Alice',
      channels: [{ channel: 'telegram', platformId: 'telegram:999' }],
      provider: 'opencode',
      welcome: 'System instruction: hi',
    });
    expect(seeded).toBe(true);

    const { getUserRoles } = await import('./modules/permissions/db/user-roles.js');
    const roles = getUserRoles('telegram:12345');
    expect(roles.some((r) => r.role === 'owner' && r.agent_group_id === null)).toBe(true);
    const cfg = db.prepare('SELECT provider, cli_scope FROM container_configs').get() as {
      provider: string | null;
      cli_scope: string;
    };
    expect(cfg.provider).toBe('opencode');
    expect(cfg.cli_scope).toBe('global');
    const { closeDb } = await import('./db/connection.js');
    closeDb();
  });

  test('empty ownerId skips provisioning', async () => {
    const db = await freshDb();
    const { runBootstrap } = await import('./bootstrap.js');
    await expect(runBootstrap({ db, ownerId: '', channels: [] })).resolves.toBe(false);
    await expect(runBootstrap({ db, ownerId: '  ,  ', channels: [] })).resolves.toBe(false);
    const users = db.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number };
    expect(users.c).toBe(0);
    const { closeDb } = await import('./db/connection.js');
    closeDb();
  });

  test('malformed ownerId entries are skipped', async () => {
    const db = await freshDb();
    const { runBootstrap } = await import('./bootstrap.js');
    // 'no-colon-here' and ':12345' are invalid; 'telegram:12345' still wires.
    await expect(runBootstrap({ db, ownerId: 'no-colon-here,:12345,telegram:12345', channels: [] })).resolves.toBe(
      true,
    );
    const ids = db.prepare('SELECT id FROM users').all() as { id: string }[];
    expect(ids.map((u) => u.id)).toEqual(['telegram:12345']);
    const { closeDb } = await import('./db/connection.js');
    closeDb();
  });

  test('re-running after a successful seed returns false', async () => {
    const db = await freshDb();
    const { runBootstrap } = await import('./bootstrap.js');
    const opts = {
      db,
      ownerId: 'telegram:12345',
      displayName: 'Alice',
      channels: [{ channel: 'telegram', platformId: 'telegram:999' }],
    };
    await expect(runBootstrap(opts)).resolves.toBe(true);
    await expect(runBootstrap(opts)).resolves.toBe(false);

    const { getUserRoles } = await import('./modules/permissions/db/user-roles.js');
    // Re-run must not duplicate the owner grant.
    expect(getUserRoles('telegram:12345').filter((r) => r.role === 'owner')).toHaveLength(1);
    const { closeDb } = await import('./db/connection.js');
    closeDb();
  });

  test('comma-separated ownerId wires each matching channel', async () => {
    const db = await freshDb();
    const { runBootstrap } = await import('./bootstrap.js');
    const seeded = await runBootstrap({
      db,
      ownerId: 'telegram:12345, whatsapp:+15551234567',
      displayName: 'Alice',
      channels: [
        { channel: 'telegram', platformId: 'telegram:999' },
        { channel: 'whatsapp', platformId: 'whatsapp:888' },
      ],
    });
    expect(seeded).toBe(true);

    const { getMessagingGroupByPlatform } = await import('./db/messaging-groups.js');
    expect(getMessagingGroupByPlatform('telegram', 'telegram:999')).toBeTruthy();
    expect(getMessagingGroupByPlatform('whatsapp', 'whatsapp:888')).toBeTruthy();
    const wirings = db.prepare('SELECT COUNT(*) AS c FROM messaging_group_agents').get() as { c: number };
    expect(wirings.c).toBe(2);
    const { closeDb } = await import('./db/connection.js');
    closeDb();
  });

  test('empty per-channel platformId falls back to the ownerId entry', async () => {
    const db = await freshDb();
    const { runBootstrap } = await import('./bootstrap.js');
    const seeded = await runBootstrap({
      db,
      ownerId: 'telegram:12345',
      displayName: 'Alice',
      channels: [{ channel: 'telegram', platformId: '' }],
    });
    expect(seeded).toBe(true);

    const { getMessagingGroupByPlatform } = await import('./db/messaging-groups.js');
    expect(getMessagingGroupByPlatform('telegram', 'telegram:12345')).toBeTruthy();
    const { closeDb } = await import('./db/connection.js');
    closeDb();
  });

  test('welcome send failure is swallowed', async () => {
    const db = await freshDb();
    const { runBootstrap } = await import('./bootstrap.js');
    // No socket server is listening — the connect fails, but that must not
    // surface: runBootstrap still resolves true.
    await expect(
      runBootstrap({
        db,
        ownerId: 'telegram:12345',
        displayName: 'Alice',
        channels: [{ channel: 'telegram', platformId: 'telegram:999' }],
        welcome: 'System instruction: hello',
      }),
    ).resolves.toBe(true);
    const { closeDb } = await import('./db/connection.js');
    closeDb();
  });
});
