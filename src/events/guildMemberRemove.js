const { logMember } = require('../utils/logs');

module.exports = {
  name: 'guildMemberRemove',
  async execute(member, client) {
    if (!member?.guild) return;
    await logMember(member.guild, `Left: <@${member.id}> (${member.user.tag})`).catch(() => null);
  },
};

