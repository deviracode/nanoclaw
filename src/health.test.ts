import { describe, expect, test } from 'vitest';
import { createHealthServer, startHealthServer } from './health.js';

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

  test('rejects non-GET/HEAD methods with 404', async () => {
    const server = createHealthServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address() as { port: number };
    const res = await fetch(`http://127.0.0.1:${addr.port}/healthz`, { method: 'POST' });
    expect(res.status).toBe(404);
    await new Promise((resolve) => server.close(resolve));
  });

  test('startHealthServer serves ok on an ephemeral port', async () => {
    const server = startHealthServer('0');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const addr = server.address() as { port: number };
    const res = await fetch(`http://127.0.0.1:${addr.port}/`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
    await new Promise((resolve) => server.close(resolve));
  });
});
