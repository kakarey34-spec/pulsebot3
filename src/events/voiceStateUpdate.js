const { logVoice } = require('../utils/logs');

module.exports = {
  name: 'voiceStateUpdate',
  async execute(oldState, newState, client) {
    const guild = newState.guild || oldState.guild;
    if (!guild) return;

    const user = newState.member?.user || oldState.member?.user;
    if (!user) return;

    const oldChannel = oldState.channelId ? `<#${oldState.channelId}>` : null;
    const newChannel = newState.channelId ? `<#${newState.channelId}>` : null;

    if (!oldState.channelId && newState.channelId) {
      return logVoice(guild, `Joined voice: <@${user.id}> → ${newChannel}`).catch(() => null);
    }
    if (oldState.channelId && !newState.channelId) {
      return logVoice(guild, `Left voice: <@${user.id}> ← ${oldChannel}`).catch(() => null);
    }

    if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
      return logVoice(
        guild,
        `Moved voice: <@${user.id}> ${oldChannel} → ${newChannel}`
      ).catch(() => null);
    }
  },
};

