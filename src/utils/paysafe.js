const PAYSAFE_TIERS = [5, 10, 25, 50, 100];

function roundToPaysafeTier(amountEur) {
  const value = Number(amountEur);
  if (!Number.isFinite(value) || value <= 0) return PAYSAFE_TIERS[0];
  let best = PAYSAFE_TIERS[0];
  let bestDiff = Math.abs(value - best);
  for (const tier of PAYSAFE_TIERS.slice(1)) {
    const diff = Math.abs(value - tier);
    if (diff < bestDiff) {
      best = tier;
      bestDiff = diff;
    }
  }
  return best;
}

function formatEur(amount) {
  return `€${Number(amount).toFixed(2)}`;
}

function buildPaysafeInstructions(baseAmount, promo = null) {
  let amount = Number(baseAmount);
  if (promo?.type === 'discount_percent') {
    const discount = Number(promo.value) || 0;
    amount = Math.round(amount * (1 - discount / 100) * 100) / 100;
  }
  const tier = roundToPaysafeTier(amount);
  return {
    originalAmount: amount,
    tier,
    formattedTier: formatEur(tier),
    instructions: [
      `**Product amount:** ${formatEur(amount)}`,
      `**PaySafe card to buy:** ${formatEur(tier)} _(rounded to nearest tier)_`,
      '',
      'Purchase a PaySafe card for the tier amount, then send the **16-digit code** in this channel after clicking **Payment sent**.',
      '',
      '_Tiers: €5 · €10 · €25 · €50 · €100_',
    ].join('\n'),
  };
}

function buildPaypalInstructions(config, amount, promo = null) {
  const email = config.payments?.paypal?.email || 'not-configured@example.com';
  let due = Number(amount);
  if (promo?.type === 'discount_percent') {
    const discount = Number(promo.value) || 0;
    due = Math.round(due * (1 - discount / 100) * 100) / 100;
  }
  const details = config.payments?.paypal?.details || '';
  return [
    `**Send via PayPal:** \`${email}\``,
    `**Amount:** €${due.toFixed(2)}`,
    '',
    details,
    '',
    'Include your Discord username in the payment note.',
  ].join('\n');
}

function parsePrice(priceStr) {
  if (!priceStr) return null;
  const match = String(priceStr).match(/(\d+(?:[.,]\d{1,2})?)/);
  if (!match) return null;
  const amount = parseFloat(match[1].replace(',', '.'));
  return Number.isFinite(amount) ? amount : null;
}

module.exports = {
  PAYSAFE_TIERS,
  roundToPaysafeTier,
  formatEur,
  buildPaysafeInstructions,
  buildPaypalInstructions,
  parsePrice,
};
