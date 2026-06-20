const store = require('../config/store');
const { buildTicketPanelPayload } = require('../utils/ticketPanel');
const { buildTicketWelcome } = require('../utils/ticketUi');

async function refreshPanelCounters(client, guildId) {
  const config = store.getGuild(guildId);
  const channelId = config.tickets?.panelChannelId;
  const messageId = config.tickets?.panelMessageId;
  if (!channelId || !messageId) return;

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return;

  const message = await channel.messages.fetch(messageId).catch(() => null);
  if (!message) return;

  const payload = buildTicketPanelPayload(guildId);
  await message.edit(payload).catch((err) => {
    console.warn('Panel counter refresh failed:', err.message);
  });
}

async function refreshOpenTicketCounters(client, guildId) {
  const tickets = store.listTicketsForGuild(guildId).filter((t) => t.stage !== 'closed');
  if (!tickets.length) return;

  for (const ticket of tickets) {
    if (!ticket.counterMessageId) continue;

    const channel = await client.channels.fetch(ticket.channelId).catch(() => null);
    if (!channel?.isTextBased()) continue;

    const message = await channel.messages.fetch(ticket.counterMessageId).catch(() => null);
    if (!message) continue;

    const product = ticket.productId ? store.getProduct(guildId, ticket.productId) : null;
    const payload = buildTicketWelcome(guildId, ticket.category, ticket.userId, {
      stage: ticket.stage,
      product,
    });

    await message.edit(payload).catch(() => null);
  }
}

async function refreshAllCounters(client, guildId) {
  await refreshPanelCounters(client, guildId);
  await refreshOpenTicketCounters(client, guildId);
}

function scheduleCounterRefresh(client, guildId) {
  setImmediate(() => {
    refreshAllCounters(client, guildId).catch(() => null);
  });
}

module.exports = { refreshAllCounters, scheduleCounterRefresh };
