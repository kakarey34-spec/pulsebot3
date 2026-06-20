const store = require('../config/store');
const { formatEur } = require('../utils/paysafe');

const PROMO_TYPES = {
  discount_percent: 'discount_percent',
};

const PROMO_AUDIENCE = {
  general: 'general',
  access_only: 'access_only',
};

function normalizeCode(code) {
  return String(code || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '');
}

function getPromoMap(guildId) {
  return store.getGuild(guildId).promos || {};
}

function getPromo(guildId, code) {
  const key = normalizeCode(code);
  return key ? getPromoMap(guildId)[key] || null : null;
}

function savePromo(guildId, promo) {
  const promos = { ...getPromoMap(guildId) };
  promos[promo.code] = promo;
  store.setGuild(guildId, { promos });
  return promo;
}

function deletePromo(guildId, code) {
  const key = normalizeCode(code);
  const promos = { ...getPromoMap(guildId) };
  if (!promos[key]) return false;
  delete promos[key];
  store.setPath(guildId, 'promos', promos);
  return true;
}

function listPromos(guildId) {
  return Object.values(getPromoMap(guildId)).sort((a, b) => b.createdAt - a.createdAt);
}

function validatePromo(guildId, code, member = null) {
  const key = normalizeCode(code);
  if (!key) return { error: 'Enter a valid promo code.' };

  const promo = getPromo(guildId, key);
  if (!promo) return { error: 'That promo code does not exist.' };
  if (promo.expiresAt && Date.now() > promo.expiresAt) {
    return { error: 'This promo code has expired.' };
  }
  if (promo.maxUses != null && promo.uses >= promo.maxUses) {
    return { error: 'This promo code has reached its use limit.' };
  }

  const audience = promo.audience || PROMO_AUDIENCE.general;
  if (audience === PROMO_AUDIENCE.access_only) {
    if (!member) return { error: 'This promo code is only for members with active access.' };
    const { hasPurchaserRole } = require('../utils/permissions');
    if (!hasPurchaserRole(member)) {
      return { error: 'This promo code is only for members with active access.' };
    }
  }

  return { ok: true, promo };
}

function consumePromo(guildId, code) {
  const promo = getPromo(guildId, code);
  if (!promo) return;
  promo.uses = (promo.uses || 0) + 1;
  savePromo(guildId, promo);
}

function promoLabel(promo) {
  return `${promo.value}% off`;
}

function formatPromoLimits(promo) {
  const uses =
    promo.maxUses != null ? `${promo.uses || 0}/${promo.maxUses} uses` : `${promo.uses || 0}/∞ uses`;
  const valid = promo.expiresAt
    ? `expires <t:${Math.floor(promo.expiresAt / 1000)}:F>`
    : 'no expiry';
  return `${uses} · ${valid}`;
}

function createPromoRecord(guildId, data) {
  const code = normalizeCode(data.code);
  if (!code || code.length < 3) return { error: 'Code must be at least 3 characters.' };
  if (getPromo(guildId, code)) return { error: 'That promo code already exists.' };

  const value = Number(data.value);
  if (!Number.isFinite(value) || value < 1 || value > 90) {
    return { error: 'Discount must be between 1 and 90 percent.' };
  }

  let expiresAt = data.expiresAt ?? null;
  if (data.validDays != null) {
    expiresAt = Date.now() + data.validDays * 24 * 60 * 60 * 1000;
  }

  const promo = {
    code,
    type: PROMO_TYPES.discount_percent,
    value,
    maxUses: data.maxUses ?? null,
    validDays: data.validDays ?? null,
    audience: data.audience || PROMO_AUDIENCE.general,
    uses: 0,
    expiresAt,
    createdAt: Date.now(),
    createdBy: data.createdBy,
    note: data.note || null,
  };

  savePromo(guildId, promo);
  return { ok: true, promo };
}

function applyPromoToTicket(ticket, promo) {
  ticket.promoCode = promo.code;
  ticket.promoType = promo.type;
  ticket.promoValue = promo.value;
  return ticket;
}

function computePricing(amount, promo) {
  const original = Number(amount);
  if (!Number.isFinite(original)) {
    return { hasNumericPrice: false, formattedDue: '—' };
  }

  if (!promo || promo.type !== PROMO_TYPES.discount_percent) {
    return {
      original,
      amountDue: original,
      formattedOriginal: formatEur(original),
      formattedDue: formatEur(original),
      hasNumericPrice: true,
    };
  }

  const discountPercent = Number(promo.value) || 0;
  const amountDue = Math.round(original * (1 - discountPercent / 100) * 100) / 100;

  return {
    original,
    amountDue,
    discountPercent,
    formattedOriginal: formatEur(original),
    formattedDue: formatEur(amountDue),
    hasNumericPrice: true,
  };
}

function buildAmountLines(product, promo, pricing) {
  if (!pricing.hasNumericPrice) {
    return `**Listed price:** ${product?.price || '—'}`;
  }

  if (promo?.type === PROMO_TYPES.discount_percent) {
    return [
      `**Original:** ${pricing.formattedOriginal}`,
      `**Promo \`${promo.code}\`:** ${promo.value}% off`,
      `**You send:** ${pricing.formattedDue}`,
    ].join('\n');
  }

  return `**You need to send:** ${pricing.formattedDue}`;
}

function resolveTicketPromo(guildId, ticket, member = null) {
  if (!ticket?.promoCode) return { promo: null };
  const validated = validatePromo(guildId, ticket.promoCode, member);
  if (validated.error) return { error: validated.error };
  return { promo: validated.promo };
}

async function announcePromoCreated(client, guildId, promo) {
  const config = store.getGuild(guildId);
  const channelId = config.channels?.promocodeChannelId;
  if (!channelId) return null;

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return null;

  const { buildPromoV2 } = require('../utils/display');
  const footer = config.embeds?.footer;
  return channel.send(buildPromoV2(promo, footer));
}

module.exports = {
  PROMO_TYPES,
  PROMO_AUDIENCE,
  normalizeCode,
  getPromo,
  listPromos,
  deletePromo,
  validatePromo,
  consumePromo,
  createPromoRecord,
  applyPromoToTicket,
  promoLabel,
  formatPromoLimits,
  computePricing,
  buildAmountLines,
  resolveTicketPromo,
  announcePromoCreated,
};
