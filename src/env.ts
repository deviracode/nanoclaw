import fs from 'fs';
import path from 'path';
import { log } from './log.js';

/**
 * Parse the .env file and return values for the requested keys.
 * Does NOT load anything into process.env — callers decide what to
 * do with the values. This keeps secrets out of the process environment
 * so they don't leak to child processes.
 *
 * Fork-local (Railway): when the .env file is absent — Railway injects
 * env directly, there is no .env file — or lacks a requested key, the
 * value falls back to process.env per key. File wins, process.env is
 * the fallback.
 */
export function readEnvFile(keys: string[]): Record<string, string> {
  const envFile = path.join(process.cwd(), '.env');
  let content: string;
  try {
    content = fs.readFileSync(envFile, 'utf-8');
  } catch (err) {
    log.debug('.env file not found, falling back to process.env', { err });
    return pickFromProcessEnv(keys);
  }

  const result: Record<string, string> = {};
  const wanted = new Set(keys);

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    if (!wanted.has(key)) continue;
    let value = trimmed.slice(eqIdx + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    if (value) result[key] = value;
  }

  // Per-key process.env fallback for anything the file didn't provide
  // (missing file, absent key, empty value).
  for (const key of keys) {
    if (result[key] === undefined && process.env[key] !== undefined) {
      result[key] = process.env[key]!;
    }
  }

  return result;
}

function pickFromProcessEnv(keys: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of keys) {
    if (process.env[key] !== undefined) result[key] = process.env[key]!;
  }
  return result;
}
