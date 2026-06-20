const {
  AttachmentBuilder,
  ChannelType,
  PermissionFlagsBits,
} = require('discord.js');

const store = require('../config/store');
const { getChannelPrefix, formatChannelName } = require('../utils/brand');
const {
  buildTicketWelcome,
  buildPaymentMethodMessage,
  buildProofRequestEmbed,
  buildProofReceivedEmbed,
  buildStaffReviewMessage,
  buildApprovedEmbed,
  buildDeniedEmbed,
  buildClosedEmbed,
  buildPromoAppliedMessage,
} = require('../utils/ticketUi');
const { paymentMethodRow, paymentActionRows, staffApprovalRow } = require('../utils/components');
const { buildTicketMessage } = require('../utils/display');
const promoService = require('./promoService');
const ticketLog = require('../utils/ticketLog');
const { getCategoryById, DEFAULT_CATEGORIES } = require('../utils/ticketPanel');
const { getPermissionLevel, LEVELS } = require('../utils/permissions');
const { parsePrice } = require('../utils/paysafe');
const { scheduleCounterRefresh } = require('./panelCounterService');

const STAGES = {
  AWAITING_PRODUCT: 'awaiting_product',
  SELECT_PAYMENT: 'select_payment',
  AWAITING_PAYMENT: 'awaiting_payment',
  AWAITING_PROOF: 'awaiting_proof',
  AWAITING_APPROVAL: 'awaiting_approval',
  AWAITING_STAFF: 'awaiting_staff',
  APPROVED: 'approved',
  DENIED: 'denied',
  CLOSED: 'closed',
};

const STAFF_CHANNEL_PERMS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.AttachFiles,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.ManageChannels,
];

/** Prevents double ticket channel creation on rapid clicks. */
const ticketCreationLocks = new Set();

function ticketTopicForUser(member, categoryId) {
  const category = getCategoryById(member.guild.id, categoryId);
  const label = category?.label || categoryId;
  return `Pulse ${label} · ${member.user.tag} (${member.id})`;
}

function channelOwnedByUser(channel, userId) {
  return channel.topic?.includes(`(${userId})`);
}

function collectTicketViewers(config) {
  const roleIds = new Set();
  const userIds = new Set();

  for (const lists of [
    config.tickets?.supportRoleIds,
    config.tickets?.viewerRoleIds,
    config.roles?.staffRoleIds,
    config.whitelist?.staffRoleIds,
    config.whitelist?.adminRoleIds,
    [config.roles?.modRoleId, config.roles?.sellerRoleId, config.roles?.ownerRoleId],
  ]) {
    for (const id of lists || []) if (id) roleIds.add(id);
  }

  for (const id of config.tickets?.viewerUserIds || []) if (id) userIds.add(id);
  return { roleIds: [...roleIds], userIds: [...userIds] };
}

/**
 * Discord.js only accepts overwrites for cached Role/Member objects (or IDs that
 * are already in cache). Skip invalid or missing roles so ticket creation never
 * crashes on a bad config ID.
 */
async function buildTicketPermissionOverwrites(guild, ticketOwner, config) {
  const me = guild.members.me ?? (await guild.members.fetchMe().catch(() => null));
  if (!me) {
    throw new Error('Bot member is not available in this guild.');
  }

  const overwrites = [
    { id: guild.roles.everyone, deny: [PermissionFlagsBits.ViewChannel] },
    {
      id: ticketOwner,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    },
    {
      id: me,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ManageChannels,
      ],
    },
  ];

  const { roleIds, userIds } = collectTicketViewers(config);

  for (const roleId of roleIds) {
    const role = guild.roles.cache.get(roleId);
    if (role) overwrites.push({ id: role, allow: STAFF_CHANNEL_PERMS });
  }

  for (const userId of userIds) {
    if (userId === ticketOwner.id) continue;
    let viewer =
      guild.members.cache.get(userId) ?? (await guild.members.fetch(userId).catch(() => null));
    if (viewer) overwrites.push({ id: viewer, allow: STAFF_CHANNEL_PERMS });
  }

  return overwrites;
}

function ticketChannelName(stage, username, categoryId) {
  const prefix = getChannelPrefix(categoryId);
  if (stage === STAGES.AWAITING_APPROVAL) return formatChannelName(prefix, username, 'pending');
  if (stage === STAGES.APPROVED) return formatChannelName(prefix, username, 'complete');
  if (stage === STAGES.DENIED) return formatChannelName(prefix, username, 'declined');
  return formatChannelName(prefix, username);
}

