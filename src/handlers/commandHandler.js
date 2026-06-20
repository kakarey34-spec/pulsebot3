const fs = require('fs');
const path = require('path');
const { Collection, REST, Routes } = require('discord.js');
const { canUse, denyInteraction } = require('../utils/permissions');

function loadCommands(dir, collection) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      loadCommands(fullPath, collection);
    } else if (entry.name.endsWith('.js')) {
      const command = require(fullPath);
      if (command.data?.name) {
        collection.set(command.data.name, command);
      }
    }
  }
}

function createSlashCommandHandler(client) {
  const commands = new Collection();
  loadCommands(path.join(__dirname, '../commands'), commands);
  client.commands = commands;

  async function deployCommands() {
    const all = [...commands.values()];
    const token = process.env.DISCORD_TOKEN;
    const clientId = process.env.CLIENT_ID || client.user.id;
    const guildId = process.env.GUILD_ID;
    const rest = new REST({ version: '10' }).setToken(token);
    const body = all.map((c) => c.data.toJSON());

    if (guildId) {
      await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body });
      console.log(`Registered ${body.length} slash command(s) for guild ${guildId}`);
    } else {
      await rest.put(Routes.applicationCommands(clientId), { body });
      console.log(`Registered ${body.length} global slash command(s)`);
    }
  }

  async function handleSlashCommand(interaction) {
    const command = commands.get(interaction.commandName);
    if (!command) return;

    if (command.permissionLevel != null) {
      if (!canUse(interaction.member, command.permissionLevel)) {
        const label =
          command.permissionLabel ||
          ['everyone', 'seller', 'staff', 'admin', 'owner'][command.permissionLevel] ||
          'higher';
        return denyInteraction(interaction, label);
      }
    }

    try {
      const { logCommand } = require('../utils/logs');
      if (interaction.guild) {
        logCommand(interaction.guild, interaction.user, interaction.commandName).catch(() => null);
      }
      await command.execute(interaction, client);
    } catch (err) {
      console.error(`Slash /${interaction.commandName} error:`, err);
      const payload = { content: 'An error occurred.', ephemeral: true };
      if (interaction.replied || interaction.deferred) {
        await interaction.editReply(payload).catch(() => null);
      } else {
        await interaction.reply(payload).catch(() => null);
      }
    }
  }

  return { deployCommands, handleSlashCommand };
}

module.exports = { createSlashCommandHandler };
