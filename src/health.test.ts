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
