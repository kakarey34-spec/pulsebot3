const store = require('../config/store');
const ticketManager = require('./ticketManager');

const { STAGES } = ticketManager;

const INACTIVE_STAGES = new Set([
  STAGES.SELECT_PAYMENT,
  STAGES.AWAITING_PAYMENT,
  STAGES.AWAITING_PROOF,
]);

async function processInactiveTickets(client) {
  for (const guild of client.guilds.cache.values()) {
    const config = store.getGuild(guild.id);
    const hours = config.tickets.inactiveCloseHours;
    if (!hours || hours <= 0) continue;

    const maxIdle = hours * 60 * 60 * 1000;
    const tickets = store.listTicketsForGuild(guild.id);

    for (const ticket of tickets) {
      if (!INACTIVE_STAGES.has(ticket.stage)) continue;

      const channel =
        guild.channels.cache.get(ticket.channelId) ||
        (await guild.channels.fetch(ticket.channelId).catch(() => null));
      if (!channel) {
        store.deleteTicket(ticket.channelId);
        continue;
      }

      const last = ticket.lastActivityAt || ticket.createdAt || 0;
      if (Date.now() - last < maxIdle) continue;

      const { buildSimpleV2 } = require('../utils/display');
      await channel.send(buildSimpleV2(
        'Ticket closed automatically',
        'No activity for the configured period. Open a new ticket from the panel if you still need help.',
      )).catch(() => null);

      await ticketManager.closeTicket(channel, { id: 'system', tag: 'Pulse (inactivity)' }, client);
    }
  }
}

function startSchedulers(client) {
  const run = async () => {
    try {
      await processInactiveTickets(client);
    } catch (err) {
      console.error('Scheduler error:', err);
    }
  };

  run();
  setInterval(run, 15 * 60 * 1000);
}

module.exports = { startSchedulers, processInactiveTickets };
