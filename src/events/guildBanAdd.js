const { logModeration } = require('../utils/logs');

module.exports = {
  name: 'guildBanAdd',
  async execute(ban, client) {
    const guild = ban?.guild;
    const user = ban?.user;
    if (!guild || !user) return;
    await logModeration(guild, `Banned: <@${user.id}> (${user.tag})`).catch(() => null);
  },
};

