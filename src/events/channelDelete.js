const { logChannel } = require('../utils/logs');

module.exports = {
  name: 'channelDelete',
  async execute(channel, client) {
    const guild = channel?.guild;
    if (!guild) return;
    await logChannel(guild, `Channel deleted: <#${channel.id}> (\`${channel.name}\`)`).catch(() => null);
  },
};

