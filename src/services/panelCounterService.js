const store = require('../config/store');
const { buildTicketPanelPayload } = require('../utils/ticketPanel');

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

function schedulePanelRefresh(client, guildId) {
  setImmediate(() => {
    refreshPanelCounters(client, guildId).catch(() => null);
  });
}

module.exports = { refreshPanelCounters, schedulePanelRefresh };
