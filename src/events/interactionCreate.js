const {
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

const store = require('../config/store');
const ticketManager = require('../services/ticketManagerClean');
const giveawayService = require('../services/giveawayService');
const antiNukeService = require('../services/antiNukeService'); // (unused, keeps structure consistent)

const { PAYMENT_IDS, TICKET_IDS } = require('../utils/components');
const { canUse, denyInteraction, LEVELS, hasPurchaserRole } = require('../utils/permissions');
const promoService = require('../services/promoService');
const { buildRepV2 } = require('../utils/display');

function mapPaymentIdToKey(customId) {
  if (customId === PAYMENT_IDS.paypal) return 'paypal';
  if (customId === PAYMENT_IDS.paysafe) return 'paysafe';
  return null;
}

module.exports = {
  name: 'interactionCreate',
  async execute(interaction, client) {
    try {
      // Slash commands.
      if (interaction.isChatInputCommand()) {
        if (client.slashHandler) await client.slashHandler.handleSlashCommand(interaction);
        return;
      }

      // Giveaway enter button.
      if (interaction.isButton() && giveawayService.isEnterButton(interaction.customId)) {
        return giveawayService.handleEnter(interaction);
      }

      // Ticket open button (panel).
      if (interaction.isButton() && interaction.customId.startsWith(`${TICKET_IDS.open}:`)) {
        const categoryId = interaction.customId.split(':')[1];
        await interaction.deferReply({ ephemeral: true });
        const result = await ticketManager.createTicket(interaction.guild, interaction.member, categoryId, client);
        if (result.error) return interaction.editReply({ content: result.error });
        return interaction.editReply({ content: `Ticket created: ${result.channel}` });
      }

      // Payment method selection buttons.
      if (interaction.isButton() && interaction.customId.startsWith('payment_')) {
        const methodKey = mapPaymentIdToKey(interaction.customId);
        if (!methodKey) return;
        const result = await ticketManager.selectPaymentMethod(interaction.channel, interaction.user.id, methodKey);
        if (result.error) return interaction.reply({ content: result.error, ephemeral: true });
        return interaction.reply({ content: 'Payment instructions sent.', ephemeral: true });
      }

      // Redeem Discount (promo) button.
      if (interaction.isButton() && interaction.customId.startsWith(`${TICKET_IDS.promo}:`)) {
        const channelId = interaction.customId.split(':')[1];
        if (interaction.channelId !== channelId) {
          return interaction.reply({ content: 'Use Redeem Discount inside the correct ticket channel.', ephemeral: true });
        }

        const modal = new ModalBuilder()
          .setCustomId(`discount_modal:${channelId}`)
          .setTitle('Redeem discount code');

        const codeInput = new TextInputBuilder()
          .setCustomId('code')
          .setLabel('Discount code')
          .setPlaceholder('e.g. SAVE20')
          .setStyle(TextInputStyle.Short)
          .setMinLength(3)
          .setMaxLength(32)
          .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(codeInput));
        return interaction.showModal(modal);
      }

      // Payment sent button.
      if (interaction.isButton() && interaction.customId === TICKET_IDS.paymentDone) {
        const result = await ticketManager.markPaymentDone(interaction.channel, interaction.user.id);
        if (result.error) return interaction.reply({ content: result.error, ephemeral: true });
        return interaction.reply({ content: 'Now upload your payment proof.', ephemeral: true });
      }

      // Staff claim button.
      if (interaction.isButton() && interaction.customId.startsWith(`${TICKET_IDS.claim}:`)) {
        if (!canUse(interaction.member, LEVELS.staff)) {
          return interaction.reply({ content: 'Only staff can claim tickets.', ephemeral: true });
        }
        const channelId = interaction.customId.split(':')[1];
        await interaction.deferReply({ ephemeral: true });
        const result = await ticketManager.claimTicket(interaction.guild, channelId, interaction.member);
        if (result.error) return interaction.editReply({ content: result.error });
        return interaction.editReply({ content: 'You claimed the ticket for review.' });
      }

      // Staff approve button.
      if (interaction.isButton() && interaction.customId.startsWith(`${TICKET_IDS.approve}:`)) {
        if (!canUse(interaction.member, LEVELS.staff)) {
          return interaction.reply({ content: 'Only staff can approve tickets.', ephemeral: true });
        }
        const channelId = interaction.customId.split(':')[1];
        await interaction.deferReply({ ephemeral: true });
        const result = await ticketManager.approvePayment(interaction.guild, channelId, interaction.member, client);
        if (result.error) return interaction.editReply({ content: result.error });
        return interaction.editReply({ content: 'Payment approved.' });
      }

      // Staff deny button (modal).
      if (interaction.isButton() && interaction.customId.startsWith(`${TICKET_IDS.deny}:`)) {
        if (!canUse(interaction.member, LEVELS.staff)) {
          return interaction.reply({ content: 'Only staff can deny tickets.', ephemeral: true });
        }

        const channelId = interaction.customId.split(':')[1];
        const modal = new ModalBuilder()
          .setCustomId(`deny_modal:${channelId}`)
          .setTitle('Decline payment');

        const reasonInput = new TextInputBuilder()
          .setCustomId('reason')
          .setLabel('Reason for decline')
          .setPlaceholder('Explain why the payment could not be verified')
          .setStyle(TextInputStyle.Paragraph)
          .setMinLength(3)
          .setMaxLength(500)
          .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
        return interaction.showModal(modal);
      }

      // Close ticket button.
      if (interaction.isButton() && interaction.customId === TICKET_IDS.close) {
        if (!canUse(interaction.member, LEVELS.staff)) {
          return interaction.reply({ content: 'Only staff can close tickets.', ephemeral: true });
        }
        await interaction.deferReply({ ephemeral: true });
        await ticketManager.closeTicket(interaction.channel, interaction.member, client);
        return interaction.editReply({ content: 'Ticket will close shortly.' });
      }

      // Modal submissions.
      if (interaction.isModalSubmit()) {
        // Discount modal
        if (interaction.customId.startsWith('discount_modal:')) {
          const channelId = interaction.customId.split(':')[1];
          if (interaction.channelId !== channelId) {
            return interaction.reply({ content: 'This discount form is no longer valid here.', ephemeral: true });
          }

          const code = interaction.fields.getTextInputValue('code').trim();
          await interaction.deferReply({ ephemeral: true });

          const result = await ticketManager.applyPromoCodeToTicket(interaction.channel, interaction.user.id, code);
          if (result.error) return interaction.editReply({ content: result.error });
          return interaction.editReply({ content: `Discount ${result.promo.code} applied. Check the instructions above.` });
        }

        // Deny modal
        if (interaction.customId.startsWith('deny_modal:')) {
          const channelId = interaction.customId.split(':')[1];
          if (!interaction.guild) return;

          if (!canUse(interaction.member, LEVELS.staff)) {
            return interaction.reply({ content: 'Only staff can decline payments.', ephemeral: true });
          }

          const reason = interaction.fields.getTextInputValue('reason').trim();
          await interaction.deferReply({ ephemeral: true });

          const result = await ticketManager.denyPayment(interaction.guild, channelId, interaction.member, reason, client);
          if (result.error) return interaction.editReply({ content: result.error });
          return interaction.editReply({ content: 'Payment declined and buyer notified.' });
        }

        // Rep modal
        if (interaction.customId.startsWith('rep_modal:')) {
          const userId = interaction.customId.split(':')[1];
          if (interaction.user.id !== userId) {
            return interaction.reply({ content: 'This review form is not for you.', ephemeral: true });
          }

          const starsRaw = interaction.fields.getTextInputValue('stars').trim();
          const stars = Number.parseInt(starsRaw, 10);
          if (!Number.isInteger(stars) || stars < 1 || stars > 5 || String(stars) !== starsRaw) {
            return interaction.reply({ content: 'Enter a whole number from 1 to 5.', ephemeral: true });
          }

          const rating = interaction.fields.getTextInputValue('rating').trim();
          const config = store.getGuild(interaction.guild.id);
          const repChannelId = config.channels?.repChannelId;
          if (!repChannelId) return interaction.reply({ content: 'Rep channel not configured.', ephemeral: true });

          const repChannel = await interaction.guild.channels.fetch(repChannelId).catch(() => null);
          if (!repChannel?.isTextBased()) return interaction.reply({ content: 'Rep channel not found.', ephemeral: true });

          const payload = buildRepV2(interaction.user.tag, stars, rating);
          await repChannel.send({
            content: `<@${interaction.user.id}>`,
            ...payload,
            allowedMentions: { users: [interaction.user.id] },
          });

          return interaction.reply({ content: 'Review submitted. Thank you!', ephemeral: true });
        }
      }
    } catch (err) {
      console.error('Interaction error:', err);
      const payload = { content: 'Something went wrong while handling that interaction.', ephemeral: true };
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(payload).catch(() => null);
      } else {
        await interaction.reply(payload).catch(() => null);
      }
    }
  },
};

