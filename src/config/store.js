const fs = require('fs');
const path = require('path');
const defaults = require('./defaults');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../../data');
const CONFIG_PATH = path.join(DATA_DIR, 'guild-config.json');
const TICKETS_PATH = path.join(DATA_DIR, 'active-tickets.json');
const COOLDOWNS_PATH = path.join(DATA_DIR, 'ticket-cooldowns.json');
const GIVEAWAYS_PATH = path.join(DATA_DIR, 'giveaways.json');
const PRODUCTS_PATH = path.join(DATA_DIR, 'products.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readJson(filePath, fallback) {
  ensureDataDir();
  if (!fs.existsSync(filePath)) {
    return structuredClone(fallback);
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return structuredClone(fallback);
  }
}

function writeJson(filePath, data) {
  ensureDataDir();
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function deepMerge(target, source) {
  const out = { ...target };
  for (const key of Object.keys(source || {})) {
    if (
      source[key] &&
      typeof source[key] === 'object' &&
      !Array.isArray(source[key]) &&
      target[key] &&
      typeof target[key] === 'object' &&
      !Array.isArray(target[key])
    ) {
      out[key] = deepMerge(target[key], source[key]);
    } else {
      out[key] = source[key];
    }
  }
  return out;
}

class ConfigStore {
  constructor() {
    this._initialized = false;
    this._cache = {};
    this._tickets = {};
    this._cooldowns = {};
    this._giveaways = {};
    this._products = {};
  }

  async init() {
    if (this._initialized) return;

    this._cache = readJson(CONFIG_PATH, {});
    this._tickets = readJson(TICKETS_PATH, {});
    this._cooldowns = readJson(COOLDOWNS_PATH, {});
    this._giveaways = readJson(GIVEAWAYS_PATH, {});
    this._products = readJson(PRODUCTS_PATH, {});

    console.log(`Storage: JSON files in ${DATA_DIR}`);
    this._initialized = true;
  }

  getGuild(guildId) {
    if (!this._cache[guildId]) {
      this._cache[guildId] = structuredClone(defaults);
      this.save();
    }
    return deepMerge(structuredClone(defaults), this._cache[guildId]);
  }

  setGuild(guildId, partial) {
    const current = this.getGuild(guildId);
    this._cache[guildId] = deepMerge(current, partial);
    this.save();
    return this.getGuild(guildId);
  }

  setPath(guildId, dotPath, value) {
    const config = this.getGuild(guildId);
    const keys = dotPath.split('.');
    let ref = config;
    for (let i = 0; i < keys.length - 1; i++) {
      if (ref[keys[i]] === undefined || typeof ref[keys[i]] !== 'object') {
        ref[keys[i]] = {};
      }
      ref = ref[keys[i]];
    }
    const last = keys[keys.length - 1];
    const parsed = tryParseValue(value);
    ref[last] = parsed;
    this._cache[guildId] = config;
    this.save();
    return parsed;
  }

  getPath(guildId, dotPath) {
    const config = this.getGuild(guildId);
    return dotPath.split('.').reduce((acc, key) => (acc != null ? acc[key] : undefined), config);
  }

  save() {
    writeJson(CONFIG_PATH, this._cache);
  }

  getTicket(channelId) {
    return this._tickets[channelId] || null;
  }

  setTicket(channelId, data) {
    this._tickets[channelId] = data;
    writeJson(TICKETS_PATH, this._tickets);
  }

  deleteTicket(channelId) {
    delete this._tickets[channelId];
    writeJson(TICKETS_PATH, this._tickets);
  }

  listTicketsForGuild(guildId) {
    return Object.entries(this._tickets)
      .filter(([, t]) => t.guildId === guildId)
      .map(([channelId, t]) => ({ channelId, ...t }));
  }

  findOpenTicketByUser(guildId, userId) {
    return this.listTicketsForGuild(guildId).find(
      (t) => t.userId === userId && t.stage !== 'closed'
    );
  }

  countOpenTicketsByCategory(guildId) {
    const counts = { payments: 0, support: 0, partner: 0 };
    for (const t of this.listTicketsForGuild(guildId)) {
      if (t.stage === 'closed') continue;
      const cat = t.category || 'support';
      if (counts[cat] != null) counts[cat]++;
    }
    return counts;
  }

  _cooldownBucket(guildId) {
    if (!this._cooldowns[guildId]) this._cooldowns[guildId] = {};
    return this._cooldowns[guildId];
  }

  getTicketCooldown(guildId, userId) {
    return this._cooldownBucket(guildId)[userId] || null;
  }

  setTicketCooldown(guildId, userId, untilMs, reason = 'closed') {
    const row = { until: untilMs, reason, setAt: Date.now() };
    this._cooldownBucket(guildId)[userId] = row;
    writeJson(COOLDOWNS_PATH, this._cooldowns);
  }

  clearTicketCooldown(guildId, userId) {
    delete this._cooldownBucket(guildId)[userId];
    writeJson(COOLDOWNS_PATH, this._cooldowns);
  }

  touchTicketActivity(channelId) {
    const ticket = this.getTicket(channelId);
    if (!ticket) return;
    ticket.lastActivityAt = Date.now();
    this.setTicket(channelId, ticket);
  }

  getGiveaway(messageId) {
    return this._giveaways[messageId] || null;
  }

  setGiveaway(messageId, data) {
    this._giveaways[messageId] = data;
    writeJson(GIVEAWAYS_PATH, this._giveaways);
  }

  deleteGiveaway(messageId) {
    delete this._giveaways[messageId];
    writeJson(GIVEAWAYS_PATH, this._giveaways);
  }

  listActiveGiveaways() {
    const now = Date.now();
    return Object.values(this._giveaways).filter(
      (g) => g.status === 'active' && g.endsAt > now
    );
  }

  pruneEndedGiveaways(maxAgeMs = 14 * 24 * 60 * 60 * 1000) {
    const cutoff = Date.now() - maxAgeMs;
    for (const [messageId, g] of Object.entries(this._giveaways)) {
      if (g.status === 'ended' && (g.endedAt || 0) < cutoff) {
        this.deleteGiveaway(messageId);
      }
    }
  }

  _productBucket(guildId) {
    if (!this._products[guildId]) this._products[guildId] = {};
    return this._products[guildId];
  }

  getProduct(guildId, productId) {
    const key = String(productId || '').trim().toUpperCase();
    return this._productBucket(guildId)[key] || null;
  }

  setProduct(guildId, product) {
    const key = String(product.id).trim().toUpperCase();
    this._productBucket(guildId)[key] = product;
    writeJson(PRODUCTS_PATH, this._products);
    return product;
  }

  deleteProduct(guildId, productId) {
    const key = String(productId || '').trim().toUpperCase();
    const bucket = this._productBucket(guildId);
    if (!bucket[key]) return false;
    delete bucket[key];
    writeJson(PRODUCTS_PATH, this._products);
    return true;
  }

  listProducts(guildId) {
    return Object.values(this._productBucket(guildId)).sort((a, b) => b.createdAt - a.createdAt);
  }

  nextProductId(guildId) {
    const products = this.listProducts(guildId);
    let max = 0;
    for (const p of products) {
      const match = String(p.id).match(/PULSE-(\d+)/i);
      if (match) max = Math.max(max, parseInt(match[1], 10));
    }
    return `PULSE-${String(max + 1).padStart(4, '0')}`;
  }
}

function tryParseValue(value) {
  if (typeof value !== 'string') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null') return null;
  if (/^-?\d+$/.test(value)) return Number(value);
  if ((value.startsWith('[') && value.endsWith(']')) || (value.startsWith('{') && value.endsWith('}'))) {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

module.exports = new ConfigStore();