async function syncTicketChannelName(channel, ticket) {
  const member = await channel.guild.members.fetch(ticket.userId).catch(() => null);
  const username = member?.user?.username || 'user';
  const name = ticketChannelName(ticket.stage, username, ticket.category);
  if (channel.name === name) return;
  await channel.setName(name).catch(() => null);
}

function isPaymentCategory(categoryId) {
  return categoryId === 'payments' || DEFAULT_CATEGORIES[categoryId]?.requiresPayment === true;
}

function isTicketBlacklisted(guildId, userId) {
  return (store.getGuild(guildId).blacklist?.ticketUserIds || []).includes(userId);
}

function checkOpenCooldown(guildId, userId) {
  const cooldown = store.getTicketCooldown(guildId, userId);
  if (!cooldown || cooldown.until <= Date.now()) return null;
  const minutes = Math.ceil((cooldown.until - Date.now()) / 60000);
  return `Wait **${minutes} minute(s)** before opening another purchase ticket (${cooldown.reason || 'cooldown'}).`;
}

function applyPurchaseCooldown(guildId, userId, reason) {
  const minutes = store.getGuild(guildId).tickets.openCooldownMinutes ?? 5;
  if (minutes <= 0) return;
  store.setTicketCooldown(guildId, userId, Date.now() + minutes * 60 * 1000, reason);
}

function staffCanActOnClaimedTicket(staffMember, ticket) {
  if (!ticket?.claimedBy) return { ok: true };
  if (ticket.claimedBy === staffMember.id) return { ok: true };
  if (getPermissionLevel(staffMember) >= LEVELS.admin) return { ok: true };
  return { ok: false, error: `Claimed by <@${ticket.claimedBy}>. Only they or an admin can act.` };
}

async function findActiveUserTicket(guild, userId) {
  const open = store.findOpenTicketByUser(guild.id, userId);
  if (open) {
    const ch = guild.channels.cache.get(open.channelId);
    if (ch) return { ticket: open, channel: ch };
    store.deleteTicket(open.channelId);
  }

  // Recovery (best-effort): infer category from channel name prefix and user from topic.
  const config = store.getGuild(guild.id);
  const parentId = config.tickets?.categoryId || null;

  for (const ch of guild.channels.cache.values()) {
    if (ch.type !== ChannelType.GuildText) continue;
    if (parentId && ch.parentId !== parentId) continue;
    if (!channelOwnedByUser(ch, userId)) continue;

    const prefixes = {
      payments: getChannelPrefix('payments'),
      support: getChannelPrefix('support'),
      partner: getChannelPrefix('partner'),
    };

    let category = null;
    if (ch.name.startsWith(`${prefixes.payments}-`) || ch.name.startsWith(`${prefixes.payments}`)) category = 'payments';
    else if (ch.name.startsWith(`${prefixes.support}-`) || ch.name.startsWith(`${prefixes.support}`)) category = 'support';
    else if (ch.name.startsWith(`${prefixes.partner}-`) || ch.name.startsWith(`${prefixes.partner}`)) category = 'partner';
    else continue;

    const stage = category === 'payments' ? STAGES.AWAITING_PRODUCT : STAGES.AWAITING_STAFF;
    const ticket = {
      guildId: guild.id,
      userId,
      channelId: ch.id,
      category,
      productId: null,
      stage,
      paymentMethod: null,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      recovered: true,
    };
    store.setTicket(ch.id, ticket);
    return { ticket, channel: ch };
  }

  return null;
}

