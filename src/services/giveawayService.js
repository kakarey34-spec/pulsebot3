const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
} = require('discord.js');
const store = require('../config/store');
const { buildGiveawayV2 } = require('../utils/display');
const { formatDuration } = require('../utils/parseDuration');

const ENTER_PREFIX = 'giveaway_enter:';
const MAX_WINNERS = 20;

function enterButton(messageId, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${ENTER_PREFIX}${messageId}`)
      .setLabel('Enter giveaway')
      .setStyle(ButtonStyle.Success)
      .setEmoji('🎉')
      .setDisabled(disabled)
  );
}

function pickWinners(entrants, count) {
  const pool = [...new Set(entrants)];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, Math.min(count, pool.length));
}

async function refreshGiveawayMessage(client, giveaway) {
  const channel = await client.channels.fetch(giveaway.channelId).catch(() => null);
  if (!channel?.isTextBased()) return;
  const message = await channel.messages.fetch(giveaway.messageId).catch(() => null);
  if (!message) return;

  const ended = giveaway.status === 'ended';
  const payload = buildGiveawayV2(giveaway, { ended });
  const container = payload.components[0];
  if (!ended && container instanceof ContainerBuilder) {
    container.addActionRowComponents(enterButton(giveaway.messageId));
  }

  await message.edit(payload);
}

async function getValidEntrants(guild, giveaway) {
  const valid = [];
  for (const userId of giveaway.entrants || []) {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (member && !member.user.bot) valid.push(userId);
  }
  return valid;
}

async function endGiveaway(client, messageId, { force = false, endedBy = null } = {}) {
  const giveaway = store.getGiveaway(messageId);
  if (!giveaway) return { error: 'Giveaway not found.' };
  if (giveaway.status === 'ended') {
    return { error: 'Giveaway already ended. Use `/giveaway reroll`.' };
  }
  if (!force && Date.now() < giveaway.endsAt) {
    return { error: 'This giveaway is still running.' };
  }

  const guild = await client.guilds.fetch(giveaway.guildId).catch(() => null);
  if (!guild) {
    store.deleteGiveaway(messageId);
    return { error: 'Guild not found.' };
  }

  const validEntrants = await getValidEntrants(guild, giveaway);
  const winnerIds = pickWinners(validEntrants, giveaway.winnerCount);
  giveaway.status = 'ended';
  giveaway.endedAt = Date.now();
  giveaway.winnerIds = winnerIds;
  if (endedBy) giveaway.endedBy = endedBy;
  store.setGiveaway(messageId, giveaway);

  await refreshGiveawayMessage(client, giveaway);

  const channel = await client.channels.fetch(giveaway.channelId).catch(() => null);
  if (channel?.isTextBased()) {
    if (winnerIds.length === 0) {
      await channel.send({ content: `Giveaway **${giveaway.title}** ended with no eligible entries.` }).catch(() => null);
    } else {
      const mentions = winnerIds.map((id) => `<@${id}>`).join(' ');
      await channel.send({
        content: `🎉 Congratulations ${mentions}! You won **${giveaway.prize}** — ${giveaway.title}`,
        allowedMentions: { users: winnerIds },
      }).catch(() => null);
    }
  }

  return { ok: true, winnerIds, giveaway };
}

async function rerollGiveaway(client, messageId, replaceUserId) {
  const giveaway = store.getGiveaway(messageId);
  if (!giveaway) return { error: 'Giveaway not found.' };
  if (giveaway.status !== 'ended') return { error: 'Only ended giveaways can be rerolled.' };

  const guild = await client.guilds.fetch(giveaway.guildId).catch(() => null);
  if (!guild) return { error: 'Guild not found.' };

  const winners = giveaway.winnerIds || [];
  if (!replaceUserId) return { error: 'Specify the invalid winner.' };
  if (!winners.includes(replaceUserId)) return { error: 'That user is not a listed winner.' };

  const pool = (await getValidEntrants(guild, giveaway)).filter(
    (id) => !winners.includes(id) || id === replaceUserId
  );
  const rerollPool = pool.filter((id) => id !== replaceUserId);
  if (!rerollPool.length) return { error: 'No other eligible entrants.' };

  const [newWinner] = pickWinners(rerollPool, 1);
  giveaway.winnerIds = winners.map((id) => (id === replaceUserId ? newWinner : id));
  giveaway.rerolls = [...(giveaway.rerolls || []), { from: replaceUserId, to: newWinner, at: Date.now() }];
  store.setGiveaway(messageId, giveaway);

  await refreshGiveawayMessage(client, giveaway);

  const channel = await client.channels.fetch(giveaway.channelId).catch(() => null);
  if (channel?.isTextBased()) {
    await channel.send({
      content: `🎉 Reroll: <@${newWinner}> won **${giveaway.prize}** (replacing previous winner)`,
      allowedMentions: { users: [newWinner] },
    }).catch(() => null);
  }

  return { ok: true, newWinner, replaced: replaceUserId };
}

async function handleEnter(interaction) {
  const messageId = interaction.customId.slice(ENTER_PREFIX.length);
  const giveaway = store.getGiveaway(messageId);

  if (!giveaway || giveaway.guildId !== interaction.guild.id) {
    return interaction.reply({ content: 'This giveaway is no longer active.', ephemeral: true });
  }
  if (giveaway.status === 'ended' || Date.now() >= giveaway.endsAt) {
    return interaction.reply({ content: 'This giveaway has ended.', ephemeral: true });
  }
  if (interaction.user.bot) {
    return interaction.reply({ content: 'Bots cannot enter.', ephemeral: true });
  }

  const entrants = giveaway.entrants || [];
  if (entrants.includes(interaction.user.id)) {
    return interaction.reply({ content: 'You are already entered.', ephemeral: true });
  }

  giveaway.entrants = [...entrants, interaction.user.id];
  store.setGiveaway(messageId, giveaway);
  await refreshGiveawayMessage(interaction.client, giveaway);

  return interaction.reply({
    content: `Entered **${giveaway.title}**! Prize: **${giveaway.prize}**.`,
    ephemeral: true,
  });
}

async function startGiveaway(interaction, opts) {
  const durationMs = opts.durationMs;
  if (!durationMs || durationMs < 60 * 1000) {
    return { error: 'Duration must be at least 1 minute.' };
  }
  if (durationMs > 365 * 24 * 60 * 60 * 1000) {
    return { error: 'Duration cannot exceed 365 days.' };
  }

  const winnerCount = opts.winnerCount;
  if (winnerCount < 1 || winnerCount > MAX_WINNERS) {
    return { error: `Winner count must be 1–${MAX_WINNERS}.` };
  }

  const channel = opts.channel || interaction.channel;
  if (!channel?.isTextBased()) return { error: 'Choose a text channel.' };

  const endsAt = Date.now() + durationMs;
  const preview = {
    title: opts.title,
    prize: opts.prize,
    description: opts.description || null,
    hostId: interaction.user.id,
    winnerCount,
    endsAt,
    entrants: [],
    status: 'active',
    guildId: interaction.guild.id,
    channelId: channel.id,
    messageId: 'pending',
  };

  const payload = buildGiveawayV2(preview);
  const container = payload.components[0];
  container.addActionRowComponents(enterButton('pending'));

  const message = await channel.send(payload);

  const giveaway = { ...preview, messageId: message.id, createdAt: Date.now() };
  store.setGiveaway(message.id, giveaway);

  const updated = buildGiveawayV2(giveaway);
  updated.components[0].addActionRowComponents(enterButton(message.id));
  await message.edit(updated);

  return { ok: true, message, endsIn: formatDuration(durationMs) };
}

function isEnterButton(customId) {
  return customId.startsWith(ENTER_PREFIX);
}

module.exports = {
  ENTER_PREFIX,
  MAX_WINNERS,
  startGiveaway,
  endGiveaway,
  rerollGiveaway,
  handleEnter,
  isEnterButton,
};
