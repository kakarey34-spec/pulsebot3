const path = require('path');
const fs = require('fs');
const store = require('../config/store');

/** Pulse Studio brand palette — electric purple & cyan. */
const BRAND = {
  pulse: 0xbb44ff,
  accent: 0x00e5ff,
  dark: 0x1a0a2e,
  muted: 0x8b8b8b,
  success: 0x2ecc71,
  warning: 0xf59e0b,
  danger: 0xe74c3c,
};

const LOGO_PATH = path.join(__dirname, '../../assets/pulse-logo.png');

const CHANNEL_PREFIX = {
  payments: 'purchase',
  support: 'support',
  partner: 'partner',
};

function getBrandColor() {
  const config = store.getGuild('0');
  return config.embeds?.color || BRAND.pulse;
}

function getAccentColor() {
  const config = store.getGuild('0');
  return config.embeds?.accent || BRAND.accent;
}

function brandFooter(guildId) {
  const config = store.getGuild(guildId);
  return { text: config.embeds?.footer || 'Pulse Studio · Made By LyxosDime' };
}

function logoExists() {
  return fs.existsSync(LOGO_PATH);
}

function getChannelPrefix(categoryId) {
  return CHANNEL_PREFIX[categoryId] || 'ticket';
}

function formatChannelName(prefix, username, suffix = '') {
  const slug = String(username || 'user')
    .replace(/[^a-z0-9-]/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
    .slice(0, 28);
  const base = suffix ? `${prefix}-${suffix}-${slug}` : `${prefix}-${slug}`;
  return base.slice(0, 100);
}

module.exports = {
  BRAND,
  LOGO_PATH,
  CHANNEL_PREFIX,
  getBrandColor,
  getAccentColor,
  brandFooter,
  logoExists,
  getChannelPrefix,
  formatChannelName,
};
