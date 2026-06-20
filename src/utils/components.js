const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const PAYMENT_IDS = {
  paypal: 'payment_paypal',
  paysafe: 'payment_paysafe',
};

const TICKET_IDS = {
  open: 'ticket_open',
  close: 'ticket_close',
  paymentDone: 'ticket_payment_done',
  approve: 'ticket_approve',
  deny: 'ticket_deny',
  claim: 'ticket_claim',
  promo: 'ticket_promo',
};

const PAYMENT_EMOJI = {
  paypal: '💳',
  paysafe: '🎫',
};

function paymentMethodRow(enabledMethods) {
  const buttons = enabledMethods.map(([key, method]) => {
    const btn = new ButtonBuilder()
      .setCustomId(PAYMENT_IDS[key] || `payment_${key}`)
      .setLabel(method.label || key)
      .setStyle(ButtonStyle.Primary);
    const emoji = PAYMENT_EMOJI[key];
    if (emoji) btn.setEmoji(emoji);
    return btn;
  });

  const rows = [];
  for (let i = 0; i < buttons.length; i += 5) {
    rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
  }
  return rows;
}

function paymentActionRows(channelId) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(TICKET_IDS.paymentDone)
        .setLabel('Payment sent')
        .setEmoji('✅')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`${TICKET_IDS.promo}:${channelId}`)
        .setLabel('Redeem Discount')
        .setEmoji('🎟️')
        .setStyle(ButtonStyle.Secondary)
    ),
  ];
}

function staffApprovalRow(ticketChannelId, ticket = null) {
  const buttons = [];

  if (ticket?.claimedBy) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`${TICKET_IDS.claim}:${ticketChannelId}`)
        .setLabel('Claimed')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true)
    );
  } else {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`${TICKET_IDS.claim}:${ticketChannelId}`)
        .setLabel('Claim')
        .setEmoji('🙋')
        .setStyle(ButtonStyle.Primary)
    );
  }

  buttons.push(
    new ButtonBuilder()
      .setCustomId(`${TICKET_IDS.approve}:${ticketChannelId}`)
      .setLabel('Approve')
      .setEmoji('✔️')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`${TICKET_IDS.deny}:${ticketChannelId}`)
      .setLabel('Decline')
      .setEmoji('✖️')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(TICKET_IDS.close)
      .setLabel('Close ticket')
      .setEmoji('🔒')
      .setStyle(ButtonStyle.Secondary)
  );

  return [new ActionRowBuilder().addComponents(buttons)];
}

function panelButton(categoryId, label, emoji, style = ButtonStyle.Secondary) {
  const btn = new ButtonBuilder()
    .setCustomId(`${TICKET_IDS.open}:${categoryId}`)
    .setLabel(label)
    .setStyle(style);
  if (emoji) btn.setEmoji(emoji);
  return btn;
}

module.exports = {
  PAYMENT_IDS,
  TICKET_IDS,
  paymentMethodRow,
  paymentActionRows,
  staffApprovalRow,
  panelButton,
};
