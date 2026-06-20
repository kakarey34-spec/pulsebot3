const {
  ContainerBuilder,
  MessageFlags,
  TextDisplayBuilder,
} = require('discord.js');
const store = require('../config/store');
const { BRAND } = require('./brand');

const V2 = MessageFlags.IsComponentsV2;

function logContainer(title, body, accent = BRAND.pulse) {
  return new ContainerBuilder()
    .setAccentColor(accent)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`## ${title}\n${body}`)
    );
}

async function sendLog(guild, channelKey, title, body, accent) {
  const config = store.getGuild(guild.id);
  const channelId = config.channels?.[channelKey];
  if (!channelId) return null;

  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return null;

  return channel.send({
    components: [logContainer(title, body, accent)],
    flags: V2,
  });
}

async function logMember(guild, body) {
  return sendLog(guild, 'memberLogs', '👤 Member Log', body, BRAND.accent);
}

async function logChannel(guild, body) {
  return sendLog(guild, 'channelLogs', '📁 Channel Log', body, BRAND.pulse);
}

async function logRole(guild, body) {
  return sendLog(guild, 'roleLogs', '🏷️ Role Log', body, BRAND.pulse);
}

async function logVoice(guild, body) {
  return sendLog(guild, 'voiceLogs', '🔊 Voice Log', body, BRAND.accent);
}

async function logModeration(guild, body) {
  return sendLog(guild, 'moderationLogs', '🛡️ Moderation Log', body, BRAND.danger);
}

async function logAntilink(guild, body) {
  return sendLog(guild, 'antilinkLogs', '🔗 Anti-Link', body, BRAND.warning);
}

async function logSecurity(guild, body) {
  return sendLog(guild, 'securityLogs', '🚨 Security Alert', body, BRAND.danger);
}

async function logCommand(guild, user, commandName) {
  const body = `**User:** <@${user.id}> (\`${user.tag}\`)\n**Command:** \`/${commandName}\`\n**Time:** <t:${Math.floor(Date.now() / 1000)}:F>`;
  return sendLog(guild, 'commandLogs', '⌨️ Command Log', body, BRAND.muted);
}

async function logServer(guild, body) {
  return sendLog(guild, 'serverLogs', '📋 Server Log', body, BRAND.pulse);
}

module.exports = {
  sendLog,
  logMember,
  logChannel,
  logRole,
  logVoice,
  logModeration,
  logAntilink,
  logSecurity,
  logCommand,
  logServer,
};
