const { AttachmentBuilder } = require('discord.js');
const store = require('../config/store');
const { MessageFlags } = require('discord.js');
const { BRAND } = require('./brand');

const V2 = MessageFlags.IsComponentsV2;

async function logTicketClosed(guild, ticket, channel, closedBy, transcript) {
  const config = store.getGuild(guild.id);
  const logChannelId =
    config.tickets.categoryLogChannels?.[ticket?.category] ||
    config.channels?.ticketLogs ||
    config.tickets.logChannelId;

  if (!logChannelId) return;

  const logChannel = await guild.channels.fetch(logChannelId).catch(() => null);
  if (!logChannel?.isTextBased()) return;

  const {
    ContainerBuilder,
    TextDisplayBuilder,
  } = require('discord.js');

  const lines = [
    '## 📋 Ticket Transcript',
    `**Channel:** #${channel.name}`,
    `**Category:** ${ticket?.category || 'unknown'}`,
    `**User:** <@${ticket?.userId || 'unknown'}>`,
    ticket?.productId ? `**Product ID:** \`${ticket.productId}\`` : '',
    `**Closed by:** <@${closedBy?.id || closedBy}>`,
    `**Messages:** ${transcript?.messageCount || 0}`,
  ].filter(Boolean);

  if (transcript?.preview) {
    const snippet = transcript.preview.slice(0, 900);
    lines.push('', '**Preview:**', '```', snippet, transcript.preview.length > 900 ? '…' : '', '```');
  }

  const container = new ContainerBuilder()
    .setAccentColor(BRAND.pulse)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));

  const files = transcript?.attachment ? [transcript.attachment] : [];

  await logChannel.send({
    components: [container],
    flags: V2,
    files,
  });
}

module.exports = { logTicketClosed };