async function createTicket(guild, member, categoryId = 'payments', client) {
  const lockKey = `${guild.id}:${member.id}`;
  if (ticketCreationLocks.has(lockKey)) {
    return { error: 'Your ticket is being created. Please wait.' };
  }

  const existing = await findActiveUserTicket(guild, member.id);
  if (existing) return { error: `You already have an open ticket: ${existing.channel}` };

  ticketCreationLocks.add(lockKey);
  try {
    const config = store.getGuild(guild.id);
    const category = getCategoryById(guild.id, categoryId);
    if (!category) return { error: 'Unknown ticket category.' };

    if (category.requiresPayment) {
      if (isTicketBlacklisted(guild.id, member.id)) {
        return { error: 'You are blocked from opening purchase tickets. Contact staff.' };
      }
      const cooldownMsg = checkOpenCooldown(guild.id, member.id);
      if (cooldownMsg) return { error: cooldownMsg };
    }

    const initialStage = category.requiresPayment ? STAGES.AWAITING_PRODUCT : STAGES.AWAITING_STAFF;
    const overwrites = await buildTicketPermissionOverwrites(guild, member, config);

    const channel = await guild.channels.create({
      name: ticketChannelName(initialStage, member.user.username, categoryId),
      type: ChannelType.GuildText,
      parent: config.tickets?.categoryId || undefined,
      permissionOverwrites: overwrites,
      topic: ticketTopicForUser(member, categoryId),
    });

    const ticketData = {
      guildId: guild.id,
      userId: member.id,
      channelId: channel.id,
      category: categoryId,
      productId: null,
      stage: initialStage,
      paymentMethod: null,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      claimedBy: null,
      claimedAt: null,
      approvedBy: null,
      approvedAt: null,
      deniedBy: null,
      denyReason: null,
      staffNote: null,
      staffNoteBy: null,
      staffNoteAt: null,
      counterMessageId: null,
      proofMessageId: null,
      proofAt: null,
      reviewMessageId: null,
    };

    store.setTicket(channel.id, ticketData);

    const welcomePayload = buildTicketWelcome(guild.id, categoryId, member.id, {
      stage: initialStage,
      product: null,
    });
    const welcomeMsg = await channel.send(welcomePayload);
    ticketData.counterMessageId = welcomeMsg.id;
    store.setTicket(channel.id, ticketData);

    scheduleCounterRefresh(client || guild.client, guild.id);
    return { channel, ticketData };
  } finally {
    ticketCreationLocks.delete(lockKey);
  }
}

async function handleProductIdMessage(message) {
  const ticket = store.getTicket(message.channel.id);
  if (!ticket || ticket.stage !== STAGES.AWAITING_PRODUCT) return false;
  if (message.author.id !== ticket.userId) return false;
  if (!message.content) return false;

  const token = message.content.trim().split(/\s+/)[0] || '';
  const productId = token.replace(/[^A-Za-z0-9_-]/g, '').toUpperCase();
  const product = store.getProduct(message.guild.id, productId);

  if (!product) {
    await message.reply({
      content: `Invalid Product ID. Check the shop listing and try again (example: \`PULSE-0001\`).`,
      allowedMentions: { repliedUser: false },
    });
    return true;
  }

  ticket.productId = product.id;
  ticket.stage = STAGES.SELECT_PAYMENT;
  ticket.lastActivityAt = Date.now();
  store.setTicket(message.channel.id, ticket);

  const config = store.getGuild(message.guild.id);
  const enabledMethods = Object.entries(config.payments).filter(([, m]) => m.enabled !== false);

  const choicePayload = buildTicketMessage(
    '◆ Payment methods',
    [`Selected product: **${product.name}**`, `Product ID: \`${product.id}\``, '', 'Choose a payment method:'].join('\n'),
    { accent: config.embeds?.accent || 0x00e5ff }
  );

  const container = choicePayload.components[0];
  for (const row of paymentMethodRow(enabledMethods)) container.addActionRowComponents(row);

  await message.channel.send(choicePayload);
  return true;
}

async function selectPaymentMethod(channel, userId, methodKey) {
  const ticket = store.getTicket(channel.id);
  if (!ticket || ticket.userId !== userId) return { error: 'This ticket does not belong to you.' };
  if (ticket.stage !== STAGES.SELECT_PAYMENT) return { error: 'Select payment method first.' };
  if (!ticket.productId) return { error: 'Product not selected on this ticket.' };

  const config = store.getGuild(channel.guild.id);
  const method = config.payments?.[methodKey];
  if (!method || method.enabled === false) return { error: 'That payment method is not available.' };

  const member = await channel.guild.members.fetch(userId).catch(() => null);
  const product = store.getProduct(channel.guild.id, ticket.productId);
  if (!product) return { error: 'Product not found. Ask staff to refresh your ticket.' };

  const resolved = promoService.resolveTicketPromo(channel.guild.id, ticket, member);
  const promo = resolved.promo || null;

  ticket.paymentMethod = methodKey;
  ticket.stage = STAGES.AWAITING_PAYMENT;
  ticket.lastActivityAt = Date.now();
  store.setTicket(channel.id, ticket);

  const paymentMsg = buildPaymentMethodMessage(channel.guild.id, methodKey, ticket, product, promo);
  const container = paymentMsg.components[0];
  for (const row of paymentActionRows(channel.id)) container.addActionRowComponents(row);

  await channel.send(paymentMsg);
  return { ok: true };
}

