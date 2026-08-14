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
