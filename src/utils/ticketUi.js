const store = require('../config/store');
const { buildTicketMessage, buildSimpleV2, buildCounterLine } = require('./display');
const { BRAND } = require('./brand');
const { buildPaypalInstructions, buildPaysafeInstructions, parsePrice } = require('./paysafe');

function stageInstruction(stage, categoryId) {
  if (categoryId === 'payments') {
    if (stage === 'awaiting_product') {
      return [
        '**Step 1:** Send your **Product ID** in ONE message.',
        'Example: `PULSE-0001`',
      ].join('\n');
    }
    if (stage === 'select_payment') {
      return '**Step 2:** Choose your payment method using the buttons below.';
    }
    if (stage === 'awaiting_payment') {
      return 'Send the payment exactly as shown, then click **Payment sent ✅**.';
    }
    if (stage === 'awaiting_proof') {
      return '**Step 3:** Upload your payment proof (screenshot, receipt, or transaction ID).';
    }
    if (stage === 'awaiting_approval') {
      return 'Your proof is now in review. Thanks for waiting.';
    }
    if (stage === 'approved') {
      return 'Your order has been approved.';
    }
    if (stage === 'denied') {
      return 'Your payment was declined. Please contact staff or open a new lane.';
    }
    return 'Please follow the next steps in this lane.';
  }

  // support/partner
  if (stage === 'awaiting_staff') return 'Describe your issue and staff will respond when available.';
  if (stage === 'awaiting_approval') return 'Your message is being reviewed by staff.';
  return 'Please message staff inside this lane.';
}

function buildTicketWelcome(guildId, categoryId, userId, { stage, product = null } = {}) {
  const counts = store.countOpenTicketsByCategory(guildId);
  const counters = `**Live counters:**\n${buildCounterLine(counts)}`;

  if (categoryId === 'payments') {
    const productBlock = product
      ? ['**Selected Product:**', `• Name: ${product.name}`, `• ID: \`${product.id}\``, `• Price: ${product.price}`].join(
          '\n'
        )
      : '';

    return buildTicketMessage(
      '◆ Purchase lane opened',
      [
        `<@${userId}> — you’re in a **private** purchase channel.`,
        '',
        productBlock || '**Product not selected yet** — use the step below.',
        '',
        stageInstruction(stage, 'payments'),
        '',
        counters,
      ].filter(Boolean).join('\n'),
      { accent: BRAND.pulse }
    );
  }

  if (categoryId === 'partner') {
    return buildTicketMessage(
      '◆ Partner lane opened',
      [
        `<@${userId}> — tell us about your partnership inquiry.`,
        '',
        '**Include:** your brand/project, audience, and what you’re looking for.',
        '',
        stageInstruction(stage, 'partner'),
        '',
        counters,
      ].filter(Boolean).join('\n'),
      { accent: BRAND.accent }
    );
  }

  return buildTicketMessage(
    '◆ Support lane opened',
    [
      `<@${userId}> — you’re connected to **Pulse Studio Support**.`,
      '',
      '**Include:** a clear summary, steps you tried, and any relevant screenshots.',
      '',
      stageInstruction(stage, 'support'),
      '',
      counters,
    ].filter(Boolean).join('\n'),
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
