import { describe, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { resolveSkillsPaths } from './opencode.js';

describe('resolveSkillsPaths', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-skills-'));

  test('prefers the group-selected skills at $CLAUDE_CONFIG_DIR/skills (host mode)', () => {
    const claudeDir = path.join(tmp, 'claude-shared');
    fs.mkdirSync(path.join(claudeDir, 'skills', 'gh-cli'), { recursive: true });
    const env = { CLAUDE_CONFIG_DIR: claudeDir };
    expect(resolveSkillsPaths(env)).toEqual({ paths: [path.join(claudeDir, 'skills')] });
  });

  test('falls back to the shared /app/skills when CLAUDE_CONFIG_DIR is unset', () => {
    if (!fs.existsSync('/app/skills')) return; // docker-mode image path; absent on dev hosts
    expect(resolveSkillsPaths({})).toEqual({ paths: ['/app/skills'] });
  });

  test('returns undefined when no skills dir exists', () => {
    const env = { CLAUDE_CONFIG_DIR: path.join(tmp, 'missing') };
    expect(resolveSkillsPaths(env)).toBeUndefined();
  });
});
