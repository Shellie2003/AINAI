import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { config } from './config.js';
import { store } from './store.js';
import { encrypt, decrypt, mask, randomId, safeEqual } from './crypto.js';
import { login, logout, setup, needsSetup, isAuthenticated, requireAuth } from './auth.js';
import { providerCatalog, generateWithFallback, listModels, PROVIDERS } from './ai/index.js';
import { think } from './brain.js';
import * as fb from './facebook/graph.js';
import { handleWebhook, approveQueueItem, rejectQueueItem, executeMessage } from './engine.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '2mb', verify: (req, _res, buf) => (req.rawBody = buf) }));

const baseUrl = (req) => config.publicUrl || `${req.protocol}://${req.get('host')}`;
const wrap = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((err) => res.status(err.httpStatus || 400).json({ error: err.message }));

/* ------------------------------- Webhook -------------------------------- */

app.get('/webhook', (req, res) => {
  const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;
  if (mode === 'subscribe' && token && safeEqual(token, store.settings.facebook.verifyToken)) {
    store.log('info', '✅ Webhook vérifié par Facebook');
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

app.post('/webhook', (req, res) => {
  const secret = decrypt(store.settings.facebook.appSecret);
  if (secret) {
    const expected = `sha256=${crypto.createHmac('sha256', secret).update(req.rawBody || '').digest('hex')}`;
    if (!safeEqual(req.get('x-hub-signature-256') || '', expected)) {
      store.log('warn', 'Webhook rejeté : signature invalide (vérifiez la clé secrète de l’app)');
      return res.sendStatus(401);
    }
  }
  // Facebook exige une réponse rapide : on accuse réception puis on traite en arrière-plan.
  res.sendStatus(200);
  handleWebhook(req.body).catch((err) => store.log('error', `Webhook : ${err.message}`, { error: err.stack }));
});

/* ---------------------------- Authentification --------------------------- */

app.get('/api/session', (req, res) => res.json({ authenticated: isAuthenticated(req), needsSetup: needsSetup() }));
app.post('/api/login', login);
app.post('/api/setup', setup);
app.post('/api/logout', logout);

/* --------------------------- Connexion Facebook -------------------------- */

const oauthStates = new Map();

app.get('/api/facebook/login-url', requireAuth, (req, res) => {
  const { appId, appSecret } = store.settings.facebook;
  if (!appId || !appSecret) return res.status(400).json({ error: 'Renseignez d’abord l’ID et la clé secrète de votre app Facebook.' });
  const state = randomId(16);
  oauthStates.set(state, Date.now());
  res.json({ url: fb.oauthDialogUrl(appId, `${baseUrl(req)}/auth/facebook/callback`, state) });
});

app.get('/auth/facebook/callback', async (req, res) => {
  const { code, state, error_description: denied } = req.query;
  const created = oauthStates.get(state);
  oauthStates.delete(state);
  if (!isAuthenticated(req) || !created || Date.now() - created > 15 * 60_000) return res.redirect('/#facebook?oauth=expired');
  if (denied || !code) return res.redirect(`/#facebook?oauth=error&msg=${encodeURIComponent(denied || 'annulé')}`);
  try {
    const { appId, appSecret } = store.settings.facebook;
    const short = await fb.exchangeCode(appId, decrypt(appSecret), `${baseUrl(req)}/auth/facebook/callback`, code);
    const n = await importPages(short.access_token);
    res.redirect(`/#facebook?oauth=ok&pages=${n}`);
  } catch (err) {
    res.redirect(`/#facebook?oauth=error&msg=${encodeURIComponent(err.message)}`);
  }
});

async function importPages(userToken) {
  const { appId, appSecret } = store.settings.facebook;
  let token = userToken;
  if (appId && appSecret) {
    try {
      token = (await fb.longLivedToken(appId, decrypt(appSecret), userToken)).access_token || userToken;
    } catch (err) {
      store.log('warn', `Jeton longue durée impossible : ${err.message}`);
    }
  }
  const pages = await fb.listPages(token);
  for (const p of pages) {
    const existing = store.data.pages.find((x) => x.id === p.id);
    const data = { id: p.id, name: p.name, category: p.category, picture: p.picture?.data?.url || '', accessToken: encrypt(p.access_token) };
    if (existing) Object.assign(existing, data);
    else store.data.pages.push({ ...data, active: false, subscribed: false, addedAt: Date.now() });
  }
  store.log('info', `📄 ${pages.length} page(s) Facebook importée(s)`);
  store.save();
  return pages.length;
}

app.post('/api/facebook/manual-token', requireAuth, wrap(async (req, res) => {
  const token = String(req.body?.token || '').trim();
  if (!token) throw new Error('Collez un jeton d’accès');
  // Jeton de page directement collé ? On le reconnaît via /me.
  const me = await fb.graph('me', { token, params: { fields: 'id,name' } });
  let n;
  try {
    n = await importPages(token);
  } catch {
    n = 0;
  }
  if (!n) {
    const existing = store.data.pages.find((x) => x.id === me.id);
    const data = { id: me.id, name: me.name, accessToken: encrypt(token) };
    if (existing) Object.assign(existing, data);
    else store.data.pages.push({ ...data, active: false, subscribed: false, addedAt: Date.now() });
    store.save();
    n = 1;
  }
  res.json({ ok: true, pages: n });
}));

app.post('/api/facebook/configure-webhook', requireAuth, wrap(async (req, res) => {
  const { appId, appSecret, verifyToken } = store.settings.facebook;
  if (!appId || !appSecret) throw new Error('ID et clé secrète de l’app requis');
  const url = `${baseUrl(req)}/webhook`;
  if (!url.startsWith('https://')) throw new Error(`Facebook exige une URL HTTPS publique (actuelle : ${url}). Définissez PUBLIC_URL.`);
  await fb.configureAppWebhook(appId, decrypt(appSecret), url, verifyToken);
  store.log('info', `🔗 Webhook configuré automatiquement : ${url}`);
  res.json({ ok: true, url });
}));

app.post('/api/pages/:id/activate', requireAuth, wrap(async (req, res) => {
  const page = store.data.pages.find((p) => p.id === req.params.id);
  if (!page) throw new Error('Page introuvable');
  await fb.subscribePage(page.id, decrypt(page.accessToken));
  Object.assign(page, { active: true, subscribed: true });
  store.log('info', `🟢 Assistante activée sur « ${page.name} »`);
  store.save();
  res.json({ ok: true });
}));

app.post('/api/pages/:id/deactivate', requireAuth, wrap(async (req, res) => {
  const page = store.data.pages.find((p) => p.id === req.params.id);
  if (!page) throw new Error('Page introuvable');
  await fb.unsubscribePage(page.id, decrypt(page.accessToken)).catch(() => {});
  Object.assign(page, { active: false, subscribed: false });
  store.log('info', `🔴 Assistante désactivée sur « ${page.name} »`);
  store.save();
  res.json({ ok: true });
}));

app.delete('/api/pages/:id', requireAuth, (req, res) => {
  store.data.pages = store.data.pages.filter((p) => p.id !== req.params.id);
  store.save();
  res.json({ ok: true });
});

/* ------------------------------- Réglages -------------------------------- */

function publicState(req) {
  const s = store.settings;
  return {
    webhookUrl: `${baseUrl(req)}/webhook`,
    callbackUrl: `${baseUrl(req)}/auth/facebook/callback`,
    publicUrlConfigured: Boolean(config.publicUrl),
    catalog: providerCatalog(),
    settings: {
      ...s,
      facebook: { appId: s.facebook.appId, verifyToken: s.facebook.verifyToken, appSecret: mask(s.facebook.appSecret) },
      providers: s.providers.map((p) => ({ ...p, apiKey: mask(p.apiKey) })),
    },
    pages: store.data.pages.map(({ accessToken, ...p }) => ({ ...p, hasToken: Boolean(accessToken) })),
    pendingCount: store.data.queue.filter((q) => q.status === 'pending').length,
  };
}

app.get('/api/state', requireAuth, (req, res) => res.json(publicState(req)));

app.put('/api/settings/facebook', requireAuth, (req, res) => {
  const f = store.settings.facebook;
  const { appId, appSecret, verifyToken } = req.body || {};
  if (appId !== undefined) f.appId = String(appId).trim();
  if (appSecret) f.appSecret = encrypt(String(appSecret).trim());
  if (verifyToken) f.verifyToken = String(verifyToken).trim();
  store.save();
  res.json({ ok: true });
});

const SECTIONS = ['persona', 'automation', 'knowledge', 'rules', 'examples'];
app.put('/api/settings/:section', requireAuth, (req, res) => {
  const { section } = req.params;
  if (!SECTIONS.includes(section)) return res.status(404).json({ error: 'Section inconnue' });
  const value = req.body?.value;
  if (Array.isArray(store.settings[section])) {
    if (!Array.isArray(value)) return res.status(400).json({ error: 'Liste attendue' });
    store.settings[section] = value.map((v) => ({ id: v.id || randomId(), ...v }));
  } else {
    store.settings[section] = deepMerge(store.settings[section], value || {});
  }
  store.save();
  res.json({ ok: true, value: store.settings[section] });
});

function deepMerge(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = v && typeof v === 'object' && !Array.isArray(v) && a?.[k] ? deepMerge(a[k], v) : v;
  return out;
}

/* ---------------------------------- IA ----------------------------------- */

app.post('/api/providers', requireAuth, (req, res) => {
  const { type, name, apiKey, model, baseUrl: url } = req.body || {};
  if (!PROVIDERS[type]) return res.status(400).json({ error: 'Type d’IA inconnu' });
  const p = { id: randomId(), type, name: name || PROVIDERS[type].label, apiKey: encrypt(apiKey || ''), model: model || PROVIDERS[type].defaultModel, baseUrl: url || '', enabled: true };
  store.settings.providers.push(p);
  store.save();
  res.json({ ok: true, id: p.id });
});

app.put('/api/providers/order', requireAuth, (req, res) => {
  const ids = req.body?.ids || [];
  store.settings.providers.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
  store.save();
  res.json({ ok: true });
});

app.put('/api/providers/:id', requireAuth, (req, res) => {
  const p = store.settings.providers.find((x) => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'IA introuvable' });
  const { name, apiKey, model, baseUrl: url, enabled } = req.body || {};
  if (name !== undefined) p.name = name;
  if (apiKey) p.apiKey = encrypt(apiKey);
  if (model !== undefined) p.model = model;
  if (url !== undefined) p.baseUrl = url;
  if (enabled !== undefined) p.enabled = Boolean(enabled);
  store.save();
  res.json({ ok: true });
});

app.delete('/api/providers/:id', requireAuth, (req, res) => {
  store.settings.providers = store.settings.providers.filter((x) => x.id !== req.params.id);
  store.save();
  res.json({ ok: true });
});

app.post('/api/providers/:id/test', requireAuth, wrap(async (req, res) => {
  const p = store.settings.providers.find((x) => x.id === req.params.id);
  if (!p) throw new Error('IA introuvable');
  const out = await generateWithFallback([{ ...p, enabled: true }], {
    system: 'Tu es un test de connexion. Réponds en une courte phrase en français.',
    messages: [{ role: 'user', text: 'Dis bonjour et indique quel modèle tu es.' }],
    maxTokens: 1024,
  });
  if (out.errors.length) throw new Error(out.errors.join(' | '));
  res.json({ ok: true, text: out.text, ms: out.ms });
}));

app.get('/api/providers/:id/models', requireAuth, wrap(async (req, res) => {
  const p = store.settings.providers.find((x) => x.id === req.params.id);
  if (!p) throw new Error('IA introuvable');
  res.json({ models: await listModels(p) });
}));

/* ---------------------------- Simulateur ---------------------------------- */

app.post('/api/playground', requireAuth, wrap(async (req, res) => {
  const { channel = 'message', history = [], postContext = '', userName = '' } = req.body || {};
  if (!history.length) throw new Error('Écrivez un message');
  const result = await think(store.settings, {
    channel,
    history: history.slice(-20).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', text: String(m.text || '') })),
    postContext,
    userName,
  });
  res.json(result);
}));

/* ------------------------ File d'approbation ------------------------------ */

app.get('/api/queue', requireAuth, (req, res) => {
  const status = req.query.status || 'pending';
  res.json(store.data.queue.filter((q) => status === 'all' || q.status === status).slice(0, 200));
});
app.post('/api/queue/:id/approve', requireAuth, wrap(async (req, res) => res.json(await approveQueueItem(req.params.id, req.body || {}))));
app.post('/api/queue/:id/reject', requireAuth, wrap(async (req, res) => res.json(rejectQueueItem(req.params.id))));

/* ----------------------------- Conversations ----------------------------- */

app.get('/api/conversations', requireAuth, (_req, res) => {
  const list = Object.values(store.data.conversations)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 200)
    .map(({ messages, ...c }) => ({ ...c, last: messages[messages.length - 1], count: messages.length }));
  res.json(list);
});

const convByKey = (key) => {
  const c = store.data.conversations[key];
  if (!c) throw Object.assign(new Error('Conversation introuvable'), { httpStatus: 404 });
  return c;
};

app.get('/api/conversations/:key', requireAuth, wrap(async (req, res) => res.json(convByKey(req.params.key))));

app.post('/api/conversations/:key/pause', requireAuth, wrap(async (req, res) => {
  const c = convByKey(req.params.key);
  const hours = Number(req.body?.hours ?? 24);
  c.pausedUntil = hours > 0 ? Date.now() + hours * 3600_000 : 0;
  if (hours <= 0) c.needsHuman = false;
  store.save();
  res.json({ ok: true, pausedUntil: c.pausedUntil });
}));

app.post('/api/conversations/:key/send', requireAuth, wrap(async (req, res) => {
  const c = convByKey(req.params.key);
  const text = String(req.body?.text || '').trim();
  if (!text) throw new Error('Message vide');
  await executeMessage({ pageId: c.pageId, targetId: c.userId, userName: c.name, result: { provider: 'humain' } }, text);
  c.needsHuman = false;
  store.save();
  res.json({ ok: true });
}));

/* ------------------------- Prospects, stats, logs ------------------------ */

app.get('/api/leads', requireAuth, (_req, res) => res.json(store.data.leads));
app.put('/api/leads/:id', requireAuth, (req, res) => {
  const lead = store.data.leads.find((l) => l.id === req.params.id);
  if (!lead) return res.status(404).json({ error: 'Prospect introuvable' });
  for (const k of ['name', 'phone', 'email', 'interest', 'status', 'note']) if (req.body?.[k] !== undefined) lead[k] = String(req.body[k]);
  store.save();
  res.json(lead);
});
app.delete('/api/leads/:id', requireAuth, (req, res) => {
  store.data.leads = store.data.leads.filter((l) => l.id !== req.params.id);
  store.save();
  res.json({ ok: true });
});
app.get('/api/leads.csv', requireAuth, (_req, res) => {
  const cols = ['name', 'phone', 'email', 'interest', 'status', 'channel', 'note', 'createdAt'];
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = store.data.leads.map((l) => cols.map((c) => esc(c === 'createdAt' ? new Date(l[c]).toISOString() : l[c])).join(','));
  res.setHeader('content-type', 'text/csv; charset=utf-8');
  res.setHeader('content-disposition', 'attachment; filename="prospects.csv"');
  res.send(`﻿${cols.join(',')}\n${rows.join('\n')}`);
});

app.get('/api/stats', requireAuth, (_req, res) => res.json(store.data.stats));
app.get('/api/logs', requireAuth, (_req, res) => res.json(store.data.logs.slice(0, 300)));

app.get('/api/export', requireAuth, (_req, res) => {
  const { providers, facebook, ...rest } = store.settings;
  res.setHeader('content-disposition', 'attachment; filename="ainai-reglages.json"');
  res.json({ version: 1, exportedAt: new Date().toISOString(), settings: rest });
});

app.post('/api/import', requireAuth, (req, res) => {
  const s = req.body?.settings;
  if (!s || typeof s !== 'object') return res.status(400).json({ error: 'Fichier invalide' });
  for (const k of SECTIONS) if (s[k] !== undefined) store.settings[k] = s[k];
  store.save();
  res.json({ ok: true });
});

/* --------------------------------- Site ----------------------------------- */

app.get('/healthz', (_req, res) => res.json({ ok: true }));
app.get(['/privacy', '/confidentialite'], (_req, res) => res.sendFile(path.join(here, '..', 'public', 'privacy.html')));
app.use(express.static(path.join(here, '..', 'public')));

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  app.listen(config.port, () => {
    console.log(`AINAI prêt sur http://localhost:${config.port}`);
    if (!config.publicUrl) console.log('⚠️  PUBLIC_URL non défini : nécessaire pour le webhook Facebook (HTTPS).');
  });
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => (store.flush(), process.exit(0)));
}
