const { AttachmentBuilder } = require('discord.js');
const store = require('../config/store');
const { buildTicketMessage, buildSimpleV2 } = require('./display');
const { BRAND } = require('./brand');
const { buildPaypalInstructions, buildPaysafeInstructions, parsePrice } = require('./paysafe');

function buildTicketWelcome(guildId, category, member, product = null) {
  const user = member.toString();
  const cat = category || { id: 'support', label: 'Support' };
  const waitNote = 'Staff will respond when available. Keep all messages in this lane.';

  if (cat.id === 'payments' && product) {
    return buildTicketMessage(
      '◆ Purchase lane opened',
      [
        `${user} — you're in a **private** purchase channel.`,
        '',
        `**Product:** ${product.name}`,
        `**ID:** \`${product.id}\``,
        `**Price:** ${product.price}`,
        '',
        '**Next:** Choose a payment method below.',
        '',
        waitNote,
      ].join('\n'),
      { accent: BRAND.pulse }
    );
  }

  if (cat.id === 'partner') {
    return buildTicketMessage(
      '◆ Partner lane opened',
      [
        `${user} — tell us about your partnership idea.`,
        '',
        '**Include:** your brand/project, audience, and what you\'re looking for.',
        '',
        waitNote,
      ].join('\n'),
      { accent: BRAND.accent }
    );
  }

  return buildTicketMessage(
    '◆ Support lane opened',
    [
      `${user} — you're connected to **Pulse Studio Support**.`,
      '',
      '**Include:** a clear summary, steps you tried, and any relevant screenshots.',
      '',
      waitNote,
    ].join('\n'),
    { accent: BRAND.pulse }
  );
}

function buildPaymentMethodMessage(guildId, methodKey, ticket, product, promo = null) {
  const config = store.getGuild(guildId);
  const amount = parsePrice(product?.price);
  let body;

  if (methodKey === 'paypal') {
    body = buildPaypalInstructions(config, amount, promo);
  } else if (methodKey === 'paysafe') {
    const paysafe = buildPaysafeInstructions(amount, promo);
    body = [
      config.payments?.paysafe?.details || '',
      '',
      paysafe.instructions,
    ].join('\n');
  } else {
    body = config.payments?.[methodKey]?.details || 'Follow staff payment instructions.';
  }

  if (promo?.type === 'discount_percent') {
    body = `🎟️ Promo **${promo.code}** (${promo.value}% off) applied.\n\n${body}`;
  }

  return buildTicketMessage(
    `◆ ${config.payments?.[methodKey]?.label || methodKey}`,
    body,
    { accent: BRAND.accent }
  );
}

function buildProofRequestEmbed(guildId, message) {
  return buildSimpleV2('◆ Upload proof', message || 'Send your payment proof now.', BRAND.pulse);
}

function buildProofReceivedEmbed(guildId, message) {
  return buildSimpleV2('◆ Proof received', message || 'Staff will review your payment shortly.', BRAND.accent);
}

function buildStaffReviewMessage(guildId, ticket, proofUrl, product) {
  const lines = [
    `**Buyer:** <@${ticket.userId}>`,
    product ? `**Product:** ${product.name} (\`${product.id}\`) — ${product.price}` : '',
    ticket.paymentMethod ? `**Method:** ${ticket.paymentMethod}` : '',
    ticket.promoCode ? `**Promo:** \`${ticket.promoCode}\`` : '',
    proofUrl ? `**Proof:** [View message](${proofUrl})` : '',
    '',
    '_Use the buttons below to claim, approve, or decline._',
  ].filter(Boolean);

  return buildTicketMessage('◆ Payment awaiting review', lines.join('\n'), { accent: BRAND.warning });
}

function buildApprovedEmbed(guildId, message) {
  return buildSimpleV2('◆ Order approved', message, BRAND.success);
}

function buildDeniedEmbed(guildId, message, reason) {
  const body = [message, reason ? `\n**Reason:** ${reason}` : ''].filter(Boolean).join('\n');
  return buildSimpleV2('◆ Payment declined', body, BRAND.danger);
}

function buildClosedEmbed(guildId, message) {
  return buildSimpleV2('◆ Ticket closed', message, BRAND.muted);
}

function buildPromoAppliedMessage(promo, amountLines) {
  return buildTicketMessage(
    '◆ Promo code applied',
    [
      `Code **${promo.code}** (${promo.value}% off) is active.`,
      '',
      amountLines,
      '',
      'Send the updated amount, then click **Payment sent**.',
    ].join('\n'),
    { accent: BRAND.accent }
  );
}

module.exports = {
  buildTicketWelcome,
  buildPaymentMethodMessage,
  buildProofRequestEmbed,
  buildProofReceivedEmbed,
  buildStaffReviewMessage,
  buildApprovedEmbed,
  buildDeniedEmbed,
  buildClosedEmbed,
  buildPromoAppliedMessage,
};
