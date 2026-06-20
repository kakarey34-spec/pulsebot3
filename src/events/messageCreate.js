const store = require('../config/store');
const ticketManager = require('../services/ticketManagerClean');
const antiLinkService = require('../services/antiLinkService');

module.exports = {
  name: 'messageCreate',
  async execute(message, client) {
    if (message.author?.bot || !message.guild) return;

    // Anti-link should run before everything else (it can delete the message).
    try {
      const blocked = await antiLinkService.handleMessage(message);
      if (blocked) return;
    } catch {
      // Never hard-fail message processing.
    }

    const config = store.getGuild(message.guild.id);

    // Suggestion system: add ✅ / ❌ reactions in the configured channel.
    const suggestionChannelId = config.channels?.suggestionChannelId;
    if (suggestionChannelId && message.channelId === suggestionChannelId) {
      await message
        .react('✅')
        .catch(() => null);
      await message
        .react('❌')
        .catch(() => null);
    }

    // Ticket processing.
    if (store.getTicket(message.channel.id)) {
      ticketManager.touchTicketChannelActivity(message.channel.id);

      await ticketManager.handleDoneKeyword(message);
      await ticketManager.handleProductIdMessage(message);
      await ticketManager.handleProofMessage(message);
    }
  },
};