async function applyPromoCodeToTicket(channel, userId, code) {
  const ticket = store.getTicket(channel.id);
  if (!ticket || ticket.userId !== userId) return { error: 'This ticket does not belong to you.' };
  if (ticket.stage !== STAGES.AWAITING_PAYMENT) return { error: 'Select a payment method first, then apply your promo code.' };

  const member = await channel.guild.members.fetch(userId).catch(() => null);
  const validated = promoService.validatePromo(channel.guild.id, code, member);
  if (validated.error) return { error: validated.error };

  const product = store.getProduct(channel.guild.id, ticket.productId);
  if (!product) return { error: 'Product not found. Ask staff to refresh your ticket.' };

  if (validated.promo.type !== promoService.PROMO_TYPES.discount_percent) return { error: 'This code is not a discount code.' };

  promoService.applyPromoToTicket(ticket, validated.promo);
  ticket.lastActivityAt = Date.now();
  store.setTicket(channel.id, ticket);

  const amount = parsePrice(product?.price);
  const pricing = promoService.computePricing(amount, validated.promo);
  const amountLines = promoService.buildAmountLines(product, validated.promo, pricing);

  const promoMsg = buildPromoAppliedMessage(validated.promo, amountLines);
  const container = promoMsg.components[0];
  for (const row of paymentActionRows(channel.id)) container.addActionRowComponents(row);

  await channel.send(promoMsg);
  return { ok: true, promo: validated.promo };
}

async function markPaymentDone(channel, userId) {
  const ticket = store.getTicket(channel.id);
  if (!ticket) return { error: 'Not a ticket channel.' };
  if (ticket.userId !== userId) return { error: 'Only the ticket owner can confirm payment.' };
  if (ticket.stage !== STAGES.AWAITING_PAYMENT) return { error: 'You are not at the payment confirmation step.' };

  ticket.stage = STAGES.AWAITING_PROOF;
  ticket.lastActivityAt = Date.now();
  store.setTicket(channel.id, ticket);

  const config = store.getGuild(channel.guild.id);
  await channel.send(buildProofRequestEmbed(channel.guild.id, config.tickets?.awaitingProofMessage));
  return { ok: true };
}

async function handleProofMessage(message) {
  const ticket = store.getTicket(message.channel.id);
  if (!ticket || ticket.stage !== STAGES.AWAITING_PROOF) return false;
  if (message.author.id !== ticket.userId) return false;

  const hasAttachment = message.attachments.size > 0;
  const hasContent = message.content && message.content.trim().length > 2;
  if (!hasAttachment && !hasContent) return false;

  ticket.stage = STAGES.AWAITING_APPROVAL;
  ticket.proofMessageId = message.id;
  ticket.proofAt = Date.now();
  ticket.lastActivityAt = Date.now();
  store.setTicket(message.channel.id, ticket);

  await syncTicketChannelName(message.channel, ticket);

  const config = store.getGuild(message.guild.id);
  await message.reply(buildProofReceivedEmbed(message.guild.id, config.tickets?.waitingApprovalMessage));

  const staffViewers = collectTicketViewers(config);
  const staffPing = staffViewers.roleIds.map((id) => `<@&${id}>`).join(' ');

  const product = ticket.productId ? store.getProduct(message.guild.id, ticket.productId) : null;
  const reviewPayload = buildStaffReviewMessage(message.guild.id, ticket, message.url, product);
  const container = reviewPayload.components[0];
  for (const row of staffApprovalRow(message.channel.id, ticket)) container.addActionRowComponents(row);

  const reviewMsg = await message.channel.send({
    content: staffPing || null,
    ...reviewPayload,
  });

  ticket.reviewMessageId = reviewMsg.id;
  store.setTicket(message.channel.id, ticket);
  return true;
}

