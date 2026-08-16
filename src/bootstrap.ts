/**
 * First-run provisioning for the Railway host runtime.
 *
 * There is no local shell on Railway to run
 * `pnpm exec tsx scripts/init-first-agent.ts`, so the host provisions the
 * first agent from env vars at startup (gated on NANOCLAW_BOOTSTRAP=1).
 *
 * Semantics: no-op (returns false) once any user exists — the install is
 * already provisioned. Otherwise wires one agent group per `channel:handle`
 * in NANOCLAW_OWNER_ID, resolving each channel's platform id from the
 * provided channels list (falling back to the entry itself), and hands the
 * welcome DM to the running service via the CLI socket (non-fatal on
 * failure — the socket may not be up yet at first boot).
 *
 * Empty or malformed ownerId entries are skipped with a warning and never
 * report success — a no-shell deploy must not log "seeded" while nothing
 * was wired.
 */
import type { Database } from 'better-sqlite3';

import { log } from './log.js';
import { DEFAULT_WELCOME, sendWelcomeViaCliSocket, wireDmAgent } from './modules/bootstrap/wire-dm-agent.js';
import type { WireDmAgentResult } from './modules/bootstrap/wire-dm-agent.js';

export interface BootstrapChannel {
  channel: string;
  /** Optional explicit platform id; empty/missing falls back to the ownerId entry. */
  platformId?: string;
}

export interface BootstrapOpts {
  /** The opened central DB — used only to check "any users exist". */
  db: Database;
  /** "channel:handle" or comma-separated list of them. */
  ownerId: string;
  displayName?: string;
  agentName?: string;
  channels: BootstrapChannel[];
  provider?: string | null;
  welcome?: string;
}

export async function runBootstrap(opts: BootstrapOpts): Promise<boolean> {
  const count = opts.db.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number };
  if (count.c > 0) return false;

  const entries = opts.ownerId
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean);
  if (entries.length === 0) {
    log.warn('Bootstrap: NANOCLAW_OWNER_ID empty — skipping provisioning');
    return false;
  }

  let first: { result: WireDmAgentResult; displayName: string } | undefined;
  for (const entry of entries) {
    const sep = entry.indexOf(':');
    const channel = sep > 0 ? entry.slice(0, sep) : '';
    const handle = sep >= 0 ? entry.slice(sep + 1) : '';
    if (!channel || !handle) {
      log.warn('Bootstrap: skipping malformed ownerId entry (expected channel:handle)', { entry });
      continue;
    }
    if (opts.channels.length > 0 && !opts.channels.some((c) => c.channel === channel)) {
      log.warn('Bootstrap: skipping ownerId entry — channel not in NANOCLAW_BOOTSTRAP_CHANNELS', { channel });
      continue;
    }
    const match = opts.channels.find((c) => c.channel === channel);
    const displayName = opts.displayName?.trim() || handle;
    // The explicit per-channel platformId is only used when it is a real
    // value (non-empty, contains ':') — an empty/placeholder entry (e.g.
    // from bootstrap channels without a handle) falls back to the
    // channel:handle entry itself.
    const explicitPlatformId = match?.platformId;
    const platformId = explicitPlatformId && explicitPlatformId.includes(':') ? explicitPlatformId : entry;
    const result = wireDmAgent({
      channel,
      userId: entry,
      platformId,
      displayName,
      agentName: opts.agentName,
      role: 'owner',
      provider: opts.provider,
    });
    if (!first) first = { result, displayName };
  }

  // Nothing was wired (all entries skipped) — must not report success.
  if (!first) return false;

  // Welcome goes through the CLI socket (in-process, it is listening since
  // initChannelAdapters). Non-fatal: at first boot the socket may not be up
  // yet, and the agent can still be reached directly by the operator.
  const welcome = opts.welcome?.trim() || DEFAULT_WELCOME;
  try {
    await sendWelcomeViaCliSocket(first.result.messagingGroup, welcome, {
      senderId: first.result.userId,
      sender: first.displayName,
    });
  } catch (err) {
    log.warn('Bootstrap welcome send failed — continuing without it', { err });
  }
  return true;
}
