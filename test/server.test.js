import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const { app } = await import('../src/server.js');
const { store } = await import('../src/store.js');
const { encrypt } = await import('../src/crypto.js');

const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

test('vérification du webhook par Facebook', async () => {
  const token = store.settings.facebook.verifyToken;
  const ok = await fetch(`${base}/webhook?hub.mode=subscribe&hub.verify_token=${token}&hub.challenge=42`);
  assert.equal(await ok.text(), '42');
  const bad = await fetch(`${base}/webhook?hub.mode=subscribe&hub.verify_token=faux&hub.challenge=42`);
  assert.equal(bad.status, 403);
});

test('signature du webhook vérifiée avec la clé secrète', async () => {
  store.settings.facebook.appSecret = encrypt('appsecret');
  const body = JSON.stringify({ object: 'page', entry: [] });
  const sig = `sha256=${crypto.createHmac('sha256', 'appsecret').update(body).digest('hex')}`;
  const post = (s) => fetch(`${base}/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': s }, body });
  assert.equal((await post(sig)).status, 200);
  assert.equal((await post('sha256=00')).status, 401);
});

test('API protégée par mot de passe, clés jamais renvoyées en clair', async () => {
  assert.equal((await fetch(`${base}/api/state`)).status, 401);
  const bad = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"password":"non"}' });
  assert.equal(bad.status, 401);
  const res = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"password":"motdepasse-test"}' });
  const cookie = res.headers.get('set-cookie').split(';')[0];
  const headers = { cookie, 'content-type': 'application/json' };

  await fetch(`${base}/api/providers`, { method: 'POST', headers, body: JSON.stringify({ type: 'gemini', apiKey: 'AIzaSecretKey123456' }) });
  const state = await (await fetch(`${base}/api/state`, { headers })).json();
  assert.equal(state.settings.providers[0].model, 'gemini-2.5-flash');
  assert.ok(!JSON.stringify(state).includes('AIzaSecretKey123456'));
  assert.ok(!JSON.stringify(state).includes('appsecret'));

  const put = await fetch(`${base}/api/settings/facebook`, { method: 'PUT', headers, body: JSON.stringify({ appId: '999' }) });
  assert.equal(put.status, 200);
  assert.equal(store.settings.facebook.appId, '999');

  const persona = await fetch(`${base}/api/settings/persona`, { method: 'PUT', headers, body: JSON.stringify({ value: { businessName: 'Soa' } }) });
  assert.equal(persona.status, 200);
  assert.equal(store.settings.persona.businessName, 'Soa');
  assert.equal(store.settings.persona.tone, 'chaleureux, professionnel et concis');
});
