const { SlashCommandBuilder, ChannelType } = require('discord.js');

const store = require('../config/store');
const { LEVELS, canUse, denyInteraction } = require('../utils/permissions');
const promoService = require('../services/promoService');
const { buildSimpleV2 } = require('../utils/display');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('promo')
    .setDescription('Discount promo codes (Redeem Discount) — discount-only')
    .addSubcommand((sub) =>
      sub
        .setName('set_channel')
        .setDescription('Set the channel where promo embeds are announced')
        .addChannelOption((opt) =>
          opt.setName('channel').setDescription('Promo announcement channel').setRequired(true).addChannelTypes(ChannelType.GuildText)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('create')
        .setDescription('Create a new discount code')
        .addStringOption((opt) =>
          opt.setName('code').setDescription('Code users enter').setRequired(true).setMaxLength(32)
        )
        .addIntegerOption((opt) =>
          opt.setName('value').setDescription('Discount percent (1–90)').setRequired(true).setMinValue(1).setMaxValue(90)
        )
        .addIntegerOption((opt) =>
          opt.setName('max_uses').setDescription('Max uses (optional)').setRequired(false).setMinValue(1).setMaxValue(100000)
        )
        .addIntegerOption((opt) =>
          opt.setName('valid_days').setDescription('How long it stays active in days (optional)').setRequired(false).setMinValue(1).setMaxValue(365)
        )
        .addStringOption((opt) =>
          opt
            .setName('audience')
            .setDescription('Who can use this code')
            .setRequired(false)
            .addChoices(
              { name: 'Everyone', value: promoService.PROMO_AUDIENCE.general },
              { name: 'Access role holders only', value: promoService.PROMO_AUDIENCE.access_only }
            )
        )
        .addStringOption((opt) =>
          opt.setName('note').setDescription('Optional internal note').setRequired(false).setMaxLength(200)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('delete')
        .setDescription('Delete a promo code')
        .addStringOption((opt) => opt.setName('code').setDescription('Code to delete').setRequired(true).setMaxLength(32))
    )
    .addSubcommand((sub) =>
      sub.setName('list').setDescription('List promo codes')
    ),
  permissionLevel: LEVELS.admin,
  permissionLabel: 'admin',
  async execute(interaction, client) {
    const sub = interaction.options.getSubcommand();

    if (!canUse(interaction.member, LEVELS.admin)) {
      return denyInteraction(interaction, 'admin');
    }

    const guildId = interaction.guild.id;

    if (sub === 'set_channel') {
      const channel = interaction.options.getChannel('channel');
      store.setPath(guildId, 'channels.promocodeChannelId', channel.id);
      return interaction.reply({ content: `Promo announcements will be sent to ${channel}.`, ephemeral: true });
    }

    if (sub === 'create') {
      const code = interaction.options.getString('code');
      const value = interaction.options.getInteger('value');
      const maxUses = interaction.options.getInteger('max_uses');
      const validDays = interaction.options.getInteger('valid_days');
      const audience = interaction.options.getString('audience') || promoService.PROMO_AUDIENCE.general;
      const note = interaction.options.getString('note') || null;

      const result = promoService.createPromoRecord(guildId, {
        code,
        value,
        maxUses: maxUses ?? null,
        validDays: validDays ?? null,
        audience,
        createdBy: interaction.user.id,
        note,
      });

      if (result.error) return interaction.reply({ content: result.error, ephemeral: true });

      await promoService.announcePromoCreated(client, guildId, result.promo).catch(() => null);
      return interaction.reply({ content: `Created promo \`${result.promo.code}\` (${result.promo.value}% off).`, ephemeral: true });
    }

    if (sub === 'delete') {
      const code = interaction.options.getString('code');
      if (!promoService.deletePromo(guildId, code)) {
        return interaction.reply({ content: 'Promo not found.', ephemeral: true });
      }
      return interaction.reply({ content: `Deleted promo \`${promoService.normalizeCode(code)}\`.`, ephemeral: true });
    }

    if (sub === 'list') {
      const promos = promoService.listPromos(guildId);
      if (!promos.length) return interaction.reply({ content: 'No promos configured.', ephemeral: true });

      const lines = promos
        .slice(0, 20)
        .map((p) => `• \`${p.code}\` — ${p.value}% off — ${promoService.formatPromoLimits(p)}`)
        .join('\n');

      return interaction.reply(buildSimpleV2(`◆ Promo codes (${promos.length})`, lines, 0x00e5ff));
    }
  },
};

