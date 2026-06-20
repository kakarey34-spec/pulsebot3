const { ActionRowBuilder } = require('discord.js');
const { TICKET_IDS, panelButton } = require('./components');
const store = require('../config/store');
const { buildPanelContainer, buildCounterLine } = require('./display');
const { MessageFlags } = require('discord.js');

const DEFAULT_CATEGORIES = {
  payments: {
    id: 'payments',
    emoji: '🛒',
    label: 'Purchase Tickets',
    buttonStyle: 1,
    description: 'Buy products from the Pulse shop',
    requiresPayment: true,
    requiresProductId: true,
  },
  support: {
    id: 'support',
    emoji: '💬',
    label: 'Support Tickets',
    buttonStyle: 2,
    description: 'Get help with orders or general questions',
    requiresPayment: false,
  },
  partner: {
    id: 'partner',
    emoji: '🤝',
    label: 'Partner Tickets',
    buttonStyle: 2,
    description: 'Partnership and collaboration inquiries',
    requiresPayment: false,
  },
};

function getCategoryById(guildId, categoryId) {
  return DEFAULT_CATEGORIES[categoryId] || null;
}

function getAllCategories() {
  return Object.values(DEFAULT_CATEGORIES);
}

function buildTicketPanelPayload(guildId) {
  const counts = store.countOpenTicketsByCategory(guildId);
  const counterLine = buildCounterLine(counts);

  const fields = [
    {
      name: '🛒 Purchase Tickets',
      value: 'Open a private lane to buy a product. **You will need a Product ID** from the shop.\n' + counterLine.split(' · ')[0],
    },
    {
      name: '💬 Support Tickets',
      value: 'Questions, order issues, and general help.\n' + counterLine.split(' · ')[1],
    },
    {
      name: '🤝 Partner Tickets',
      value: 'Business partnerships and collaborations.\n' + counterLine.split(' · ')[2],
    },
    {
      name: '📊 Live Queue',
      value: counterLine,
    },
    {
      name: 'Guidelines',
      value: '• One open ticket per person\n• Keep all messages in your private lane\n• Be respectful — abuse leads to restrictions',
    },
  ];

  const container = buildPanelContainer(fields);
  const buttons = [
    panelButton('payments', 'Purchase', '🛒', 1),
    panelButton('support', 'Support', '💬', 2),
    panelButton('partner', 'Partner', '🤝', 2),
  ];

  container.addActionRowComponents(new ActionRowBuilder().addComponents(buttons));

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
  };
}

function ticketOpenButtonId(categoryId) {
  return `${TICKET_IDS.open}:${categoryId}`;
}

function parseTicketOpenCategory(customId) {
  if (customId === TICKET_IDS.open) return 'payments';
  if (!customId.startsWith(`${TICKET_IDS.open}:`)) return null;
  return customId.slice(`${TICKET_IDS.open}:`.length);
}

module.exports = {
  DEFAULT_CATEGORIES,
  getCategoryById,
  getAllCategories,
  buildTicketPanelPayload,
  ticketOpenButtonId,
  parseTicketOpenCategory,
};
