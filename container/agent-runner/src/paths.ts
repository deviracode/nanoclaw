/**
 * Runtime roots for the agent-runner. In the Docker runtime these are fixed
 * mount paths; in host runtime (Railway) the host passes each per-session
 * path via env. Defaults match the docker layout exactly.
 */
import path from 'path';

export const WORKSPACE_DIR = process.env.WORKSPACE_DIR || '/workspace';
export const AGENT_DIR = process.env.AGENT_DIR || path.join(WORKSPACE_DIR, 'agent');
export const SRC_DIR = process.env.SRC_DIR || '/app/src';
export const SKILLS_DIR = process.env.SKILLS_DIR || '/app/skills';
