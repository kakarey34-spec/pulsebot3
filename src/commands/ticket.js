const { SlashCommandBuilder, ChannelType } = require('discord.js');

const store = require('../config/store');
const ticketManager = require('../services/ticketManagerClean');
const { buildTicketPanelPayload } = require('../utils/ticketPanel');
const { LEVELS, canUse, denyInteraction } = require('../utils/permissions');
const { buildSimpleV2 } = require('../utils/display');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Manage Pulse ticket lanes')
    .addSubcommand((sub) =>
      sub.setName('panel').setDescription('Post the Pulse ticket panel')
    )
    .addSubcommand((sub) =>
      sub.setName('stats').setDescription('Show live ticket queue stats')
    )
    .addSubcommand((sub) =>
      sub
        .setName('close')
        .setDescription('Close a ticket channel')
        .addChannelOption((opt) =>
          opt
            .setName('channel')
            .setDescription('Ticket channel to close (defaults to current channel)')
            .addChannelTypes(ChannelType.GuildText)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('approve')
        .setDescription('Approve a payment ticket (staff)')
        .addChannelOption((opt) =>
          opt
            .setName('channel')
            .setDescription('Ticket channel to approve')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('deny')
        .setDescription('Decline a payment ticket (staff)')
        .addChannelOption((opt) =>
          opt
            .setName('channel')
            .setDescription('Ticket channel to decline')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
        .addStringOption((opt) =>
          opt.setName('reason').setDescription('Reason shown to the buyer').setRequired(true).setMaxLength(500)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('note')
        .setDescription('Add a staff-only note to the current ticket')
        .addStringOption((opt) =>
          opt.setName('text').setDescription('Internal note (not shown to buyer)').setRequired(true).setMaxLength(500)
        )
    ),
  permissionLevel: LEVELS.staff,
  permissionLabel: 'staff',
  async execute(interaction, client) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'panel') {
      if (!canUse(interaction.member, LEVELS.admin)) {
        return denyInteraction(interaction, 'admin');
      }

      const payload = buildTicketPanelPayload(interaction.guild.id);
      const msg = await interaction.channel.send(payload);

      store.setPath(interaction.guild.id, 'tickets.panelChannelId', interaction.channel.id);
      store.setPath(interaction.guild.id, 'tickets.panelMessageId', msg.id);

      return interaction.reply({ content: `Ticket panel posted in ${interaction.channel}.`, ephemeral: true });
    }

    if (sub === 'stats') {
      const stats = ticketManager.getTicketStats(interaction.guild.id);
      const text = [
        `Total open: **${stats.totalOpen}**`,
        `Awaiting approval: **${stats.awaitingApproval}**`,
        `Live counters: ${stats.byCategory.payments ? `🛒 ${stats.byCategory.payments}` : '🛒 0'} / ${stats.byCategory.support ? `💬 ${stats.byCategory.support}` : '💬 0'} / ${stats.byCategory.partner ? `🤝 ${stats.byCategory.partner}` : '🤝 0'}`,
      ].join('\n');
      return interaction.reply(buildSimpleV2('◆ Ticket queue stats', text, 0x00e5ff));
    }

    if (sub === 'close') {
      const channel = interaction.options.getChannel('channel') || interaction.channel;
      if (!store.getTicket(channel.id)) {
        return interaction.reply({ content: 'That channel is not a tracked ticket.', ephemeral: true });
      }
      await ticketManager.closeTicket(channel, interaction.member, client);
      return interaction.reply({ content: 'Closing ticket…', ephemeral: true });
    }

    if (sub === 'approve') {
      const channel = interaction.options.getChannel('channel');
      const ticket = store.getTicket(channel.id);
      if (!ticket) return interaction.reply({ content: 'That channel is not a ticket.', ephemeral: true });
      const res = await ticketManager.approvePayment(interaction.guild, channel.id, interaction.member, client);
      if (res.error) return interaction.reply({ content: res.error, ephemeral: true });
      return interaction.reply({ content: 'Approved.', ephemeral: true });
    }

    if (sub === 'deny') {
      const channel = interaction.options.getChannel('channel');
      const reason = interaction.options.getString('reason');
      const ticket = store.getTicket(channel.id);
      if (!ticket) return interaction.reply({ content: 'That channel is not a ticket.', ephemeral: true });
      const res = await ticketManager.denyPayment(interaction.guild, channel.id, interaction.member, reason, client);
      if (res.error) return interaction.reply({ content: res.error, ephemeral: true });
      return interaction.reply({ content: 'Declined.', ephemeral: true });
    }

    if (sub === 'note') {
      const ticket = store.getTicket(interaction.channel.id);
      if (!ticket) return interaction.reply({ content: 'This is not a ticket channel.', ephemeral: true });
      ticket.staffNote = interaction.options.getString('text');
      ticket.staffNoteBy = interaction.user.id;
      ticket.staffNoteAt = Date.now();
      store.setTicket(interaction.channel.id, ticket);
      return interaction.reply({ content: 'Note saved.', ephemeral: true });
    }
  },
};

