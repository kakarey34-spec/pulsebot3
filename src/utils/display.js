const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  ThumbnailBuilder,
} = require('discord.js');
const { BRAND, logoExists, LOGO_PATH } = require('./brand');
const path = require('path');
const fs = require('fs');

const V2_FLAGS = MessageFlags.IsComponentsV2;

function pulseContainer(accentColor = BRAND.pulse) {
  return new ContainerBuilder().setAccentColor(accentColor);
}

function textBlock(content) {
  return new TextDisplayBuilder().setContent(content);
}

function sectionWithAccessory(title, body, accessoryBuilder) {
  const section = new SectionBuilder().addTextDisplayComponents(
    textBlock(`**${title}**\n${body}`)
  );
  if (accessoryBuilder) {
    section.setThumbnailAccessory(
      typeof accessoryBuilder === 'function'
        ? accessoryBuilder(new ThumbnailBuilder())
        : accessoryBuilder
    );
  }
  return section;
}

function separator(divider = true) {
  return new SeparatorBuilder()
    .setSpacing(SeparatorSpacingSize.Small)
    .setDivider(divider);
}

function buildV2Message(components, { ephemeral = false } = {}) {
  const flags = ephemeral ? V2_FLAGS | MessageFlags.Ephemeral : V2_FLAGS;
  return { components, flags };
}

function pulseHeader(title, subtitle = '') {
  const lines = [`## ⚡ ${title}`];
  if (subtitle) lines.push(subtitle);
  return textBlock(lines.join('\n'));
}

function buildPanelContainer(fields) {
  const container = pulseContainer(BRAND.pulse);
  container.addTextDisplayComponents(pulseHeader('Pulse Studio', 'Private ticket lanes · secure checkout'));
  container.addSeparatorComponents(separator());

  for (const field of fields) {
    container.addTextDisplayComponents(
      textBlock(`**${field.name}**\n${field.value}`)
    );
    if (field !== fields[fields.length - 1]) {
      container.addSeparatorComponents(separator(false));
    }
  }

  return container;
}

function buildCounterLine(counts) {
  return [
    `🛒 **Purchase:** \`${counts.payments || 0}\` active`,
    `💬 **Support:** \`${counts.support || 0}\` active`,
    `🤝 **Partner:** \`${counts.partner || 0}\` active`,
  ].join(' · ');
}

function buildTicketMessage(title, body, { buttons = [], accent = BRAND.pulse } = {}) {
  const container = pulseContainer(accent);
  container.addTextDisplayComponents(textBlock(`## ${title}\n${body}`));

  if (buttons.length) {
    container.addSeparatorComponents(separator());
    const rows = [];
    for (let i = 0; i < buttons.length; i += 5) {
      rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
    }
    for (const row of rows) {
      container.addActionRowComponents(row);
    }
  }

  return buildV2Message([container]);
}

function buildSimpleV2(title, body, accent = BRAND.pulse) {
  const container = pulseContainer(accent).addTextDisplayComponents(
    textBlock(`## ${title}\n${body}`)
  );
  return buildV2Message([container]);
}

function buildProductGallery(product, imageUrl) {
  const container = pulseContainer(BRAND.accent);
  const lines = [
    `## 🛍️ ${product.name}`,
    `**ID:** \`${product.id}\``,
    `**Price:** ${product.price}`,
    '',
    product.description,
  ];
  container.addTextDisplayComponents(textBlock(lines.join('\n')));

  if (imageUrl) {
    const { MediaGalleryBuilder, MediaGalleryItemBuilder } = require('discord.js');
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL(imageUrl)
      )
    );
  }

  return buildV2Message([container]);
}

function buildGiveawayV2(giveaway, { ended = false } = {}) {
  const endsUnix = Math.floor(giveaway.endsAt / 1000);
  const entries = giveaway.entrants?.length || 0;
  const container = pulseContainer(ended ? BRAND.muted : BRAND.pulse);

  const lines = [
    `## ${ended ? '🏁' : '🎉'} ${giveaway.title}`,
    `**Prize:** ${giveaway.prize}`,
    giveaway.description ? `\n${giveaway.description}` : '',
    '',
    `**Winners:** ${giveaway.winnerCount} · **Entries:** ${entries}`,
    ended
      ? `**Ended:** <t:${endsUnix}:R>`
      : `**Ends:** <t:${endsUnix}:F> (<t:${endsUnix}:R>)`,
    `**Host:** <@${giveaway.hostId}>`,
  ];

  if (ended && giveaway.winnerIds?.length) {
    lines.push('', `**Winner(s):** ${giveaway.winnerIds.map((id) => `<@${id}>`).join(', ')}`);
  } else if (ended) {
    lines.push('', '**Winner(s):** _No valid entries_');
  }

  container.addTextDisplayComponents(textBlock(lines.filter(Boolean).join('\n')));
  return buildV2Message([container]);
}

function buildPromoV2(promo, footer) {
  const container = pulseContainer(BRAND.accent);
  const lines = [
    '## 🎟️ New Promo Code',
    `Use code **\`${promo.code}\`** at checkout`,
    '',
    `**Offer:** ${promo.value}% off`,
    `**Uses:** ${promo.maxUses != null ? `${promo.uses || 0}/${promo.maxUses}` : `${promo.uses || 0}/∞`}`,
    promo.expiresAt ? `**Expires:** <t:${Math.floor(promo.expiresAt / 1000)}:F>` : '**Expires:** Never',
    '',
    '_Open a purchase ticket and click **Redeem Discount** to apply._',
  ];
  if (promo.note) lines.push('', `> ${promo.note}`);
  if (footer) lines.push('', `— ${footer}`);
  container.addTextDisplayComponents(textBlock(lines.join('\n')));
  return buildV2Message([container]);
}

function buildRepV2(userTag, stars, rating) {
  const starLine = '⭐'.repeat(stars) + '☆'.repeat(5 - stars);
  const container = pulseContainer(BRAND.pulse);
  container.addTextDisplayComponents(
    textBlock(`## ⭐ Service Review\n${starLine}\n\n${rating}\n\n— **${userTag}**`)
  );
  return buildV2Message([container]);
}

module.exports = {
  V2_FLAGS,
  pulseContainer,
  textBlock,
  sectionWithAccessory,
  separator,
  buildV2Message,
  pulseHeader,
  buildPanelContainer,
  buildCounterLine,
  buildTicketMessage,
  buildSimpleV2,
  buildProductGallery,
  buildGiveawayV2,
  buildPromoV2,
  buildRepV2,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
};
