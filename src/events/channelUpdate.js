const { logChannel } = require('../utils/logs');

module.exports = {
  name: 'channelUpdate',
  async execute(oldChannel, newChannel, client) {
    if (!newChannel?.guild) return;
    if (oldChannel?.name === newChannel.name && oldChannel?.topic === newChannel.topic) return;

    const changes = [];
    if (oldChannel?.name !== newChannel?.name) changes.push(`Name: \`${oldChannel.name}\` → \`${newChannel.name}\``);
    if (oldChannel?.topic !== newChannel?.topic) changes.push(`Topic changed`);

    if (!changes.length) return;

    await logChannel(newChannel.guild, `Channel updated: <#${newChannel.id}>\n${changes.join('\n')}`).catch(() => null);
  },
};

