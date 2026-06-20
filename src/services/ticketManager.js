const { AttachmentBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
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
const promoService = require('./promoService');
const ticketLog = require('../utils/ticketLog');
const { getCategoryById, DEFAULT_CATEGORIES } = require('../utils/ticketPanel');
const { getPermissionLevel, LEVELS } = require('../utils/permissions');
const { parsePrice } = require('../utils/paysafe');
const { schedulePanelRefresh } = require('./panelCounterService');

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

const ticketCreationLocks = new Set();

function collectTicketViewers(config) {
  const roleIds = new Set();
  const userIds = new Set();

  for (const lists of [
    config.tickets.supportRoleIds,
    config.tickets.viewerRoleIds,
    config.roles.staffRoleIds,
    config.whitelist.staffRoleIds,
    config.whitelist.adminRoleIds,
    [config.roles.modRoleId, config.roles.sellerRoleId],
  ]) {
    for (const id of lists || []) {
      if (id) roleIds.add(id);
    }
  }

  for (const id of config.tickets.viewerUserIds || []) {
    if (id) userIds.add(id);
  }

  return { roleIds: [...roleIds], userIds: [...userIds] };
}

function buildTicketPermissionOverwrites(guild, ticketOwnerId, config) {
  const overwrites = [
    { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
    {
      id: ticketOwnerId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    },
    {
      id: guild.members.me.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ManageChannels,
      ],
    },
  ];

  const { roleIds, userIds } = collectTicketViewers(config);

  for (const roleId of roleIds) {
    overwrites.push({ id: roleId, allow: STAFF_CHANNEL_PERMS });
  }

  for (const userId of userIds) {
    if (userId === ticketOwnerId) continue;
    overwrites.push({ id: userId, allow: STAFF_CHANNEL_PERMS });
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

function ticketTopicForUser(member, categoryId) {
  const category = getCategoryById(member.guild.id, categoryId);
  return `Pulse ${category?.label || categoryId} · ${member.user.tag} (${member.id})`;
}

function channelOwnedByUser(channel, userId) {
  return channel.topic?.includes(`(${userId})`);
}

async function findActiveUserTicket(guild, userId) {
  const config = store.getGuild(guild.id);
  const open = store.findOpenTicketByUser(guild.id, userId);

  if (open) {
    const ch = guild.channels.cache.get(open.channelId);
    if (ch) return { ticket: open, channel: ch };
    store.deleteTicket(open.channelId);
  }

  const categoryId = config.tickets.categoryId;
  for (const ch of guild.channels.cache.values()) {
    if (ch.type !== ChannelType.GuildText) continue;
    if (categoryId && ch.parentId !== categoryId) continue;
    if (!channelOwnedByUser(ch, userId)) continue;

    let ticket = store.getTicket(ch.id);
    if (!ticket) {
      ticket = {
        guildId: guild.id,
        userId,
        stage: STAGES.SELECT_PAYMENT,
        createdAt: Date.now(),
        recovered: true,
      };
      store.setTicket(ch.id, ticket);
    } else if (ticket.stage === STAGES.CLOSED) {
      continue;
    }
    return { ticket, channel: ch };
  }
  return null;
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
  return {
    ok: false,
    error: `Claimed by <@${ticket.claimedBy}>. Only they or an admin can act.`,
  };
}

async function createTicket(guild, member, categoryId = 'payments', productId = null) {
  const lockKey = `${guild.id}:${member.id}`;
  if (ticketCreationLocks.has(lockKey)) {
    return { error: 'Your ticket is being created. Please wait.' };
  }

  const existing = await findActiveUserTicket(guild, member.id);
  if (existing) {
    return {
      error: `You already have an open ticket: ${existing.channel}. Close it before opening another.`,
    };
  }

  ticketCreationLocks.add(lockKey);
  try {
    const category = getCategoryById(guild.id, categoryId);
    if (!category) return { error: 'Unknown ticket category.' };

    if (category.requiresPayment) {
      if (isTicketBlacklisted(guild.id, member.id)) {
        return { error: 'You are blocked from opening purchase tickets. Contact staff.' };
      }
      const cooldownMsg = checkOpenCooldown(guild.id, member.id);
      if (cooldownMsg) return { error: cooldownMsg };

      if (!productId) {
        return { error: 'Product ID is required for purchase tickets.', needsProductId: true };
      }

      const product = store.getProduct(guild.id, productId);
      if (!product) {
        return { error: `Product **${productId}** not found. Check the shop for a valid ID.` };
      }
    }

    const config = store.getGuild(guild.id);
    const overwrites = buildTicketPermissionOverwrites(guild, member.id, config);

    const initialStage = category.requiresPayment ? STAGES.SELECT_PAYMENT : STAGES.AWAITING_STAFF;

    const channel = await guild.channels.create({
      name: ticketChannelName(initialStage, member.user.username, categoryId),
      type: ChannelType.GuildText,
      parent: config.tickets.categoryId || undefined,
      permissionOverwrites: overwrites,
      topic: ticketTopicForUser(member, categoryId),
    });

    const product = productId ? store.getProduct(guild.id, productId) : null;

    const ticketData = {
      guildId: guild.id,
      userId: member.id,
      category: categoryId,
      productId: product?.id || null,
      stage: initialStage,
      paymentMethod: null,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
    };
    store.setTicket(channel.id, ticketData);

    const welcomePayload = buildTicketWelcome(guild.id, category, member, product);

    if (category.requiresPayment) {
      const { ContainerBuilder } = require('discord.js');
      const enabledMethods = Object.entries(config.payments).filter(([, m]) => m.enabled !== false);
      const container = welcomePayload.components[0];
      if (container instanceof ContainerBuilder) {
        for (const row of paymentMethodRow(enabledMethods)) {
          container.addActionRowComponents(row);
        }
      }
    }

    await channel.send(welcomePayload);

    schedulePanelRefresh(guild.client, guild.id);
    return { channel, ticketData };
  } finally {
    ticketCreationLocks.delete(lockKey);
  }
}

async function selectPaymentMethod(channel, userId, methodKey) {
  const ticket = store.getTicket(channel.id);
  if (!ticket || ticket.userId !== userId) {
    return { error: 'This ticket does not belong to you.' };
  }
  if (ticket.stage !== STAGES.SELECT_PAYMENT && ticket.stage !== STAGES.AWAITING_PAYMENT) {
    return { error: 'Payment method already selected.' };
  }
  if (!ticket.productId) {
    return { error: 'No product linked to this ticket.' };
  }

  const config = store.getGuild(channel.guild.id);
  const method = config.payments[methodKey];
  if (!method || method.enabled === false) {
    return { error: 'That payment method is not available.' };
  }

  const product = store.getProduct(channel.guild.id, ticket.productId);
  const resolved = promoService.resolveTicketPromo(channel.guild.id, ticket);
  const promo = resolved.promo || null;

  ticket.paymentMethod = methodKey;
  ticket.stage = STAGES.AWAITING_PAYMENT;
  ticket.lastActivityAt = Date.now();
  store.setTicket(channel.id, ticket);

  const paymentMsg = buildPaymentMethodMessage(
    channel.guild.id,
    methodKey,
    ticket,
    product,
    promo
  );

  const actionRows = paymentActionRows(channel.id);
  const container = paymentMsg.components[0];
  for (const row of actionRows) {
    container.addActionRowComponents(row);
  }

  await channel.send(paymentMsg);
  return { ok: true };
}

async function applyPromoCodeToTicket(channel, userId, code) {
  const ticket = store.getTicket(channel.id);
  if (!ticket || ticket.userId !== userId) {
    return { error: 'This ticket does not belong to you.' };
  }
  if (ticket.stage !== STAGES.AWAITING_PAYMENT) {
    return { error: 'Select a payment method first, then apply your promo code.' };
  }

  const member = await channel.guild.members.fetch(userId).catch(() => null);
  const validated = promoService.validatePromo(channel.guild.id, code, member);
  if (validated.error) return { error: validated.error };

  const product = store.getProduct(channel.guild.id, ticket.productId);
  promoService.applyPromoToTicket(ticket, validated.promo);
  ticket.lastActivityAt = Date.now();
  store.setTicket(channel.id, ticket);

  const amount = parsePrice(product?.price);
  const pricing = promoService.computePricing(amount, validated.promo);
  const amountLines = promoService.buildAmountLines(product, validated.promo, pricing);

  const promoMsg = buildPromoAppliedMessage(validated.promo, amountLines);
  const actionRows = paymentActionRows(channel.id);
  const container = promoMsg.components[0];
  for (const row of actionRows) container.addActionRowComponents(row);

  await channel.send(promoMsg);
  return { ok: true, promo: validated.promo };
}

async function markPaymentDone(channel, userId) {
  const ticket = store.getTicket(channel.id);
  if (!ticket) return { error: 'Not a ticket channel.' };
  if (ticket.userId !== userId) return { error: 'Only the ticket owner can confirm payment.' };
  if (ticket.stage !== STAGES.AWAITING_PAYMENT) {
    return { error: 'You are not at the payment confirmation step.' };
  }

  const config = store.getGuild(channel.guild.id);
  ticket.stage = STAGES.AWAITING_PROOF;
  ticket.lastActivityAt = Date.now();
  store.setTicket(channel.id, ticket);

  await channel.send(buildProofRequestEmbed(channel.guild.id, config.tickets.awaitingProofMessage));
  return { ok: true };
}

async function handleProofMessage(message) {
  const ticket = store.getTicket(message.channel.id);
  if (!ticket || ticket.stage !== STAGES.AWAITING_PROOF) return false;
  if (message.author.id !== ticket.userId) return false;

  const hasAttachment = message.attachments.size > 0;
  const hasContent = message.content && message.content.trim().length > 2;
  if (!hasAttachment && !hasContent) return false;

  const config = store.getGuild(message.guild.id);
  ticket.stage = STAGES.AWAITING_APPROVAL;
  ticket.proofMessageId = message.id;
  ticket.proofAt = Date.now();
  ticket.lastActivityAt = Date.now();
  store.setTicket(message.channel.id, ticket);

  await syncTicketChannelName(message.channel, ticket);
  await message.channel.send(buildProofReceivedEmbed(message.guild.id, config.tickets.waitingApprovalMessage));

  const { roleIds } = collectTicketViewers(config);
  const staffPing = roleIds.map((id) => `<@&${id}>`).join(' ');

  const product = ticket.productId
    ? store.getProduct(message.guild.id, ticket.productId)
    : null;

  const reviewMsg = buildStaffReviewMessage(message.guild.id, ticket, message.url, product);
  const approvalRows = staffApprovalRow(message.channel.id, ticket);
  const container = reviewMsg.components[0];
  for (const row of approvalRows) container.addActionRowComponents(row);

  const sent = await message.channel.send({
    content: staffPing || null,
    ...reviewMsg,
  });

  ticket.reviewMessageId = sent.id;
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

async function approvePayment(guild, channelId, staffMember, client) {
  const channel = guild.channels.cache.get(channelId);
  if (!channel) return { error: 'Ticket channel not found.' };

  const ticket = store.getTicket(channelId);
  if (!ticket) return { error: 'Not a valid ticket.' };
  if (ticket.stage !== STAGES.AWAITING_APPROVAL) {
    return { error: 'This ticket is not awaiting approval.' };
  }

  const claimCheck = staffCanActOnClaimedTicket(staffMember, ticket);
  if (!claimCheck.ok) return { error: claimCheck.error };

  const config = store.getGuild(guild.id);
  const member = await guild.members.fetch(ticket.userId).catch(() => null);

  if (config.roles.purchaserRoleId && member) {
    await member.roles.add(config.roles.purchaserRoleId, 'Payment approved').catch(() => null);
  }

  if (ticket.promoCode) {
    promoService.consumePromo(guild.id, ticket.promoCode);
  }

  ticket.stage = STAGES.APPROVED;
  ticket.approvedBy = staffMember.id;
  ticket.approvedAt = Date.now();
  store.setTicket(channelId, ticket);

  await syncTicketChannelName(channel, ticket);
  await channel.send({
    content: `<@${ticket.userId}>`,
    ...buildApprovedEmbed(guild.id, config.tickets.approvedMessage),
  });

  store.clearTicketCooldown(guild.id, ticket.userId);
  schedulePanelRefresh(client, guild.id);
  return { ok: true };
}

async function denyPayment(guild, channelId, staffMember, reason = null, client) {
  const channel = guild.channels.cache.get(channelId);
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
    ...buildDeniedEmbed(guild.id, config.tickets.deniedMessage, reason),
  });

  if (isPaymentCategory(ticket.category)) {
    applyPurchaseCooldown(guild.id, ticket.userId, 'denied');
  }

  schedulePanelRefresh(client, guild.id);
  return { ok: true };
}

async function claimTicket(guild, channelId, staffMember) {
  const channel = guild.channels.cache.get(channelId);
  if (!channel) return { error: 'Ticket channel not found.' };

  const ticket = store.getTicket(channelId);
  if (!ticket) return { error: 'Not a valid ticket.' };
  if (ticket.stage !== STAGES.AWAITING_APPROVAL) {
    return { error: 'This ticket is not awaiting approval.' };
  }
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
      const approvalRows = staffApprovalRow(channelId, ticket);
      const container = payload.components[0];
      for (const row of approvalRows) container.addActionRowComponents(row);
      await reviewMsg.edit(payload).catch(() => null);
    }
  }

  return { ok: true };
}

