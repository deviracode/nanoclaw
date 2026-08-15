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
 */
import type Database from 'better-sqlite3';

import { log } from './log.js';
import { DEFAULT_WELCOME, sendWelcomeViaCliSocket, wireDmAgent } from './modules/bootstrap/wire-dm-agent.js';
import type { WireDmAgentResult } from './modules/bootstrap/wire-dm-agent.js';

export interface BootstrapChannel {
  channel: string;
  platformId: string;
}

export interface BootstrapOpts {
  /** The opened central DB — used only to check "any users exist". */
  db: unknown;
  /** "channel:handle" or comma-separated list of them. */
  ownerId: string;
  displayName?: string;
  agentName?: string;
  channels: BootstrapChannel[];
  provider?: string | null;
  welcome?: string;
}

export async function runBootstrap(opts: BootstrapOpts): Promise<boolean> {
  const count = (opts.db as Database.Database).prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number };
  if (count.c > 0) return false;

  let first: { result: WireDmAgentResult; displayName: string } | undefined;
  for (const entry of opts.ownerId
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean)) {
    const channel = entry.split(':')[0];
    const match = opts.channels.find((c) => c.channel === channel);
    const displayName = opts.displayName?.trim() || entry;
    const result = wireDmAgent({
      channel,
      userId: entry,
      platformId: match ? match.platformId : entry,
      displayName,
      agentName: opts.agentName,
      role: 'owner',
      provider: opts.provider,
    });
    if (!first) first = { result, displayName };
  }

  // Welcome goes through the CLI socket (in-process, it is listening since
  // initChannelAdapters). Non-fatal: at first boot the socket may not be up
  // yet, and the agent can still be reached directly by the operator.
  if (first) {
    const welcome = opts.welcome?.trim() || DEFAULT_WELCOME;
    try {
      await sendWelcomeViaCliSocket(first.result.messagingGroup, welcome, {
        senderId: first.result.userId,
        sender: first.displayName,
      });
    } catch (err) {
      log.warn('Bootstrap welcome send failed — continuing without it', { err });
    }
  }
  return true;
}
