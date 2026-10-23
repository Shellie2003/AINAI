import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { randomId } from './crypto.js';

// Base de données JSON simple : un seul propriétaire de page, quelques milliers d'événements.
const FILE = path.join(config.dataDir, 'db.json');
const MAX_LOGS = 1000;
const MAX_PROCESSED = 5000;

export function defaultData() {
  return {
    settings: {
      persona: {
        businessName: '',
        description: '',
        tone: 'chaleureux, professionnel et concis',
        defaultLanguage: 'français',
        useEmojis: true,
        signature: '',
        maxLength: 600,
        customInstructions: '',
        humanContact: '',
      },
      knowledge: [],
      examples: [],
      providers: [],
      facebook: { appId: '', appSecret: '', verifyToken: randomId(12) },
      automation: {
        comments: {
          enabled: true,
          mode: 'auto', // auto | approval | off
          likeComments: true,
          hideNegative: true,
          privateReplyOnLead: true,
          ignoreReplies: false,
        },
        messages: { enabled: true, mode: 'auto', aggregateSeconds: 6, memorySize: 12 },
        humanTakeoverHours: 12,
        replyDelay: { min: 3, max: 12 },
        businessHours: { enabled: false, start: '08:00', end: '18:00', timezone: 'Indian/Antananarivo', offHoursNote: '' },
        escalationMessage: 'Merci pour votre message ! Un membre de notre équipe vous répond très vite 🙏',
      },
      rules: [],
    },
    pages: [],
    conversations: {},
    queue: [],
    leads: [],
    logs: [],
    processed: [],
    sentIds: [],
    stats: { days: {} },
  };
}

function merge(base, extra) {
  if (Array.isArray(base) || typeof base !== 'object' || base === null) return extra ?? base;
  const out = { ...base };
  for (const [k, v] of Object.entries(extra || {})) {
    out[k] = k in base && typeof base[k] === 'object' && !Array.isArray(base[k]) && base[k] !== null ? merge(base[k], v) : v;
  }
  return out;
}

class Store {
  constructor(file) {
    this.file = file;
    this.data = defaultData();
    this.timer = null;
    if (file && fs.existsSync(file)) {
      try {
        this.data = merge(defaultData(), JSON.parse(fs.readFileSync(file, 'utf8')));
      } catch (err) {
        console.error('[store] db.json illisible, sauvegarde et réinitialisation', err.message);
        fs.copyFileSync(file, `${file}.corrupt-${Date.now()}`);
      }
    }
  }

  save() {
    if (!this.file || this.timer) return;
    this.timer = setTimeout(() => this.flush(), 300);
  }

  flush() {
    clearTimeout(this.timer);
    this.timer = null;
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.file);
  }

  get settings() {
    return this.data.settings;
  }

  log(level, message, meta = {}) {
    const entry = { id: randomId(6), ts: Date.now(), level, message, ...meta };
    this.data.logs.unshift(entry);
    this.data.logs.length = Math.min(this.data.logs.length, MAX_LOGS);
    if (level === 'error') console.error(`[${level}] ${message}`, meta.error || '');
    this.save();
    return entry;
  }

  // Évite de traiter deux fois le même événement (Facebook renvoie parfois les webhooks).
  markProcessed(id) {
    if (this.data.processed.includes(id)) return false;
    this.data.processed.push(id);
    if (this.data.processed.length > MAX_PROCESSED) this.data.processed.splice(0, 1000);
    this.save();
    return true;
  }

  // Identifiants des messages envoyés par le bot : permet de repérer les réponses humaines.
  rememberSent(id) {
    if (!id) return;
    this.data.sentIds.push(id);
    if (this.data.sentIds.length > MAX_PROCESSED) this.data.sentIds.splice(0, 1000);
    this.save();
  }

  wasSentByBot(id) {
    return this.data.sentIds.includes(id);
  }

  conversation(pageId, userId) {
    const key = `${pageId}:${userId}`;
    this.data.conversations[key] ??= { key, pageId, userId, name: '', messages: [], pausedUntil: 0, updatedAt: Date.now() };
    return this.data.conversations[key];
  }

  addToConversation(conv, role, text, limit = 40) {
    conv.messages.push({ role, text, ts: Date.now() });
    if (conv.messages.length > limit) conv.messages.splice(0, conv.messages.length - limit);
    conv.updatedAt = Date.now();
    this.save();
  }

  bumpStat(key, by = 1) {
    const day = new Date().toISOString().slice(0, 10);
    const d = (this.data.stats.days[day] ??= {});
    d[key] = (d[key] || 0) + by;
    const days = Object.keys(this.data.stats.days).sort();
    while (days.length > 90) delete this.data.stats.days[days.shift()];
    this.save();
  }
}

export const store = new Store(process.env.NODE_ENV === 'test' ? null : FILE);
export { Store };
