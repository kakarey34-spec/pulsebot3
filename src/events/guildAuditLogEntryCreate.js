const antiNukeService = require('../services/antiNukeService');

module.exports = {
  name: 'guildAuditLogEntryCreate',
  // Discord.js emits (auditLogEntry, guild); eventHandler appends client as the 3rd arg.
  async execute(entry, guild, client) {
    if (!guild?.id) return;
    try {
      await antiNukeService.handleAuditEntry(entry, guild);
    } catch (err) {
      console.warn('antiNuke audit entry handler failed:', err?.message || err);
    }
  },
};

