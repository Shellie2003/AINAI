import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { randomId } from './crypto.js';
import { createRemote } from './remotes.js';

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
        messages: { enabled: true, mode: 'auto', aggregateSeconds: 3, memorySize: 12 },
        humanTakeoverHours: 12,
        replyDelay: { min: 0, max: 2 },
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

const MAX_CONVERSATIONS = 1000;

const SETTINGS_VERSION = 2;

/** Met à jour les anciens réglages par défaut (réponses plus rapides depuis la v2), sans toucher aux choix de l'utilisateur. */
export function migrate(data) {
  const v = data.settingsVersion || 1;
  if (v < 2) {
    const a = data.settings.automation;
    if (a.messages.aggregateSeconds === 6) a.messages.aggregateSeconds = 3;
    if (a.replyDelay.min === 3 && a.replyDelay.max === 12) a.replyDelay = { min: 0, max: 2 };
  }
  data.settingsVersion = SETTINGS_VERSION;
  return data;
}

class Store {
  /**
   * @param file   fichier JSON local (serveur avec disque permanent)
   * @param remote stockage distant { load(), save(data) } (hébergement gratuit sans disque)
   */
  constructor({ file = null, remote = null } = {}) {
    this.file = file;
    this.remote = remote;
    this.data = defaultData();
    this.timer = null;
    this.writing = null;
    this.dirty = false;
    if (file && fs.existsSync(file)) {
      try {
        this.data = migrate(merge(defaultData(), JSON.parse(fs.readFileSync(file, 'utf8'))));
      } catch (err) {
        console.error('[store] db.json illisible, sauvegarde et réinitialisation', err.message);
        fs.copyFileSync(file, `${file}.corrupt-${Date.now()}`);
      }
    }
  }

  // Chargement du stockage distant. En cas d'échec on n'écrase JAMAIS les données distantes avec une base vide.
  async init({ retries = 5, delayMs = 3000 } = {}) {
    if (!this.remote) return;
    for (let attempt = 1; ; attempt++) {
      try {
        const remoteData = await this.remote.load();
        if (remoteData) this.data = migrate(merge(defaultData(), remoteData));
        this.ready = true;
        console.log(`[store] données chargées depuis ${this.remote.name}`);
        return;
      } catch (err) {
        if (attempt >= retries) throw err;
        console.error(`[store] chargement impossible (essai ${attempt}/${retries}) : ${err.message}`);
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }

  save() {
    if (!this.file && !this.remote) return;
    if (this.remote && !this.ready) return;
    this.dirty = true;
    if (this.timer) return;
    // Écritures distantes regroupées (au plus une toutes les 10 s) pour rester dans les quotas gratuits
    this.timer = setTimeout(() => this.flush(), this.remote ? 10_000 : 300);
  }

  compact() {
    const convs = Object.values(this.data.conversations);
    if (convs.length > MAX_CONVERSATIONS) {
      convs.sort((a, b) => b.updatedAt - a.updatedAt);
      for (const c of convs.slice(MAX_CONVERSATIONS)) delete this.data.conversations[c.key];
    }
  }

  flush() {
    clearTimeout(this.timer);
    this.timer = null;
    if (!this.dirty) return this.writing || Promise.resolve();
    this.dirty = false;
    this.compact();
    if (this.file) {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.data));
      fs.renameSync(tmp, this.file);
    }
    if (!this.remote) return Promise.resolve();
    // Une seule écriture distante à la fois ; les modifications faites entre-temps partent ensuite.
    const previous = this.writing || Promise.resolve();
    this.writing = previous
      .then(() => this.remote.save(this.data))
      .catch((err) => {
        console.error(`[store] sauvegarde distante échouée : ${err.message}`);
        this.dirty = true;
        if (!this.timer) this.timer = setTimeout(() => this.flush(), 15000);
      });
    return this.writing;
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

function createStore() {
  if (process.env.NODE_ENV === 'test') return new Store();
  const remote = createRemote();
  return remote ? new Store({ remote }) : new Store({ file: FILE });
}

export const store = createStore();
export { Store };
