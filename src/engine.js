import * as graph from './facebook/graph.js';
import { think } from './brain.js';
import { store } from './store.js';
import { decrypt, randomId } from './crypto.js';

// Dépendances remplaçables dans les tests.
export const deps = { fb: { ...graph }, think, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) };

const buffers = new Map(); // regroupement des messages envoyés en rafale
const postCache = new Map();

const randomDelay = ({ min = 0, max = 0 } = {}) => (Math.max(0, min) + Math.random() * Math.max(0, max - min)) * 1000;

function pageById(id) {
  const page = store.data.pages.find((p) => p.id === id);
  return page && page.active !== false ? { ...page, token: decrypt(page.accessToken) } : null;
}

export async function handleWebhook(body) {
  if (body?.object !== 'page') return;
  for (const entry of body.entry || []) {
    const page = pageById(entry.id);
    if (!page) continue;
    for (const event of entry.messaging || []) await safe(() => onMessaging(page, event), 'message');
    for (const change of entry.changes || []) await safe(() => onFeedChange(page, change), 'commentaire');
  }
}

async function safe(fn, what) {
  try {
    await fn();
  } catch (err) {
    store.log('error', `Erreur de traitement (${what}) : ${err.message}`, { error: err.stack });
  }
}

/* ----------------------------- Commentaires ----------------------------- */

async function onFeedChange(page, change) {
  const v = change.value || {};
  if (change.field !== 'feed' || v.item !== 'comment' || v.verb !== 'add') return;
  const auto = store.settings.automation.comments;
  if (!auto.enabled || auto.mode === 'off') return;
  if (v.from?.id === page.id) return; // commentaire de la page elle-même (bot ou admin)
  if (auto.ignoreReplies && v.parent_id && v.parent_id !== v.post_id) return;
  if (!v.message?.trim()) return;
  if (!store.markProcessed(`c:${v.comment_id}`)) return;

  store.bumpStat('comments_in');
  let postContext = postCache.get(v.post_id);
  if (postContext === undefined) {
    postContext = await deps.fb.getPostText(page.token, v.post_id);
    postCache.set(v.post_id, postContext);
    if (postCache.size > 500) postCache.delete(postCache.keys().next().value);
  }

  const started = Date.now();
  const result = await deps.think(store.settings, {
    channel: 'comment',
    history: [{ role: 'user', text: v.message }],
    userName: v.from?.name,
    postContext,
  });
  const item = {
    id: randomId(),
    channel: 'comment',
    pageId: page.id,
    pageName: page.name,
    targetId: v.comment_id,
    postId: v.post_id,
    userId: v.from?.id,
    userName: v.from?.name || '',
    incoming: v.message,
    result,
    createdAt: Date.now(),
  };
  track(item);

  if (result.hide && auto.hideNegative) {
    await deps.fb.hideComment(page.token, v.comment_id);
    store.bumpStat('hidden');
    store.log('warn', `Commentaire masqué (${result.intent}) de ${item.userName} : « ${v.message} »`, { channel: 'comment' });
    return;
  }
  if (!result.reply && !result.privateMessage) return;
  if (auto.mode === 'approval') return enqueue(item);
  await deps.sleep(Math.max(0, randomDelay(store.settings.automation.replyDelay) - (Date.now() - started)));
  await executeComment(item, result.reply, result.privateMessage);
}

export async function executeComment(item, reply, privateMessage) {
  const page = pageById(item.pageId);
  if (!page) throw new Error('Page introuvable ou désactivée');
  const auto = store.settings.automation.comments;
  if (reply) {
    const res = await deps.fb.replyToComment(page.token, item.targetId, reply);
    store.rememberSent(res?.id);
    store.bumpStat('comments_out');
  }
  if (auto.likeComments && item.result?.sentiment !== 'negatif') await deps.fb.likeComment(page.token, item.targetId).catch(() => {});
  if (privateMessage && auto.privateReplyOnLead) {
    try {
      const res = await deps.fb.privateReply(page.token, page.id, item.targetId, privateMessage);
      store.rememberSent(res?.message_id);
      store.bumpStat('private_replies');
      if (res?.recipient_id) {
        const conv = store.conversation(page.id, res.recipient_id);
        conv.name ||= item.userName;
        store.addToConversation(conv, 'assistant', privateMessage);
      }
    } catch (err) {
      store.log('warn', `MP privé impossible pour ${item.userName} : ${err.message}`);
    }
  }
  store.log('info', `💬 Réponse au commentaire de ${item.userName} : « ${reply || privateMessage} »`, {
    channel: 'comment',
    provider: item.result?.provider,
  });
}

