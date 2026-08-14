import { describe, expect, test } from 'bun:test';
import { AGENT_DIR, SKILLS_DIR, SRC_DIR, WORKSPACE_DIR } from './paths';

describe('paths', () => {
  test('defaults to docker layout when env is unset', () => {
    expect(WORKSPACE_DIR).toBe('/workspace');
    expect(AGENT_DIR).toBe('/workspace/agent');
    expect(SRC_DIR).toBe('/app/src');
    expect(SKILLS_DIR).toBe('/app/skills');
  });
});
