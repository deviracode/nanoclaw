import { afterEach, describe, expect, test } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { applyOnecliConfigHostMode, rewriteProxyHost } from './onecli-host-mode.js';

let dataDir: string;

afterEach(() => {
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('rewriteProxyHost', () => {
  test('replaces host.docker.internal with the gateway host', () => {
    expect(rewriteProxyHost('http://host.docker.internal:10255', 'http://nanoclaw-onecli.railway.internal:10254')).toBe(
      'http://nanoclaw-onecli.railway.internal:10255',
    );
  });

  test('leaves already-valid hosts untouched', () => {
    expect(rewriteProxyHost('http://gateway.example:10255', 'http://x.railway.internal:10254')).toBe(
      'http://gateway.example:10255',
    );
  });

  test('handles unparseable input gracefully', () => {
    expect(rewriteProxyHost('not-a-url', 'http://x')).toBe('not-a-url');
  });
});

describe('applyOnecliConfigHostMode', () => {
  const config = {
    env: { HTTPS_PROXY: 'http://host.docker.internal:10255', DENO_CERT: '/tmp/onecli-combined-ca.pem' },
    caCertificate: '-----BEGIN CERTIFICATE-----\nMOCK\n-----END CERTIFICATE-----',
    caCertificateContainerPath: '/tmp/onecli-ca.pem',
  };

  test('returns rewritten env, cert file, and stub files', () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onecli-host-mode-'));
    const stubPath = path.join(dataDir, 'workspace', 'agent', '.auth');
    const out = applyOnecliConfigHostMode(
      { ...config, credentialStubs: [{ containerPath: stubPath, content: 'stub-content' }] },
      'http://nanoclaw-onecli.railway.internal:10254',
      dataDir,
    );
    expect(out.env.HTTPS_PROXY).toBe('http://nanoclaw-onecli.railway.internal:10255');
    expect(out.files.some((f) => f.path.endsWith('.pem') && f.content.includes('MOCK'))).toBe(true);
    expect(out.files.some((f) => f.path === stubPath && f.content === 'stub-content')).toBe(true);
    expect(out.env.NODE_EXTRA_CA_CERTS).toBeTruthy();
    expect(out.env.SSL_CERT_FILE).toBe(out.env.NODE_EXTRA_CA_CERTS);
    expect(out.env.DENO_CERT).toBe(out.env.NODE_EXTRA_CA_CERTS);
  });
});
