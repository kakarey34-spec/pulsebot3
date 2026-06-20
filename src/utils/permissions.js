const store = require('../config/store');

const LEVELS = {
  everyone: 0,
  seller: 1,
  staff: 2,
  admin: 3,
  owner: 4,
};

function memberHasRole(member, roleIds) {
  if (!roleIds?.length) return false;
  return roleIds.some((id) => member.roles.cache.has(id));
}

function isWhitelistedUser(guildId, userId) {
  const config = store.getGuild(guildId);
  return (config.whitelist?.userIds || []).includes(userId);
}

function getPermissionLevel(member) {
  if (!member) return LEVELS.everyone;
  if (member.guild.ownerId === member.id) return LEVELS.owner;

  const config = store.getGuild(member.guild.id);

  if (isWhitelistedUser(member.guild.id, member.id)) return LEVELS.admin;
  if (memberHasRole(member, config.whitelist.configRoleIds)) return LEVELS.admin;
  if (memberHasRole(member, [config.roles.ownerRoleId])) return LEVELS.owner;
  if (memberHasRole(member, config.whitelist.adminRoleIds)) return LEVELS.admin;
  if (
    memberHasRole(member, [config.roles.modRoleId]) ||
    memberHasRole(member, config.whitelist.staffRoleIds) ||
    memberHasRole(member, config.roles.staffRoleIds)
  ) {
    return LEVELS.staff;
  }
  if (memberHasRole(member, [config.roles.sellerRoleId])) return LEVELS.seller;
  return LEVELS.everyone;
}

function canUse(member, requiredLevel) {
  return getPermissionLevel(member) >= requiredLevel;
}

function hasPurchaserRole(member) {
  if (!member) return false;
  const config = store.getGuild(member.guild.id);
  const roleId = config.roles.purchaserRoleId;
  return roleId ? member.roles.cache.has(roleId) : false;
}

function isSecurityWhitelisted(member) {
  if (!member) return false;
  const config = store.getGuild(member.guild.id);
  if (member.guild.ownerId === member.id) return true;
  if ((config.security?.whitelistedUserIds || []).includes(member.id)) return true;
  return getPermissionLevel(member) >= LEVELS.staff;
}

function denyPurchaserInteraction(interaction) {
  const payload = {
    content: 'You need the **buyer** role to leave a review. Complete a purchase first.',
    ephemeral: true,
  };
  if (interaction.replied || interaction.deferred) {
    return interaction.editReply(payload);
  }
  return interaction.reply(payload);
}

function denyInteraction(interaction, levelName = 'authorized staff') {
  const payload = {
    content: `You do not have permission. This requires **${levelName}** access.`,
    ephemeral: true,
  };
  if (interaction.replied || interaction.deferred) {
    return interaction.editReply(payload);
  }
  return interaction.reply(payload);
}

module.exports = {
  LEVELS,
  getPermissionLevel,
  canUse,
  hasPurchaserRole,
  isSecurityWhitelisted,
  denyPurchaserInteraction,
  denyInteraction,
  memberHasRole,
  isWhitelistedUser,
};
