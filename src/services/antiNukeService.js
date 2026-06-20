const { AuditLogEvent } = require('discord.js');
const store = require('../config/store');
const { logSecurity } = require('../utils/logs');
const { isSecurityWhitelisted } = require('../utils/permissions');

const actionBuckets = new Map();

function bucketKey(guildId, executorId, actionType) {
  return `${guildId}:${executorId}:${actionType}`;
}

function recordAction(guildId, executorId, actionType) {
  const config = store.getGuild(guildId);
  const windowMs = config.security?.nukeWindowMs || 60000;
  const key = bucketKey(guildId, executorId, actionType);
  const now = Date.now();

  let bucket = actionBuckets.get(key);
  if (!bucket || now - bucket.start > windowMs) {
    bucket = { start: now, count: 0 };
  }
  bucket.count++;
  actionBuckets.set(key, bucket);
  return bucket.count;
}

async function handleAuditEntry(entry, guild) {
  const config = store.getGuild(guild.id);
  if (!config.security?.antiNukeEnabled) return;

  const executorId = entry.executorId;
  if (!executorId) return;

  const member = await guild.members.fetch(executorId).catch(() => null);
  if (member && isSecurityWhitelisted(member)) return;

  const dangerous = [
    AuditLogEvent.ChannelDelete,
    AuditLogEvent.RoleDelete,
    AuditLogEvent.MemberBanAdd,
    AuditLogEvent.MemberKick,
    AuditLogEvent.WebhookCreate,
    AuditLogEvent.GuildUpdate,
  ];

  if (!dangerous.includes(entry.action)) return;

  const count = recordAction(guild.id, executorId, entry.action);
  const threshold = config.security?.nukeThreshold || 3;

  if (count >= threshold) {
    const actionName = AuditLogEvent[entry.action] || String(entry.action);
    await logSecurity(
      guild,
      [
        `**Possible nuke detected**`,
        `**User:** <@${executorId}> (\`${executorId}\`)`,
        `**Action:** ${actionName}`,
        `**Count:** ${count} in ${(config.security?.nukeWindowMs || 60000) / 1000}s window`,
        `**Target:** ${entry.targetId ? `\`${entry.targetId}\`` : 'N/A'}`,
        '',
        '_Review immediately. Whitelisted staff/owner are exempt._',
      ].join('\n')
    );

    if (member?.moderatable) {
      await member.roles.set([], 'Anti-nuke: suspicious mass action').catch(() => null);
    }
  }
}

module.exports = { handleAuditEntry };
