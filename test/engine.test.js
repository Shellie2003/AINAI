import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';

const { store } = await import('../src/store.js');
const { encrypt } = await import('../src/crypto.js');
const { deps, handleWebhook, approveQueueItem } = await import('../src/engine.js');

const PAGE = 'page1';
let sent;

function reset(result = {}) {
  sent = [];
  Object.assign(store.data, { pages: [{ id: PAGE, name: 'Ma Page', accessToken: encrypt('tok'), active: true }], conversations: {}, queue: [], leads: [], processed: [], sentIds: [] });
  const a = store.settings.automation;
  a.replyDelay = { min: 0, max: 0 };
  a.messages.aggregateSeconds = 0;
  a.comments.mode = 'auto';
  a.messages.mode = 'auto';
  store.settings.facebook.appId = 'APP';
  store.settings.examples = [];
  const record = (name) => async (...args) => (sent.push([name, ...args.slice(1)]), { id: `id-${sent.length}`, message_id: `mid-${sent.length}`, recipient_id: 'psid-from-comment' });
  deps.fb = {
    getPostText: async () => 'Nouvelle collection',
    getUserName: async () => 'Rabe',
    downloadMedia: async () => ({ mime: 'image/jpeg', base64: 'xx' }),
    replyToComment: record('reply'),
    likeComment: record('like'),
    hideComment: record('hide'),
    privateReply: record('private'),
    sendMessage: record('send'),
    senderAction: async () => {},
  };
  deps.sleep = async () => {};
  deps.calls = [];
  deps.think = async (_s, ctx) => {
    deps.calls.push(ctx);
    return { reply: 'Merci !', privateMessage: '', intent: 'question', sentiment: 'positif', needsHuman: false, hide: false, lead: { name: '', phone: '', email: '', interest: '' }, provider: 'Test', ...result };
  };
}

const wait = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const comment = (extra = {}) => ({
  object: 'page',
  entry: [{ id: PAGE, changes: [{ field: 'feed', value: { item: 'comment', verb: 'add', comment_id: 'c1', post_id: 'p1', parent_id: 'p1', message: 'Prix svp ?', from: { id: 'u1', name: 'Soa' }, ...extra } }] }],
});
const dm = (text, mid = `m-${Math.random()}`, extra = {}) => ({
  object: 'page',
  entry: [{ id: PAGE, messaging: [{ sender: { id: 'u2' }, recipient: { id: PAGE }, timestamp: Date.now(), message: { mid, text, ...extra } }] }],
});

test('commentaire : réponse publique, like et MP privé pour un prospect', async () => {
  reset({ privateMessage: 'Voici nos tarifs…', intent: 'achat' });
  await handleWebhook(comment());
  assert.deepEqual(sent.map((s) => s[0]), ['reply', 'like', 'private']);
  assert.equal(sent[0][2], 'Merci !');
  assert.equal(deps.calls[0].postContext, 'Nouvelle collection');
  assert.equal(store.data.leads.length, 1);
  // Facebook renvoie le même événement : pas de double réponse
  await handleWebhook(comment());
  assert.equal(sent.length, 3);
});

test('commentaire : spam masqué sans réponse, et commentaires de la page ignorés', async () => {
  reset({ hide: true, intent: 'spam', sentiment: 'negatif' });
  await handleWebhook(comment());
  assert.deepEqual(sent.map((s) => s[0]), ['hide']);
  reset();
  await handleWebhook(comment({ comment_id: 'c2', from: { id: PAGE, name: 'Ma Page' } }));
  assert.equal(sent.length, 0);
});

test('messages en rafale regroupés en une seule réponse avec mémoire', async () => {
  reset();
  store.settings.automation.messages.aggregateSeconds = 0.05;
  await handleWebhook(dm('Bonjour'));
  await handleWebhook(dm('je voudrais une robe'));
  await wait(150);
  assert.equal(deps.calls.length, 1);
  assert.deepEqual(deps.calls[0].history.map((m) => m.text), ['Bonjour', 'je voudrais une robe']);
  assert.deepEqual(sent.map((s) => s[0]), ['send']);
  assert.equal(store.conversation(PAGE, 'u2').messages.at(-1).text, 'Merci !');
});

test('image transmise à l’IA', async () => {
  reset();
  await handleWebhook(dm('', 'mimg', { attachments: [{ type: 'image', payload: { url: 'https://x/img.jpg' } }] }));
  await wait();
  assert.equal(deps.calls[0].history.at(-1).media[0].mime, 'image/jpeg');
});

test('prise en main humaine : le bot se met en pause', async () => {
  reset();
  await handleWebhook({ object: 'page', entry: [{ id: PAGE, messaging: [{ sender: { id: PAGE }, recipient: { id: 'u2' }, timestamp: Date.now(), message: { mid: 'human1', text: 'Je m’en occupe', is_echo: true, app_id: 263902037430900 } }] }] });
  assert.ok(store.conversation(PAGE, 'u2').pausedUntil > Date.now());
  await handleWebhook(dm('Alors ?'));
  await wait();
  assert.equal(sent.length, 0);
  // L'écho de nos propres messages ne déclenche pas la pause
  reset();
  await handleWebhook({ object: 'page', entry: [{ id: PAGE, messaging: [{ sender: { id: PAGE }, recipient: { id: 'u3' }, timestamp: Date.now(), message: { mid: 'bot1', text: 'auto', is_echo: true, app_id: 'APP' } }] }] });
  assert.equal(store.conversation(PAGE, 'u3').pausedUntil, 0);
});

test('mode copilote : brouillon validé et correction mémorisée', async () => {
  reset();
  store.settings.automation.comments.mode = 'approval';
  await handleWebhook(comment());
  assert.equal(sent.length, 0);
  const item = store.data.queue[0];
  assert.equal(item.status, 'pending');
  await approveQueueItem(item.id, { reply: 'Merci Soa, je vous écris en MP 😊' });
  assert.equal(sent[0][2], 'Merci Soa, je vous écris en MP 😊');
  assert.equal(store.settings.examples.at(-1).output, 'Merci Soa, je vous écris en MP 😊');
});

test('« SUPPRIMER » efface les données de la personne', async () => {
  reset();
  await handleWebhook(dm('Bonjour'));
  await wait();
  store.data.leads.push({ pageId: PAGE, userId: 'u2' });
  await handleWebhook(dm('supprimer'));
  assert.equal(store.data.conversations[`${PAGE}:u2`], undefined);
  assert.equal(store.data.leads.length, 0);
  assert.match(sent.at(-1)[2], /supprimées/);
});