/* ------------------------------- Messenger ------------------------------ */

async function onMessaging(page, event) {
  const msg = event.message;
  if (msg?.is_echo) return onEcho(page, event);
  const auto = store.settings.automation.messages;
  if (!auto.enabled || auto.mode === 'off') return;
  if (!msg && !event.postback) return; // accusés de lecture / livraison
  const id = msg?.mid || `${event.sender.id}:${event.timestamp}:pb`;
  if (!store.markProcessed(`m:${id}`)) return;

  const userId = event.sender.id;
  const conv = store.conversation(page.id, userId);
  if (!conv.name) conv.name = await deps.fb.getUserName(page.token, userId);

  let text = msg?.quick_reply?.payload && !msg.text ? msg.quick_reply.payload : msg?.text || event.postback?.title || '';
  const media = [];
  for (const a of msg?.attachments || []) {
    if (!a.payload?.url) continue;
    if (['image', 'audio', 'video', 'file'].includes(a.type)) {
      const file = await deps.fb.downloadMedia(a.payload.url);
      if (file) media.push(file);
      text += ` [${{ image: 'photo', audio: 'message vocal', video: 'vidéo', file: 'fichier' }[a.type]} envoyé]`;
    }
  }
  text = text.trim();
  if (!text && !media.length) return;
  if (/^(supprimer|delete|fafao)$/i.test(text)) return forgetUser(page, conv);

  store.bumpStat('messages_in');
  store.addToConversation(conv, 'user', text);

  if (conv.pausedUntil > Date.now()) {
    store.log('info', `⏸️ ${conv.name || userId} a écrit pendant la prise en main humaine – le bot reste silencieux.`, { channel: 'message' });
    return;
  }

  // On attend quelques secondes : les gens envoient souvent plusieurs messages d'affilée.
  const key = conv.key;
  const buf = buffers.get(key) || { media: [] };
  clearTimeout(buf.timer);
  buf.media.push(...media);
  buf.timer = setTimeout(() => {
    buffers.delete(key);
    safe(() => replyToConversation(page, conv, buf.media), 'message');
  }, Math.max(0, Number(auto.aggregateSeconds) || 0) * 1000);
  buffers.set(key, buf);
}

// Droit à l'effacement annoncé dans la politique de confidentialité.
async function forgetUser(page, conv) {
  delete store.data.conversations[conv.key];
  store.data.leads = store.data.leads.filter((l) => !(l.pageId === page.id && l.userId === conv.userId));
  store.data.queue = store.data.queue.filter((q) => !(q.pageId === page.id && q.userId === conv.userId));
  store.save();
  store.log('info', `🗑️ Données supprimées à la demande de ${conv.name || conv.userId}`);
  const res = await deps.fb.sendMessage(page.token, conv.userId, 'Vos données ont bien été supprimées ✅');
  store.rememberSent(res?.message_id);
}

async function onEcho(page, event) {
  const msg = event.message;
  const ours = (msg.app_id && String(msg.app_id) === String(store.settings.facebook.appId)) || store.wasSentByBot(msg.mid);
  if (ours) return;
  // Un humain a répondu depuis la boîte de réception : le bot se met en pause pour cette personne.
  const conv = store.conversation(page.id, event.recipient.id);
  const hours = Number(store.settings.automation.humanTakeoverHours) || 0;
  if (msg.text) store.addToConversation(conv, 'assistant', msg.text);
  if (hours > 0) {
    conv.pausedUntil = Date.now() + hours * 3600_000;
    store.log('info', `🙋 Prise en main humaine détectée pour ${conv.name || event.recipient.id} : bot en pause ${hours} h.`, { channel: 'message' });
  }
  store.save();
}

async function replyToConversation(page, conv, media) {
  const auto = store.settings.automation.messages;
  const history = conv.messages.slice(-(Number(auto.memorySize) || 12)).map((m) => ({ role: m.role, text: m.text }));
  if (media.length && history.length) history[history.length - 1].media = media;
  // « Vu » + « en train d'écrire… » tout de suite (sans attendre la réponse de Facebook) : le client sait qu'on l'a lu
  deps.fb.senderAction(page.token, conv.userId, 'mark_seen');
  if (auto.mode !== 'approval') deps.fb.senderAction(page.token, conv.userId, 'typing_on');

  const started = Date.now();
  const result = await deps.think(store.settings, { channel: 'message', history, userName: conv.name });
  const item = {
    id: randomId(),
    channel: 'message',
    pageId: page.id,
    pageName: page.name,
    targetId: conv.userId,
    userId: conv.userId,
    userName: conv.name,
    incoming: history.filter((m) => m.role === 'user').slice(-3).map((m) => m.text).join('\n'),
    result,
    createdAt: Date.now(),
  };
  track(item);
  if (result.needsHuman) {
    conv.needsHuman = true;
    store.save();
  }
  const reply = result.reply || (result.needsHuman ? store.settings.automation.escalationMessage : '');
  if (!reply) return;
  if (auto.mode === 'approval') return enqueue({ ...item, result: { ...result, reply } });
  // Le temps de réflexion de l'IA compte déjà dans le délai « humain » : on n'attend que le reste
  await deps.sleep(Math.max(0, randomDelay(store.settings.automation.replyDelay) - (Date.now() - started)));
  await executeMessage(item, reply);
}

