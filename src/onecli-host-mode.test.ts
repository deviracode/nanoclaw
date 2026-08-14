import { afterEach, describe, expect, test } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { applyOnecliConfigHostMode, mapContainerPathToHost, rewriteProxyHost } from './onecli-host-mode.js';

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
  const systemBundle = ['/etc/ssl/certs/ca-certificates.crt', '/etc/pki/tls/certs/ca-bundle.crt'].find((p) =>
    fs.existsSync(p),
  );

  const baseConfig = {
    env: { HTTPS_PROXY: 'http://host.docker.internal:10255', NO_PROXY: 'host.docker.internal,localhost,127.0.0.1' },
    caCertificate: '-----BEGIN CERTIFICATE-----\nMOCK\n-----END CERTIFICATE-----',
    caCertificateContainerPath: '/tmp/onecli-ca.pem',
  };

  const gatewayUrl = 'http://nanoclaw-onecli.railway.internal:10254';

  test('combines gateway cert with system CA bundle, or falls back to NODE_EXTRA_CA_CERTS only', () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onecli-host-mode-'));
    const out = applyOnecliConfigHostMode(baseConfig, gatewayUrl, dataDir);

    expect(out.env.HTTPS_PROXY).toBe('http://nanoclaw-onecli.railway.internal:10255');

    const certFile = out.files.find((f) => f.hostPath.endsWith('.pem'));
    expect(certFile).toBeTruthy();
    const onDisk = fs.readFileSync(certFile!.hostPath, 'utf8');
    expect(onDisk).toContain('MOCK');
    expect(certFile!.content).toBe(onDisk);
    expect(certFile!.containerPath).toBe('/tmp/onecli-ca.pem');
    expect(out.env.NODE_EXTRA_CA_CERTS).toBe(certFile!.hostPath);

    if (systemBundle) {
      expect(onDisk).toContain(fs.readFileSync(systemBundle, 'utf8'));
      expect(onDisk).toContain('-----BEGIN CERTIFICATE-----\nMOCK');
      expect(out.env.SSL_CERT_FILE).toBe(certFile!.hostPath);
      expect(out.env.DENO_CERT).toBe(certFile!.hostPath);
    } else {
      expect(out.env.SSL_CERT_FILE).toBeUndefined();
      expect(out.env.DENO_CERT).toBeUndefined();
    }
  });

  test('writes credential stubs under onecli-stubs with mode 0600 and both paths', () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onecli-host-mode-'));
    const out = applyOnecliConfigHostMode(
      { ...baseConfig, credentialStubs: [{ containerPath: '/workspace/agent/.auth', content: 'stub-content' }] },
      gatewayUrl,
      dataDir,
    );

    const stub = out.files.find((f) => f.content === 'stub-content');
    expect(stub).toBeTruthy();
    expect(stub!.containerPath).toBe('/workspace/agent/.auth');
    expect(stub!.hostPath).toBe(path.join(dataDir, 'onecli-stubs', '.auth'));
    expect(fs.readFileSync(stub!.hostPath, 'utf8')).toBe('stub-content');
    expect(fs.statSync(stub!.hostPath).mode & 0o777).toBe(0o600);
  });

  test('passes NO_PROXY through untouched and rewrites https proxies', () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onecli-host-mode-'));
    const out = applyOnecliConfigHostMode(
      { ...baseConfig, env: { HTTPS_PROXY: 'https://host-gateway:10255', NO_PROXY: 'host.docker.internal,localhost' } },
      gatewayUrl,
      dataDir,
    );

    expect(out.env.NO_PROXY).toBe('host.docker.internal,localhost');
    expect(out.env.HTTPS_PROXY).toBe('https://nanoclaw-onecli.railway.internal:10255');
  });

  test('writes no stub files when credentialStubs is absent or empty', () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onecli-host-mode-'));
    const out = applyOnecliConfigHostMode(baseConfig, gatewayUrl, dataDir);
    expect(out.files).toHaveLength(1);
    expect(fs.existsSync(path.join(dataDir, 'onecli-stubs'))).toBe(false);

    const outEmpty = applyOnecliConfigHostMode({ ...baseConfig, credentialStubs: [] }, gatewayUrl, dataDir);
    expect(outEmpty.files).toHaveLength(1);
  });
});

describe('mapContainerPathToHost', () => {
  const mountEnv = {
    AGENT_DIR: '/data/groups/dm-x',
    WORKSPACE_DIR: '/data/sess',
    CLAUDE_CONFIG_DIR: '/data/claude-shared',
  };

  test('maps /workspace/agent paths via AGENT_DIR (longest prefix wins)', () => {
    expect(mapContainerPathToHost('/workspace/agent/.auth', mountEnv)).toBe('/data/groups/dm-x/.auth');
  });

  test('maps /workspace paths via WORKSPACE_DIR', () => {
    expect(mapContainerPathToHost('/workspace/inbound.db', mountEnv)).toBe('/data/sess/inbound.db');
  });

  test('maps /home/node/.claude paths via CLAUDE_CONFIG_DIR', () => {
    expect(mapContainerPathToHost('/home/node/.claude/settings.json', mountEnv)).toBe(
      '/data/claude-shared/settings.json',
    );
  });

  test('maps exact prefix matches without a trailing slash', () => {
    expect(mapContainerPathToHost('/workspace/agent', mountEnv)).toBe('/data/groups/dm-x');
  });

  test('leaves unmapped paths unchanged (treated as host-absolute)', () => {
    expect(mapContainerPathToHost('/etc/passwd', mountEnv)).toBe('/etc/passwd');
  });

  test('falls back to the original path when the env var is unset', () => {
    expect(mapContainerPathToHost('/workspace/agent/.auth', {})).toBe('/workspace/agent/.auth');
  });
});