async function handleDoneKeyword(message) {
  if (!message.content || !/^done$/i.test(message.content.trim())) return false;
  const ticket = store.getTicket(message.channel.id);
  if (!ticket || message.author.id !== ticket.userId) return false;
  if (ticket.stage !== STAGES.AWAITING_PAYMENT) return false;

  const result = await markPaymentDone(message.channel, message.author.id);
  if (result.error) {
    await message.reply({ content: result.error });
    return true;
  }
  return true;
}

async function claimTicket(guild, channelId, staffMember) {
  const channel = guild.channels.cache.get(channelId) || (await guild.channels.fetch(channelId).catch(() => null));
  if (!channel) return { error: 'Ticket channel not found.' };

  const ticket = store.getTicket(channelId);
  if (!ticket) return { error: 'Not a valid ticket.' };
  if (ticket.stage !== STAGES.AWAITING_APPROVAL) return { error: 'This ticket is not awaiting approval.' };

  if (ticket.claimedBy) {
    if (ticket.claimedBy === staffMember.id) return { error: 'You already claimed this ticket.' };
    return { error: `Already claimed by <@${ticket.claimedBy}>.` };
  }

  ticket.claimedBy = staffMember.id;
  ticket.claimedAt = Date.now();
  store.setTicket(channelId, ticket);

  if (ticket.reviewMessageId && ticket.proofMessageId) {
    const reviewMsg = await channel.messages.fetch(ticket.reviewMessageId).catch(() => null);
    const proofMsg = await channel.messages.fetch(ticket.proofMessageId).catch(() => null);
    if (reviewMsg && proofMsg) {
      const product = ticket.productId ? store.getProduct(guild.id, ticket.productId) : null;
      const payload = buildStaffReviewMessage(guild.id, ticket, proofMsg.url, product);
      const container = payload.components[0];
      for (const row of staffApprovalRow(channelId, ticket)) container.addActionRowComponents(row);
      await reviewMsg.edit({ content: reviewMsg.content, ...payload }).catch(() => null);
    }
  }

  return { ok: true };
}

async function approvePayment(guild, channelId, staffMember, client) {
  const channel = guild.channels.cache.get(channelId) || (await guild.channels.fetch(channelId).catch(() => null));
  if (!channel) return { error: 'Ticket channel not found.' };

  const ticket = store.getTicket(channelId);
  if (!ticket) return { error: 'Not a valid ticket.' };
  if (ticket.stage !== STAGES.AWAITING_APPROVAL) return { error: 'This ticket is not awaiting approval.' };

  const claimCheck = staffCanActOnClaimedTicket(staffMember, ticket);
  if (!claimCheck.ok) return { error: claimCheck.error };

  const config = store.getGuild(guild.id);
  const member = await guild.members.fetch(ticket.userId).catch(() => null);

  if (config.roles?.purchaserRoleId && member) {
    await member.roles.add(config.roles.purchaserRoleId, 'Payment approved').catch(() => null);
  }

  ticket.stage = STAGES.APPROVED;
  ticket.approvedBy = staffMember.id;
  ticket.approvedAt = Date.now();
  store.setTicket(channelId, ticket);

  await syncTicketChannelName(channel, ticket);

  await channel.send({
    content: `<@${ticket.userId}>`,
    ...buildApprovedEmbed(guild.id, config.tickets?.approvedMessage),
  });

  if (ticket.promoCode) promoService.consumePromo(guild.id, ticket.promoCode);

  store.clearTicketCooldown(guild.id, ticket.userId);
  scheduleCounterRefresh(client || guild.client, guild.id);
  return { ok: true };
}

async function denyPayment(guild, channelId, staffMember, reason = null, client) {
  const channel = guild.channels.cache.get(channelId) || (await guild.channels.fetch(channelId).catch(() => null));
  if (!channel) return { error: 'Ticket channel not found.' };

  const ticket = store.getTicket(channelId);
  if (!ticket) return { error: 'Not a valid ticket.' };

  const claimCheck = staffCanActOnClaimedTicket(staffMember, ticket);
  if (!claimCheck.ok) return { error: claimCheck.error };

  const config = store.getGuild(guild.id);
  ticket.stage = STAGES.DENIED;
  ticket.deniedBy = staffMember.id;
  ticket.denyReason = reason;
  store.setTicket(channelId, ticket);

  await syncTicketChannelName(channel, ticket);

  await channel.send({
    content: `<@${ticket.userId}>`,
    ...buildDeniedEmbed(guild.id, config.tickets?.deniedMessage, reason),
  });

  if (isPaymentCategory(ticket.category)) applyPurchaseCooldown(guild.id, ticket.userId, 'denied');

  scheduleCounterRefresh(client || guild.client, guild.id);
  return { ok: true };
}

