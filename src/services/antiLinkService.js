const store = require('../config/store');
const { logAntilink } = require('../utils/logs');
const { isSecurityWhitelisted } = require('../utils/permissions');

const LINK_PATTERN =
  /(https?:\/\/[^\s]+|www\.[^\s]+|discord\.gg\/[^\s]+|discord\.com\/invite\/[^\s]+)/gi;

function containsLink(content) {
  return LINK_PATTERN.test(content);
}

async function handleMessage(message) {
  if (message.author.bot || !message.guild) return false;

  const config = store.getGuild(message.guild.id);
  if (!config.security?.antiLinkEnabled) return false;

  const member = message.member;
  if (member && isSecurityWhitelisted(member)) return false;

  if (!message.content || !containsLink(message.content)) return false;

  LINK_PATTERN.lastIndex = 0;

  await message.delete().catch(() => null);

  await logAntilink(
    message.guild,
    [
      `**User:** <@${message.author.id}> (\`${message.author.tag}\`)`,
      `**Channel:** <#${message.channel.id}>`,
      `**Content:** ${message.content.slice(0, 500)}`,
    ].join('\n')
  );

  const warning = await message.channel
    .send({
      content: `<@${message.author.id}> Links are not allowed here.`,
    })
    .catch(() => null);

  if (warning) {
    setTimeout(() => warning.delete().catch(() => null), 5000);
  }

  return true;
}

module.exports = { handleMessage, containsLink };
