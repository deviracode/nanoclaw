import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

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