async function closeTicket(channel, closedBy, client) {
  const ticket = store.getTicket(channel.id);
  const config = store.getGuild(channel.guild.id);

  if (ticket) {
    ticket.stage = STAGES.CLOSED;
    store.setTicket(channel.id, ticket);
  }

  await channel.send(buildClosedEmbed(channel.guild.id, config.tickets?.closedMessage));

  if (ticket && isPaymentCategory(ticket.category)) applyPurchaseCooldown(channel.guild.id, ticket.userId, 'closed');

  const transcript = await buildTicketTranscript(channel);
  await ticketLog.logTicketClosed(channel.guild, ticket, channel, closedBy, transcript);

  scheduleCounterRefresh(client || channel.client, channel.guild.id);

  setTimeout(() => {
    store.deleteTicket(channel.id);
    channel.delete('Ticket closed').catch(() => null);
  }, 5000);

  return { ok: true };
}

function formatTranscriptMessage(message) {
  const createdAt = message.createdAt?.toISOString() || new Date(message.createdTimestamp).toISOString();
  const author = `${message.author?.tag || 'Unknown User'} (${message.author?.id || 'unknown'})`;
  const content = message.content?.trim() || '';
  const attachments = message.attachments.size
    ? `\nAttachments: ${[...message.attachments.values()].map((a) => a.url).join(', ')}`
    : '';
  const embeds = message.embeds.length ? `\nEmbeds: ${message.embeds.length}` : '';
  return `[${createdAt}] ${author}\n${content || '[no text content]'}${attachments}${embeds}`;
}

async function buildTicketTranscript(channel) {
  const messages = [];
  let before;

  while (messages.length < 1000) {
    const batch = await channel.messages.fetch({ limit: 100, before }).catch(() => null);
    if (!batch?.size) break;
    messages.push(...batch.values());
    before = batch.last().id;
    if (batch.size < 100) break;
  }

  const newestLast = messages.reverse();
  const header = [
    `Ticket transcript: #${channel.name}`,
    `Channel ID: ${channel.id}`,
    `Guild: ${channel.guild.name} (${channel.guild.id})`,
    `Messages: ${newestLast.length}`,
    '',
    '---',
    '',
  ].join('\n');

  const body = newestLast.map(formatTranscriptMessage).join('\n\n---\n\n');
  const buffer = Buffer.from(`${header}${body || '[no messages found]'}\n`, 'utf8');

  const safeName = channel.name.replace(/[^a-z0-9-]/gi, '-').slice(0, 80) || 'ticket';
  const attachment = new AttachmentBuilder(buffer, {
    name: `${safeName}-${channel.id}-transcript.txt`,
  });

  const previewLines = newestLast.slice(-8).map((msg) => {
    const tag = msg.author?.username || 'unknown';
    const text = (msg.content || '[attachment]')?.slice(0, 120);
    return `${tag}: ${text}`;
  });

  return {
    attachment,
    messageCount: newestLast.length,
    preview: previewLines.join('\n') || '[no messages]',
  };
}

function getTicketStats(guildId) {
  const tickets = store.listTicketsForGuild(guildId).filter((t) => t.stage !== STAGES.CLOSED);
  return {
    totalOpen: tickets.length,
    awaitingApproval: tickets.filter((t) => t.stage === STAGES.AWAITING_APPROVAL).length,
    byCategory: store.countOpenTicketsByCategory(guildId),
  };
}

function touchTicketChannelActivity(channelId) {
  store.touchTicketActivity(channelId);
}

module.exports = {
  STAGES,
  isPaymentCategory,
  findActiveUserTicket,
  createTicket,
  handleProductIdMessage,
  selectPaymentMethod,
  applyPromoCodeToTicket,
  markPaymentDone,
  handleProofMessage,
  handleDoneKeyword,
  claimTicket,
  approvePayment,
  denyPayment,
  closeTicket,
  getTicketStats,
  touchTicketChannelActivity,
};

