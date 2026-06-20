require('dotenv').config();
const http = require('http');
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const { loadEvents } = require('./handlers/eventHandler');
const { createSlashCommandHandler } = require('./handlers/commandHandler');
const store = require('./config/store');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildVoiceStates,
  ],
  partials: [Partials.Channel, Partials.Message],
});

client.slashHandler = createSlashCommandHandler(client);
loadEvents(client);

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error('Missing DISCORD_TOKEN in .env');
  process.exit(1);
}

const port = process.env.PORT || 3000;
http
  .createServer((req, res) => {
    const path = (req.url || '/').split('?')[0];
    if (path !== '/' && path !== '/health') {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', bot: client.user?.tag || 'starting' }));
  })
  .listen(port, () => {
    console.log(`Health server on port ${port}`);
  });

store
  .init()
  .then(() => client.login(token))
  .catch((err) => {
    console.error('Failed to start:', err);
    process.exit(1);
  });
