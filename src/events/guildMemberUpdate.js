const { logRole, logModeration } = require('../utils/logs');

function formatRoles(guild, roleIds) {
  return roleIds.map((id) => {
    const r = guild.roles.cache.get(id);
    return r ? `${r.name} (\`${id}\`)` : `\`${id}\``;
  });
}

module.exports = {
  name: 'guildMemberUpdate',
  async execute(oldMember, newMember, client) {
    if (!oldMember?.guild || !newMember?.guild) return;
    const guild = newMember.guild;

    // Role changes (added/removed).
    const oldRoles = new Set(oldMember.roles.cache.keys());
    const newRoles = new Set(newMember.roles.cache.keys());
    oldRoles.delete(guild.roles.everyone.id);
    newRoles.delete(guild.roles.everyone.id);

    const added = [...newRoles].filter((id) => !oldRoles.has(id));
    const removed = [...oldRoles].filter((id) => !newRoles.has(id));

    if (added.length || removed.length) {
      await logRole(
        guild,
        [
          `Member: <@${newMember.id}> (\`${newMember.user.tag}\`)`,
          removed.length ? `Removed roles: ${formatRoles(guild, removed).join(', ')}` : null,
          added.length ? `Added roles: ${formatRoles(guild, added).join(', ')}` : null,
        ]
          .filter(Boolean)
          .join('\n')
      ).catch(() => null);
    }

    // Timeout (communication disabled) changes.
    const oldUntil = oldMember.communicationDisabledUntil;
    const newUntil = newMember.communicationDisabledUntil;
    if (oldUntil?.getTime() !== newUntil?.getTime()) {
      const executorInfo = 'Via Discord moderation (bot owner/operator attribution depends on audit log).';
      if (newUntil) {
        await logModeration(
          guild,
          [
            `Timeout enabled for: <@${newMember.id}> (\`${newMember.user.tag}\`)`,
            `Until: <t:${Math.floor(newUntil.getTime() / 1000)}:F>`,
            executorInfo,
          ].join('\n')
        ).catch(() => null);
      } else {
        await logModeration(
          guild,
          [`Timeout removed for: <@${newMember.id}> (\`${newMember.user.tag}\`)`, executorInfo].join('\n')
        ).catch(() => null);
      }
    }
  },
};

