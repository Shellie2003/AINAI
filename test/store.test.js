import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';

const { Store } = await import('../src/store.js');
const { supabaseRemote } = await import('../src/supabase.js');

test('stockage distant : charge, regroupe les écritures et ne perd rien', async () => {
  const saved = [];
  const remote = { name: 'faux', load: async () => ({ settings: { persona: { businessName: 'Soa' } } }), save: async (d) => saved.push(structuredClone(d)) };
  const s = new Store({ remote });
  s.save(); // avant init : ignoré, pour ne pas écraser les données distantes
  await s.init();
  assert.equal(s.settings.persona.businessName, 'Soa');
  assert.equal(s.settings.persona.tone, 'chaleureux, professionnel et concis'); // valeurs par défaut fusionnées
  s.data.leads.push({ id: 1 });
  s.save();
  s.data.leads.push({ id: 2 });
  s.save();
  await s.flush();
  assert.equal(saved.length, 1);
  assert.equal(saved[0].leads.length, 2);
});

test('stockage distant : échec de chargement = arrêt, pas de base vide', async () => {
  const s = new Store({ remote: { name: 'panne', load: async () => { throw new Error('réseau'); }, save: async () => assert.fail('ne doit pas écrire') } });
  await assert.rejects(s.init({ retries: 2, delayMs: 1 }), /réseau/);
  s.save();
  await s.flush();
});

test('stockage distant : nouvelle sauvegarde après un échec d’écriture', async () => {
  let fail = true;
  const saved = [];
  const s = new Store({ remote: { name: 'x', load: async () => null, save: async (d) => { if (fail) throw new Error('500'); saved.push(d); } } });
  await s.init();
  s.save();
  await s.flush();
  assert.equal(saved.length, 0);
  assert.equal(s.dirty, true);
  fail = false;
  await s.flush();
  assert.equal(saved.length, 1);
  clearTimeout(s.timer);
});

test('Supabase : requêtes REST correctes', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push({ url: String(url), init });
    return init.method === 'POST' ? new Response(null, { status: 201 }) : Response.json([{ data: { leads: [] } }]);
  });
  const r = supabaseRemote('https://abc.supabase.co/', 'sb_secret_xyz');
  assert.deepEqual(await r.load(), { leads: [] });
  await r.save({ a: 1 });
  assert.equal(calls[0].url, 'https://abc.supabase.co/rest/v1/ainai_store?id=eq.main&select=data');
  assert.equal(calls[0].init.headers.apikey, 'sb_secret_xyz');
  assert.equal(calls[0].init.headers.authorization, undefined);
  assert.match(calls[1].init.headers.prefer, /merge-duplicates/);
  assert.equal(JSON.parse(calls[1].init.body).data.a, 1);
});
