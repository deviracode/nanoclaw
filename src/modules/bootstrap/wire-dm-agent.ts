/**
 * DM-agent wiring — the DB-adjacent half of scripts/init-first-agent.ts,
 * extracted so the Railway host runtime can provision the first agent from
 * env vars at startup (src/bootstrap.ts) without a local shell.
 *
 * Wires a real DM channel (discord, telegram, etc.) to a (reused) agent
 * group: user upsert, owner/admin role grant, agent group + filesystem,
 * DM messaging group with unknown-sender policy, wiring.
 *
 * Welcome delivery is NOT part of wireDmAgent — callers hand the welcome to
 * the running service via sendWelcomeViaCliSocket themselves.
 */
import net from 'net';
import path from 'path';

// Registration-only barrel import: channel modules call
// registerChannelAdapter() at module scope (factories are NOT invoked, no
// adapter connects — no Gateway conflict with the running service), so
// declared channel defaults resolve here without live adapters.
import '../../channels/index.js';
import { resolveUnknownSenderPolicy, resolveWiringDefaults } from '../../channels/channel-defaults.js';
import { hasDeclaredChannelDefaults } from '../../channels/channel-registry.js';
import { DATA_DIR, GROUPS_DIR } from '../../config.js';
import { createAgentGroup, getAgentGroupByFolder } from '../../db/agent-groups.js';
import { ensureContainerConfig, updateContainerConfigScalars } from '../../db/container-configs.js';
import {
  createMessagingGroup,
  createMessagingGroupAgent,
  getMessagingGroupAgentByPair,
  getMessagingGroupByPlatform,
} from '../../db/messaging-groups.js';
import { stageGroupPersona } from '../../group-persona.js';
import { normalizeName } from '../agent-to-agent/db/agent-destinations.js';
import { addMember } from '../permissions/db/agent-group-members.js';
import { getUserRoles, grantRole } from '../permissions/db/user-roles.js';
import { upsertUser } from '../permissions/db/users.js';
import { namespacedPlatformId } from '../../platform-id.js';
import type { AgentGroup, MessagingGroup } from '../../types.js';

export type Role = 'owner' | 'admin' | 'member';

export const DEFAULT_ROLE: Role = 'owner';

export const DEFAULT_WELCOME =
  'System instruction: run /welcome to introduce yourself to the user on this new channel.';

export interface WireDmAgentOpts {
  channel: string;
  /** Raw handle (namespacing applied inside). */
  userId: string;
  platformId: string;
  displayName: string;
  agentName?: string;
  role?: 'owner' | 'admin' | 'member';
  engagePattern?: string;
  provider?: string | null;
}

export interface WireDmAgentResult {
  userId: string;
  agentGroup: AgentGroup;
  messagingGroup: MessagingGroup;
  folder: string;
}

function namespacedUserId(channel: string, raw: string): string {
  return raw.includes(':') ? raw : `${channel}:${raw}`;
}

function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function wireIfMissing(mg: MessagingGroup, ag: AgentGroup, now: string, label: string, engagePattern?: string): void {
  const existing = getMessagingGroupAgentByPair(mg.id, ag.id);
  if (existing) {
    console.log(`Wiring already exists: ${existing.id} (${label})`);
    return;
  }
  // Engage defaults, first hit wins: explicit --engage-pattern → the
  // channel's declared defaults → the legacy heuristic for stale
  // (undeclared) adapters: DMs (is_group=0) respond to everything via a '.'
  // regex, group chats are mention-only; admins can reconfigure via
  // /manage-channels once the agent is in use.
  const isGroup = mg.is_group === 1;
  const channelKey = mg.instance ?? mg.channel_type;
  const engage = engagePattern
    ? { engage_mode: 'pattern' as const, engage_pattern: engagePattern }
    : hasDeclaredChannelDefaults(channelKey, mg.channel_type)
      ? resolveWiringDefaults(channelKey, isGroup, ag.name, mg.channel_type)
      : isGroup
        ? { engage_mode: 'mention' as const, engage_pattern: null }
        : { engage_mode: 'pattern' as const, engage_pattern: '.' };
  createMessagingGroupAgent({
    id: generateId('mga'),
    messaging_group_id: mg.id,
    agent_group_id: ag.id,
    engage_mode: engage.engage_mode,
    engage_pattern: engage.engage_pattern,
    // Deliberate owner-bootstrap choices, not channel defaults: the operator
    // wires their own DM, so every sender is trusted ('all') and ignored
    // messages carry no value ('drop').
    sender_scope: 'all',
    ignored_message_policy: 'drop',
    session_mode: 'shared',
    priority: 0,
    created_at: now,
  });
  console.log(`Wired ${label}: ${mg.id} -> ${ag.id}`);
}

