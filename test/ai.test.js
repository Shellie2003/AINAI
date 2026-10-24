import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';

const { generateWithFallback } = await import('../src/ai/index.js');
const { encrypt } = await import('../src/crypto.js');

test('bascule automatiquement sur l’IA suivante quand Gemini dépasse son quota', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push(String(url));
    if (String(url).includes('generativelanguage')) {
      return new Response(JSON.stringify({ error: { message: 'Quota exceeded' } }), { status: 429, headers: { 'content-type': 'application/json' } });
    }
    const body = JSON.parse(init.body);
    assert.equal(body.messages[0].role, 'system');
    assert.equal(init.headers.authorization, 'Bearer gsk-test');
    return Response.json({ choices: [{ message: { content: '{"reply":"Bonjour"}' } }], usage: {} });
  });
  const providers = [
    { id: 'g', type: 'gemini', name: 'Gemini', apiKey: encrypt('AIza-test'), model: 'gemini-2.5-flash', enabled: true },
    { id: 'q', type: 'groq', name: 'Groq', apiKey: encrypt('gsk-test'), enabled: true },
  ];
  const out = await generateWithFallback(providers, { system: 'sys', messages: [{ role: 'user', text: 'Salut' }], json: true });
  assert.equal(out.provider, 'Groq');
  assert.equal(out.text, '{"reply":"Bonjour"}');
  assert.equal(out.errors.length, 1);
  assert.match(calls[0], /gemini-2\.5-flash:generateContent/);

  // Gemini est en pause (quota) : on ne le rappelle pas tout de suite
  calls.length = 0;
  await generateWithFallback(providers, { system: 'sys', messages: [{ role: 'user', text: 'Re' }] });
  assert.equal(calls.filter((u) => u.includes('generativelanguage')).length, 0);
});

test('Gemini : envoie le prompt système, les médias et ignore les pensées', async (t) => {
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    const body = JSON.parse(init.body);
    assert.equal(body.systemInstruction.parts[0].text, 'sys');
    assert.equal(body.contents[1].role, 'model');
    assert.equal(body.contents[2].parts[0].inlineData.mimeType, 'audio/mp4');
    assert.equal(init.headers['x-goog-api-key'], 'AIza-ok');
    return Response.json({ candidates: [{ content: { parts: [{ thought: true, text: 'je réfléchis' }, { text: 'Réponse' }] } }] });
  });
  const out = await generateWithFallback([{ id: 'g2', type: 'gemini', apiKey: encrypt('AIza-ok') }], {
    system: 'sys',
    messages: [
      { role: 'user', text: 'a' },
      { role: 'assistant', text: 'b' },
      { role: 'user', text: 'vocal', media: [{ mime: 'audio/mp4', base64: 'AAAA' }] },
    ],
  });
  assert.equal(out.text, 'Réponse');
});

test('erreur claire quand aucune IA n’est configurée', async () => {
  await assert.rejects(generateWithFallback([], { system: '', messages: [] }), /Aucune IA/);
});

test('modèle Gemini retiré (404) : bascule sur le modèle conseillé par Google et le retient', async (t) => {
  const urls = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    urls.push(String(url));
    if (String(url).includes('gemini-2.5-flash:')) {
      return Response.json({ error: { message: 'This model models/gemini-2.5-flash is no longer available to new users. Please update your code to use models/gemini-3.8-flash for the latest features.' } }, { status: 404 });
    }
    return Response.json({ candidates: [{ content: { parts: [{ text: 'Salut' }] } }] });
  });
  const provider = { id: 'old', type: 'gemini', apiKey: encrypt('k'), model: 'gemini-2.5-flash' };
  const out = await generateWithFallback([provider], { system: 's', messages: [{ role: 'user', text: 'a' }] });
  assert.equal(out.text, 'Salut');
  assert.equal(out.model, 'gemini-3.8-flash');
  assert.equal(provider.model, 'gemini-3.8-flash'); // mémorisé
  assert.match(urls[1], /gemini-3\.8-flash:generateContent/);
});

test('modèle retiré sans suggestion : choix du meilleur « flash » disponible', async (t) => {
  const { pickBestModel } = await import('../src/ai/gemini.js');
  assert.equal(pickBestModel(['gemini-3.8-flash-lite', 'gemini-3.8-flash', 'gemini-4.0-flash-preview', 'gemini-3.5-flash', 'gemini-3.8-pro', 'gemini-3.8-flash-image'], 'x'), 'gemini-3.8-flash');
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (String(url).includes('/models?')) return Response.json({ models: [{ name: 'models/gemini-3.5-flash', supportedGenerationMethods: ['generateContent'] }, { name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] }] });
    if (String(url).includes('ancien:')) return Response.json({ error: { message: 'not found' } }, { status: 404 });
    return Response.json({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] });
  });
  const out = await generateWithFallback([{ id: 'p2', type: 'gemini', apiKey: encrypt('k'), model: 'ancien' }], { system: 's', messages: [{ role: 'user', text: 'a' }] });
  assert.equal(out.model, 'gemini-3.8-flash');
});
