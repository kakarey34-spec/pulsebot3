const antiNukeService = require('../services/antiNukeService');

module.exports = {
  name: 'guildAuditLogEntryCreate',
  async execute(entry, client) {
    const guild = entry?.guild || client.guilds.cache.get(entry?.guildId) || entry?.guild;
    if (!guild) return;
    try {
      await antiNukeService.handleAuditEntry(entry, guild);
    } catch (err) {
      console.warn('antiNuke audit entry handler failed:', err?.message || err);
    }
  },
};

