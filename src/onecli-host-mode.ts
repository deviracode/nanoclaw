import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

import { MOUNT_ENV_MAP } from './container-runtime.js';

/**
 * Host-runtime translation of the OneCLI container config. The docker path
 * calls `onecli.applyContainerConfig(args)` which appends `-e` / `-v` args;
 * here we produce the same effects as child-process env + local files.
 */

export interface OnecliContainerConfig {
  env: Record<string, string>;
  caCertificate: string;
  caCertificateContainerPath: string;
  credentialStubs?: { containerPath: string; content: string }[];
}

export interface HostModeFiles {
  containerPath: string; // original gateway-provided path (e.g. /workspace/agent/.auth)
  hostPath: string; // where the file was actually written
  content: string;
}

const SYSTEM_CA_PATHS = ['/etc/ssl/certs/ca-certificates.crt', '/etc/pki/tls/certs/ca-bundle.crt'];

/** Container-path prefixes the host runtime relocates via env (shared with container-runtime). */
const CONTAINER_PREFIX_ENV: Record<string, string> = { ...MOUNT_ENV_MAP };

export function mapContainerPathToHost(containerPath: string, mountEnv: Record<string, string>): string {
  const prefixes = Object.entries(CONTAINER_PREFIX_ENV).sort((a, b) => b[0].length - a[0].length);
  for (const [prefix, envKey] of prefixes) {
    if (containerPath === prefix || containerPath.startsWith(prefix + '/')) {
      const hostBase = mountEnv[envKey];
      if (hostBase) return path.join(hostBase, containerPath.slice(prefix.length).replace(/^\//, ''));
    }
  }
  return containerPath; // unmapped — treat as host-absolute
}

export interface RelocateResult {
  relocated: string[];
  skipped: string[];
}

/**
 * Copy credential stubs to their relocated host paths. Files whose
 * containerPath doesn't map to a relocated prefix (e.g. the CA entry,
 * served via env vars) are skipped, never written to literal host paths.
 */
export function relocateCredentialFiles(
  files: HostModeFiles[],
  mountEnv: Record<string, string>,
): RelocateResult {
  const result: RelocateResult = { relocated: [], skipped: [] };
  for (const file of files) {
    if (!file.containerPath) {
      result.skipped.push(file.hostPath);
      continue;
    }
    const hostPath = mapContainerPathToHost(file.containerPath, mountEnv);
    if (hostPath === file.containerPath) {
      result.skipped.push(file.containerPath);
      continue;
    }
    fs.mkdirSync(path.dirname(hostPath), { recursive: true });
    fs.writeFileSync(hostPath, file.content, { mode: 0o600 });
    result.relocated.push(hostPath);
  }
  return result;
}

function findSystemCaBundle(): string | null {
  for (const p of SYSTEM_CA_PATHS) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

export function rewriteProxyHost(proxyUrl: string, oncliUrl: string): string {
  try {
    const proxy = new URL(proxyUrl);
    const gateway = new URL(oncliUrl);
    if (proxy.hostname === 'host.docker.internal' || proxy.hostname === 'host-gateway') {
      proxy.hostname = gateway.hostname;
    }
    return proxy.toString().replace(/\/$/, '');
  } catch {
    return proxyUrl;
  }
}

export function applyOnecliConfigHostMode(
  config: OnecliContainerConfig,
  oncliUrl: string,
  dataDir: string,
): { env: Record<string, string>; files: HostModeFiles[] } {
  const env: Record<string, string> = {};
  const files: HostModeFiles[] = [];

  for (const [key, value] of Object.entries(config.env)) {
    const isProxyUrl = key.toLowerCase().includes('proxy') && key.toLowerCase() !== 'no_proxy';
    env[key] = isProxyUrl ? rewriteProxyHost(value, oncliUrl) : value;
  }

  const certsDir = path.join(dataDir, 'onecli-certs');
  fs.mkdirSync(certsDir, { recursive: true });
  const hash = crypto.createHash('sha1').update(config.caCertificate).digest('hex').slice(0, 12);
  const combinedFile = path.join(certsDir, `ca-combined-${hash}.pem`);

  const systemBundle = findSystemCaBundle();
  const combined = systemBundle
    ? `${fs.readFileSync(systemBundle, 'utf8')}\n${config.caCertificate}`
    : config.caCertificate;
  fs.writeFileSync(combinedFile, combined);
  files.push({ containerPath: config.caCertificateContainerPath, hostPath: combinedFile, content: combined });

  env.NODE_EXTRA_CA_CERTS = combinedFile;
  if (systemBundle) {
    env.SSL_CERT_FILE = combinedFile;
    env.DENO_CERT = combinedFile;
  }

  for (const stub of config.credentialStubs ?? []) {
    const hostPath = path.join(dataDir, 'onecli-stubs', path.basename(stub.containerPath));
    fs.mkdirSync(path.dirname(hostPath), { recursive: true });
    fs.writeFileSync(hostPath, stub.content, { mode: 0o600 });
    files.push({ containerPath: stub.containerPath, hostPath, content: stub.content });
  }

  return { env, files };
}
