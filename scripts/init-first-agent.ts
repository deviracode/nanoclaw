/**
 * Init the first (or Nth) NanoClaw v2 agent for a DM channel.
 *
 * Wires a real DM channel (discord, telegram, etc.) to a new agent group,
 * then hands a welcome message to the running service via the CLI socket
 * (admin transport). The service routes that message into the DM session,
 * which wakes the container synchronously — the agent processes the welcome
 * and DMs the operator through the normal delivery path.
 *
 * CLI channel wiring is handled separately by `scripts/init-cli-agent.ts`.
 *
 * DB wiring lives in src/modules/bootstrap/wire-dm-agent.ts (shared with the
 * Railway host-runtime bootstrap, src/bootstrap.ts); this script is the
 * local-shell front end: arg parsing, init, and the welcome hand-off.
 *
 * Runs alongside the service (WAL-mode sqlite + CLI socket IPC) — does NOT
 * initialize channel adapters, so there's no Gateway conflict. Requires
 * the service to be running: the welcome hand-off goes over the CLI socket
 * and fails loudly if the service isn't up.
 *
 * Usage:
 *   pnpm exec tsx scripts/init-first-agent.ts \
 *     --channel discord \
 *     --user-id discord:1470183333427675709 \
 *     --platform-id discord:@me:1491573333382523708 \
 *     --display-name "Gavriel" \
 *     [--agent-name "Andy"] \
 *     [--welcome "System instruction: ..."] \
 *     [--role owner|admin|member] \  # default: owner
 *     [--engage-pattern "."]         # explicit DM engage regex override
 *
 * For direct-addressable channels (telegram, whatsapp, etc.), --platform-id
 * is typically the same as the handle in --user-id, with the channel prefix.
 */
import path from 'path';

import { DATA_DIR } from '../src/config.js';
import { initDb } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrations/index.js';
import {
  DEFAULT_ROLE,
  DEFAULT_WELCOME,
  sendWelcomeViaCliSocket,
  wireDmAgent,
} from '../src/modules/bootstrap/wire-dm-agent.js';
import type { Role } from '../src/modules/bootstrap/wire-dm-agent.js';

interface Args {
  channel: string;
  userId: string;
  platformId: string;
  displayName: string;
  agentName: string;
  welcome: string;
  role: Role;
  /** Explicit engage regex for the DM wiring; omitted = channel declaration / '.'. */
  engagePattern?: string;
}

function parseArgs(argv: string[]): Args {
  const out: Partial<Args> = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    const val = argv[i + 1];
    switch (key) {
      case '--channel':
        out.channel = (val ?? '').toLowerCase();
        i++;
        break;
      case '--user-id':
        out.userId = val;
        i++;
        break;
      case '--platform-id':
        out.platformId = val;
        i++;
        break;
      case '--display-name':
        out.displayName = val;
        i++;
        break;
      case '--agent-name':
        out.agentName = val;
        i++;
        break;
      case '--welcome':
        out.welcome = val;
        i++;
        break;
      case '--engage-pattern':
        out.engagePattern = val;
        i++;
        break;
      case '--role': {
        const raw = (val ?? '').toLowerCase();
        if (raw !== 'owner' && raw !== 'admin' && raw !== 'member') {
          console.error(`Invalid --role: ${raw} (expected 'owner', 'admin', or 'member')`);
          process.exit(2);
        }
        out.role = raw;
        i++;
        break;
      }
    }
  }

  const required: (keyof Args)[] = ['channel', 'userId', 'platformId', 'displayName'];
  const missing = required.filter((k) => !out[k]);
  if (missing.length) {
    console.error(
      `Missing required args: ${missing.map((k) => `--${k.replace(/([A-Z])/g, '-$1').toLowerCase()}`).join(', ')}`,
    );
    console.error('See scripts/init-first-agent.ts header for usage.');
    process.exit(2);
  }

  return {
    channel: out.channel!,
    userId: out.userId!,
    platformId: out.platformId!,
    displayName: out.displayName!,
    agentName: out.agentName?.trim() || out.displayName!,
    welcome: out.welcome?.trim() || DEFAULT_WELCOME,
    role: out.role ?? DEFAULT_ROLE,
    engagePattern: out.engagePattern?.trim() || undefined,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const db = initDb(path.join(DATA_DIR, 'v2.db'));
  runMigrations(db); // idempotent

  const result = wireDmAgent({
    channel: args.channel,
    userId: args.userId,
    platformId: args.platformId,
    displayName: args.displayName,
    agentName: args.agentName,
    role: args.role,
    engagePattern: args.engagePattern,
  });

  // Welcome delivery over the CLI socket. Router picks up the line,
  // writes the message into the DM session's inbound.db, and wakes the
  // container synchronously — no sweep wait. The paired user's identity is
  // passed so the sender resolver sees the real owner, not cli:local.
  await sendWelcomeViaCliSocket(result.messagingGroup, args.welcome, {
    senderId: result.userId,
    sender: args.displayName,
  });

  const roleLabel =
    args.role === 'owner'
      ? 'owner (global)'
      : args.role === 'admin'
        ? `admin (scoped to ${result.agentGroup.id})`
        : 'member';

  console.log('');
  console.log('Init complete.');
  console.log(`  user:    ${result.userId}`);
  console.log(`  role:    ${roleLabel}`);
  console.log(`  agent:   ${result.agentGroup.name} [${result.agentGroup.id}] @ groups/${result.folder}`);
  console.log(`  channel: ${args.channel} ${result.messagingGroup.platform_id}`);
  console.log('');
  console.log('Welcome DM queued — the agent will greet you shortly.');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
