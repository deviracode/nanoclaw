import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock log
vi.mock('./log.js', () => ({
  log: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  },
}));

import { readEnvFile } from './env.js';

describe('readEnvFile', () => {
  let tmpDir: string;
  let cwdSpy: ReturnType<typeof vi.spyOn>;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nanoclaw-env-test-'));
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);
    for (const k of ['TELEGRAM_BOT_TOKEN', 'WHATSAPP_PHONE_NUMBER', 'WHATSAPP_ENABLED']) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    cwdSpy.mockRestore();
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns {} when .env is absent and process.env has nothing', () => {
    expect(readEnvFile(['TELEGRAM_BOT_TOKEN'])).toEqual({});
  });

  it('falls back to process.env when the .env file is missing', () => {
    process.env.TELEGRAM_BOT_TOKEN = 'process-token';
    expect(readEnvFile(['TELEGRAM_BOT_TOKEN'])).toEqual({ TELEGRAM_BOT_TOKEN: 'process-token' });
  });

  it('falls back to process.env per key when the file lacks a value', () => {
    fs.writeFileSync(path.join(tmpDir, '.env'), 'TELEGRAM_BOT_TOKEN=file-token\n');
    process.env.WHATSAPP_PHONE_NUMBER = 'process-phone';
    const out = readEnvFile(['TELEGRAM_BOT_TOKEN', 'WHATSAPP_PHONE_NUMBER', 'WHATSAPP_ENABLED']);
    expect(out.TELEGRAM_BOT_TOKEN).toBe('file-token');
    expect(out.WHATSAPP_PHONE_NUMBER).toBe('process-phone');
    expect(out.WHATSAPP_ENABLED).toBeUndefined();
  });

  it('file wins over process.env', () => {
    fs.writeFileSync(path.join(tmpDir, '.env'), 'TELEGRAM_BOT_TOKEN=file-token\n');
    process.env.TELEGRAM_BOT_TOKEN = 'process-token';
    expect(readEnvFile(['TELEGRAM_BOT_TOKEN'])).toEqual({ TELEGRAM_BOT_TOKEN: 'file-token' });
  });
});
