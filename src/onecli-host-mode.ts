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
  path: string;
  content: string;
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
    env[key] = key.toLowerCase().includes('proxy') ? rewriteProxyHost(value, oncliUrl) : value;
  }

  const certsDir = path.join(dataDir, 'onecli-certs');
  fs.mkdirSync(certsDir, { recursive: true });
  const certFile = path.join(
    certsDir,
    `ca-${crypto.createHash('sha1').update(config.caCertificate).digest('hex').slice(0, 12)}.pem`,
  );
  fs.writeFileSync(certFile, config.caCertificate);
  files.push({ path: certFile, content: config.caCertificate });

  env.NODE_EXTRA_CA_CERTS = certFile;
  env.SSL_CERT_FILE = certFile;
  env.DENO_CERT = certFile;

  for (const stub of config.credentialStubs ?? []) {
    fs.mkdirSync(path.dirname(stub.containerPath), { recursive: true });
    fs.writeFileSync(stub.containerPath, stub.content);
    files.push({ path: stub.containerPath, content: stub.content });
  }

  return { env, files };
}