export function wireDmAgent(opts: WireDmAgentOpts): WireDmAgentResult {
  const now = new Date().toISOString();
  const role = opts.role ?? DEFAULT_ROLE;
  const agentName = opts.agentName?.trim() || opts.displayName;

  // 1. User + (conditional) owner grant.
  const userId = namespacedUserId(opts.channel, opts.userId);
  upsertUser({
    id: userId,
    kind: opts.channel,
    display_name: opts.displayName,
    created_at: now,
  });

  // Owner grant is deferred until after the agent group is resolved, since
  // an admin grant is scoped to that group. See step 2b.

  // 2. Agent group + filesystem.
  const folder = `dm-with-${normalizeName(opts.displayName)}`;
  const pickedProvider = (process.env.NANOCLAW_PICKED_PROVIDER ?? opts.provider)?.trim().toLowerCase();
  let ag: AgentGroup | undefined = getAgentGroupByFolder(folder);
  if (!ag) {
    const agId = generateId('ag');
    createAgentGroup({
      id: agId,
      name: agentName,
      folder,
      agent_provider: null,
      created_at: now,
    });
    ag = getAgentGroupByFolder(folder)!;
    console.log(`Created agent group: ${ag.id} (${folder})`);
  } else {
    console.log(`Reusing agent group: ${ag.id} (${folder})`);
  }
  // Seed the config row, stamped with the effective provider: the operator's
  // setup pick (NANOCLAW_PICKED_PROVIDER) when this runs inside a setup run,
  // otherwise the persisted instance default. Workspace scaffolding is deferred
  // to the first spawn (group-init). A reused group keeps its provider
  // (INSERT OR IGNORE).
  ensureContainerConfig(ag.id, pickedProvider);
  stageGroupPersona(
    path.resolve(GROUPS_DIR, folder),
    `# ${agentName}\n\n` +
      `You are ${agentName}, a personal NanoClaw agent for ${opts.displayName}. ` +
      'When the user first reaches out (or you receive a system welcome prompt), introduce yourself briefly and invite them to chat. Keep replies concise.',
  );

  // 2b. Assign the user a role for this agent group. The caller picks via
  // --role; the channel drivers default to 'owner' for the self-host case.
  //  - owner:  global owner (agent_group_id=null). Cross-channel access.
  //  - admin:  scoped admin for this agent group only.
  //  - member: no role grant, just the membership row below.
  // grantRole inserts a new row per call — idempotence check against
  // getUserRoles prevents duplicates on re-runs.
  const existingRoles = getUserRoles(userId);
  if (role === 'owner') {
    const alreadyOwner = existingRoles.some((r) => r.role === 'owner' && r.agent_group_id === null);
    if (!alreadyOwner) {
      grantRole({
        user_id: userId,
        role: 'owner',
        agent_group_id: null,
        granted_by: null,
        granted_at: now,
      });
    }
    // Owner's agent group gets global CLI access
    updateContainerConfigScalars(ag.id, { cli_scope: 'global' });
  } else if (role === 'admin') {
    const alreadyAdmin = existingRoles.some((r) => r.role === 'admin' && r.agent_group_id === ag.id);
    if (!alreadyAdmin) {
      grantRole({
        user_id: userId,
        role: 'admin',
        agent_group_id: ag.id,
        granted_by: null,
        granted_at: now,
      });
    }
  }

  // Always add a membership row so the access gate has a straightforward
  // yes/no even for users without a role grant. INSERT OR IGNORE, so this
  // is a no-op when the row already exists (e.g. re-runs, owners whose
  // access already passes via role).
  addMember({
    user_id: userId,
    agent_group_id: ag.id,
    added_by: null,
    added_at: now,
  });

  // 3. DM messaging group.
  const platformId = namespacedPlatformId(opts.channel, opts.platformId);
  let dmMg = getMessagingGroupByPlatform(opts.channel, platformId);
  if (!dmMg) {
    const mgId = generateId('mg');
    // Policy from the channel declaration (DM context); legacy 'strict' for
    // stale (undeclared) adapters so a trunk update alone changes nothing.
    const unknownSenderPolicy = hasDeclaredChannelDefaults(opts.channel)
      ? resolveUnknownSenderPolicy(opts.channel, false)
      : 'strict';
    createMessagingGroup({
      id: mgId,
      channel_type: opts.channel,
      platform_id: platformId,
      name: opts.displayName,
      is_group: 0,
      unknown_sender_policy: unknownSenderPolicy,
      created_at: now,
    });
    dmMg = getMessagingGroupByPlatform(opts.channel, platformId)!;
    console.log(`Created messaging group: ${dmMg.id} (${platformId})`);
  } else {
    console.log(`Reusing messaging group: ${dmMg.id} (${platformId})`);
  }

  // 4. Wire DM messaging group to the agent.
  wireIfMissing(dmMg, ag, now, 'dm', opts.engagePattern);

  return { userId, agentGroup: ag, messagingGroup: dmMg, folder };
}

/**
 * Hand the welcome to the running service via its CLI Unix socket. The
 * service's CLI adapter receives `{text, to}`, builds an InboundEvent
 * targeting the DM messaging group, and calls routeInbound(). Router writes
 * the message into inbound.db and wakes the container synchronously.
 *
 * Throws if the socket isn't reachable — callers decide whether that's fatal.
 */
export async function sendWelcomeViaCliSocket(
  dmMg: MessagingGroup,
  welcome: string,
  identity: { senderId: string; sender: string },
): Promise<void> {
  const sockPath = path.join(DATA_DIR, 'cli.sock');

  await new Promise<void>((resolve, reject) => {
    const socket = net.connect(sockPath);
    let settled = false;

    const settle = (err: Error | null) => {
      if (settled) return;
      settled = true;
      try {
        socket.end();
      } catch {
        /* noop */
      }
      if (err) reject(err);
      else resolve();
    };

    socket.once('error', (err) =>
      settle(new Error(`CLI socket at ${sockPath} not reachable: ${err.message}. Is the NanoClaw service running?`)),
    );
    socket.once('connect', () => {
      const payload =
        JSON.stringify({
          text: welcome,
          senderId: identity.senderId,
          sender: identity.sender,
          to: {
            channelType: dmMg.channel_type,
            platformId: dmMg.platform_id,
            threadId: dmMg.platform_id,
          },
        }) + '\n';
      socket.write(payload, (err) => {
        if (err) {
          settle(err);
          return;
        }
        // Brief flush delay so the router picks up the line before we close.
        // Router handles it synchronously once read, so 50ms is plenty.
        setTimeout(() => settle(null), 50);
      });
    });
  });
}
