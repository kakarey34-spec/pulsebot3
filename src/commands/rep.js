const {
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
} = require('discord.js');

const store = require('../config/store');
const { hasPurchaserRole, denyPurchaserInteraction } = require('../utils/permissions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rep')
    .setDescription('Submit a service rating in the Review channel'),
  async execute(interaction) {
    if (!interaction.guild) return;

    const config = store.getGuild(interaction.guild.id);
    const repChannelId = config.channels?.repChannelId;
    if (!repChannelId) {
      return interaction.reply({ content: 'Rep channel is not configured.', ephemeral: true });
    }

    if (interaction.channelId !== repChannelId) {
      return interaction.reply({ content: `Use this command in <#${repChannelId}>.`, ephemeral: true });
    }

    const purchaserRoleId = config.roles?.purchaserRoleId;
    if (purchaserRoleId && !hasPurchaserRole(interaction.member)) {
      return denyPurchaserInteraction(interaction);
    }

    const modal = new ModalBuilder()
      .setCustomId(`rep_modal:${interaction.user.id}`)
      .setTitle('Rate our service');

    const starsInput = new TextInputBuilder()
      .setCustomId('stars')
      .setLabel('How many stars?')
      .setPlaceholder('Type a number from 1 to 5')
      .setStyle(TextInputStyle.Short)
      .setMinLength(1)
      .setMaxLength(1)
      .setRequired(true);

    const ratingInput = new TextInputBuilder()
      .setCustomId('rating')
      .setLabel('Rate with words')
      .setPlaceholder('Tell us what you thought about the service')
      .setStyle(TextInputStyle.Paragraph)
      .setMinLength(3)
      .setMaxLength(1000)
      .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(starsInput), new ActionRowBuilder().addComponents(ratingInput));

    return interaction.showModal(modal);
  },
};