export async function executeMessage(item, reply) {
  const page = pageById(item.pageId);
  if (!page) throw new Error('Page introuvable ou désactivée');
  const res = await deps.fb.sendMessage(page.token, item.targetId, reply);
  store.rememberSent(res?.message_id);
  store.bumpStat('messages_out');
  store.addToConversation(store.conversation(item.pageId, item.targetId), 'assistant', reply);
  store.log('info', `✉️ MP à ${item.userName || item.targetId} : « ${reply} »`, { channel: 'message', provider: item.result?.provider });
}

/* ------------------------- Suivi, file d'attente ------------------------ */

function track(item) {
  const r = item.result;
  store.bumpStat(`intent_${r.intent}`);
  store.bumpStat(`sentiment_${r.sentiment}`);
  if (r.provider) store.bumpStat(`provider_${r.provider}`);
  if (r.needsHuman) store.bumpStat('needs_human');
  if (r.fallbackErrors?.length) store.log('warn', `IA de secours utilisée (${r.provider}) : ${r.fallbackErrors.join(' | ')}`);
  if (r.modelChanged) store.log('warn', `🔄 Modèle ${r.modelChanged.from} retiré par le fournisseur : remplacé automatiquement par ${r.modelChanged.to}`);
  const { phone, email } = r.lead || {};
  if (phone || email || r.intent === 'achat') saveLead(item, r.lead);
}

function saveLead(item, lead) {
  const existing = store.data.leads.find((l) => l.pageId === item.pageId && l.userId === item.userId);
  const data = {
    name: lead.name || item.userName,
    phone: lead.phone,
    email: lead.email,
    interest: lead.interest || item.incoming.slice(0, 200),
  };
  if (existing) {
    for (const [k, v] of Object.entries(data)) if (v) existing[k] = v;
    existing.updatedAt = Date.now();
  } else {
    store.data.leads.unshift({ id: randomId(), pageId: item.pageId, userId: item.userId, channel: item.channel, ...data, status: 'nouveau', createdAt: Date.now(), updatedAt: Date.now() });
    store.bumpStat('leads');
    store.log('info', `🎯 Nouveau prospect : ${data.name || item.userId} ${data.phone || data.email || ''}`.trim());
  }
  store.save();
}

function enqueue(item) {
  store.data.queue.unshift({ ...item, status: 'pending', draft: item.result.reply, draftPrivate: item.result.privateMessage || '' });
  store.data.queue.length = Math.min(store.data.queue.length, 500);
  store.log('info', `📝 Brouillon en attente de validation pour ${item.userName || item.targetId}`, { channel: item.channel });
  store.save();
}

/** Valide un brouillon (éventuellement corrigé). Les corrections deviennent des exemples d'apprentissage. */
export async function approveQueueItem(id, { reply, privateMessage, learn = true } = {}) {
  const item = store.data.queue.find((q) => q.id === id && q.status === 'pending');
  if (!item) throw new Error('Brouillon introuvable');
  const finalReply = reply ?? item.draft;
  const finalPrivate = privateMessage ?? item.draftPrivate;
  if (item.channel === 'comment') await executeComment(item, finalReply, finalPrivate);
  else await executeMessage(item, finalReply);
  item.status = 'sent';
  item.sentAt = Date.now();
  if (learn && finalReply && finalReply.trim() !== (item.draft || '').trim()) {
    store.settings.examples.push({ id: randomId(), input: item.incoming.slice(0, 500), output: finalReply, createdAt: Date.now() });
    store.settings.examples = store.settings.examples.slice(-40);
    store.log('info', '🧠 Correction mémorisée : l’assistante s’en inspirera pour les prochaines réponses.');
  }
  store.save();
  return item;
}

export function rejectQueueItem(id) {
  const item = store.data.queue.find((q) => q.id === id && q.status === 'pending');
  if (!item) throw new Error('Brouillon introuvable');
  item.status = 'rejected';
  store.save();
  return item;
}
