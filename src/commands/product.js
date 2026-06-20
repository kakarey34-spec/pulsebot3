const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');

const store = require('../config/store');
const { LEVELS } = require('../utils/permissions');
const { buildProductGallery, buildSimpleV2 } = require('../utils/display');

function getImageUrl(interaction) {
  const attachment = interaction.options.getAttachment('image');
  if (attachment?.url) return attachment.url;
  const url = interaction.options.getString('image_url');
  if (url) return url.trim();
  return null;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('product')
    .setDescription('Seller shop products (Product ID required for purchase tickets)')
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Add a product to the shop')
        .addStringOption((opt) => opt.setName('name').setDescription('Product name').setRequired(true).setMaxLength(120))
        .addNumberOption((opt) => opt.setName('price').setDescription('Price in EUR (e.g. 9.99)').setRequired(true))
        .addStringOption((opt) =>
          opt.setName('description').setDescription('Detailed description shown to buyers').setRequired(true).setMaxLength(2000)
        )
        .addStringOption((opt) =>
          opt.setName('product_id').setDescription('Optional custom Product ID (otherwise auto-generated)').setRequired(false).setMaxLength(32)
        )
        .addAttachmentOption((opt) =>
          opt.setName('image').setDescription('Optional product image').setRequired(false)
        )
        .addStringOption((opt) =>
          opt.setName('image_url').setDescription('Optional product image URL').setRequired(false).setMaxLength(1000)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('list')
        .setDescription('List products (for buyers) — shows Product IDs')
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Remove a product from the shop')
        .addStringOption((opt) =>
          opt.setName('product_id').setDescription('Product ID to remove').setRequired(true).setMaxLength(32)
        )
    ),
  permissionLevel: LEVELS.seller,
  permissionLabel: 'seller',
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    if (sub === 'add') {
      const idRaw = interaction.options.getString('product_id');
      const productId = idRaw && idRaw.trim()
        ? idRaw.trim().toUpperCase()
        : store.nextProductId(guildId);

      const name = interaction.options.getString('name');
      const price = interaction.options.getNumber('price');
      const description = interaction.options.getString('description');
      const imageUrl = getImageUrl(interaction);

      const product = {
        id: productId,
        name,
        price: `€${Number(price).toFixed(2)}`,
        description,
        imageUrl,
        createdAt: Date.now(),
        createdBy: interaction.user.id,
      };

      store.setProduct(guildId, product);

      const payload = buildProductGallery(product, imageUrl);
      await interaction.channel.send(payload);

      return interaction.reply({ content: `Product added: \`${product.id}\`.`, ephemeral: true });
    }

    if (sub === 'list') {
      const products = store.listProducts(guildId);
      if (!products.length) {
        return interaction.reply({ content: 'No products configured yet.', ephemeral: true });
      }

      const lines = products
        .slice(0, 30)
        .map((p) => `• \`${p.id}\` — ${p.name} — ${p.price}`)
        .join('\n');

      return interaction.reply(
        buildSimpleV2(`◆ Products (${products.length})`, lines, 0x00e5ff)
      );
    }

    if (sub === 'remove') {
      const id = interaction.options.getString('product_id').trim();
      if (!store.deleteProduct(guildId, id)) {
        return interaction.reply({ content: 'Product not found.', ephemeral: true });
      }
      return interaction.reply({ content: `Removed product: \`${id.toUpperCase()}\``, ephemeral: true });
    }
  },
};

