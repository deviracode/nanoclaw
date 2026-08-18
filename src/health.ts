import http from 'http';
import { log } from './log.js';

/** Minimal liveness endpoint so Railway can healthcheck the host. */
export function createHealthServer(): http.Server {
  return http.createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
  });
}

export function startHealthServer(port: string): http.Server {
  const portNum = Number(port);
  if (!Number.isInteger(portNum) || portNum < 0 || portNum > 65535) {
    log.error('Invalid health port — defaulting to 8080', { port });
    port = '8080';
  }
  const server = createHealthServer();
  server.on('error', (err) => {
    log.fatal('Health server failed to bind — exiting', { port, err });
    process.exit(1);
  });
  server.listen(Number(port), '0.0.0.0', () => log.info('Health server listening', { port }));
  return server;
}
