const { logMember } = require('../utils/logs');

module.exports = {
  name: 'guildMemberAdd',
  async execute(member, client) {
    if (!member?.guild) return;
    await logMember(member.guild, `Joined: <@${member.id}> (${member.user.tag})`).catch(() => null);
  },
};