async function closeTicket(channel, closedBy, client) {
  const ticket = store.getTicket(channel.id);
  const config = store.getGuild(channel.guild.id);

  if (ticket) {
    ticket.stage = STAGES.CLOSED;
    store.setTicket(channel.id, ticket);
  }

  await channel.send(buildClosedEmbed(channel.guild.id, config.tickets.closedMessage));

  if (ticket && isPaymentCategory(ticket.category)) {
    applyPurchaseCooldown(channel.guild.id, ticket.userId, 'closed');
  }

  const transcript = await buildTicketTranscript(channel);
  await ticketLog.logTicketClosed(channel.guild, ticket, channel, closedBy, transcript);

  schedulePanelRefresh(client, channel.guild.id);

  setTimeout(() => {
    store.deleteTicket(channel.id);
    channel.delete('Ticket closed').catch(() => null);
  }, 5000);

  return { ok: true };
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

  const body = newestLast
    .map((msg) => {
      const ts = msg.createdAt?.toISOString() || '';
      const author = `${msg.author?.tag || 'Unknown'} (${msg.author?.id})`;
      const content = msg.content?.trim() || '[no text]';
      const attachments = msg.attachments.size
        ? `\nAttachments: ${[...msg.attachments.values()].map((a) => a.url).join(', ')}`
        : '';
      return `[${ts}] ${author}\n${content}${attachments}`;
    })
    .join('\n\n---\n\n');

  const buffer = Buffer.from(`${header}${body || '[no messages]'}\n`, 'utf8');
  const safeName = channel.name.replace(/[^a-z0-9-]/gi, '-').slice(0, 80) || 'ticket';
  const attachment = new AttachmentBuilder(buffer, {
    name: `${safeName}-${channel.id}-transcript.txt`,
  });

  const previewLines = newestLast.slice(-8).map((msg) => {
    const tag = msg.author?.username || 'unknown';
    return `${tag}: ${(msg.content || '[attachment]').slice(0, 120)}`;
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
    tickets,
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
  selectPaymentMethod,
  applyPromoCodeToTicket,
  markPaymentDone,
  handleProofMessage,
  handleDoneKeyword,
  approvePayment,
  denyPayment,
  claimTicket,
  closeTicket,
  getTicketStats,
  touchTicketChannelActivity,
};
