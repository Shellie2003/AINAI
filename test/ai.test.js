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

test('Gemini surchargé (503) : nouvel essai, puis modèle de dépannage', async (t) => {
  const { geminiRetry } = await import('../src/ai/gemini.js');
  geminiRetry.delays = [0];
  // 1) 503 passager : le 2e essai réussit
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return calls === 1
      ? Response.json({ error: { message: 'high demand' } }, { status: 503 })
      : Response.json({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] });
  });
  const p1 = { id: 'r1', type: 'gemini', apiKey: encrypt('k'), model: 'gemini-3.8-flash' };
  assert.equal((await generateWithFallback([p1], { system: 's', messages: [{ role: 'user', text: 'a' }] })).text, 'ok');
  assert.equal(calls, 2);

  // 2) surcharge durable : bascule sur un autre modèle flash, sans changer le modèle enregistré
  t.mock.restoreAll();
  t.mock.method(globalThis, 'fetch', async (url) => {
    const u = String(url);
    if (u.includes('/models?')) return Response.json({ models: ['gemini-3.8-flash', 'gemini-3.8-flash-lite', 'gemini-3.8-pro'].map((n) => ({ name: `models/${n}`, supportedGenerationMethods: ['generateContent'] })) });
    if (u.includes('gemini-3.8-flash:')) return Response.json({ error: { message: 'high demand' } }, { status: 503 });
    return Response.json({ candidates: [{ content: { parts: [{ text: 'secours' }] } }] });
  });
  const p2 = { id: 'r2', type: 'gemini', apiKey: encrypt('k-surcharge'), model: 'gemini-3.8-flash' };
  const out = await generateWithFallback([p2], { system: 's', messages: [{ role: 'user', text: 'a' }] });
  assert.equal(out.text, 'secours');
  assert.equal(out.model, 'gemini-3.8-flash-lite');
  assert.equal(p2.model, 'gemini-3.8-flash');
});

test('Groq : modèle retiré → remplaçant choisi dans sa liste et mémorisé', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    const u = String(url);
    if (u.endsWith('/models')) return Response.json({ data: [{ id: 'whisper-large-v3' }, { id: 'llama-3.1-8b-instant' }, { id: 'openai/gpt-oss-120b' }, { id: 'meta-llama/llama-guard-4-12b' }] });
    const body = JSON.parse(init.body);
    if (body.model === 'llama-3.3-70b-versatile') return Response.json({ error: { message: 'The model `llama-3.3-70b-versatile` has been decommissioned', code: 'model_decommissioned' } }, { status: 400 });
    return Response.json({ choices: [{ message: { content: `{"reply":"via ${body.model}"}` } }] });
  });
  const groq = { id: 'g1', type: 'groq', apiKey: encrypt('gsk'), model: 'llama-3.3-70b-versatile' };
  const out = await generateWithFallback([groq], { system: 's', messages: [{ role: 'user', text: 'a' }], json: true });
  assert.equal(out.model, 'openai/gpt-oss-120b');
  assert.equal(groq.model, 'openai/gpt-oss-120b');
});

test('mode JSON refusé par un modèle : nouvel essai sans', async (t) => {
  const bodies = [];
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    const body = JSON.parse(init.body);
    bodies.push(body);
    if (body.response_format) return Response.json({ error: { message: 'response_format json_object is not supported by this model' } }, { status: 400 });
    return Response.json({ choices: [{ message: { content: '{"reply":"ok"}' } }] });
  });
  const out = await generateWithFallback([{ id: 'c1', type: 'cerebras', apiKey: encrypt('k') }], { system: 's', messages: [{ role: 'user', text: 'a' }], json: true });
  assert.equal(out.text, '{"reply":"ok"}');
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0].model, 'gpt-oss-120b');
  assert.equal(bodies[0].max_tokens, 2048);
});

test('choix du remplaçant OpenRouter : uniquement des modèles gratuits', async () => {
  const { pickOpenAiModel } = await import('../src/ai/openai.js');
  assert.equal(pickOpenAiModel(['openai/gpt-oss-120b', 'meta-llama/llama-3.3-70b-instruct:free', 'x/y:free'], 'z', 'openrouter'), 'meta-llama/llama-3.3-70b-instruct:free');
});

test('Gemini 3 : réflexion réglée au niveau bas ; réglage retiré si le modèle le refuse', async (t) => {
  const { thinkingConfigFor } = await import('../src/ai/gemini.js');
  assert.deepEqual(thinkingConfigFor('gemini-3.8-flash'), { thinkingLevel: 'low' });
  assert.deepEqual(thinkingConfigFor('gemini-2.5-flash'), { thinkingBudget: 0 });
  const bodies = [];
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    const body = JSON.parse(init.body);
    bodies.push(body);
    if (body.generationConfig.thinkingConfig) return Response.json({ error: { message: 'thinking_level is not supported for this model' } }, { status: 400 });
    return Response.json({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] });
  });
  const out = await generateWithFallback([{ id: 'th', type: 'gemini', apiKey: encrypt('k-th'), model: 'gemini-3.9-flash' }], { system: 's', messages: [{ role: 'user', text: 'a' }] });
  assert.equal(out.text, 'ok');
  assert.equal(bodies.length, 2);
  assert.equal(thinkingConfigFor('gemini-3.9-flash'), null);
});

test('Gemini trop lent : délai par essai, puis modèle de secours', async (t) => {
  const { geminiRetry } = await import('../src/ai/gemini.js');
  geminiRetry.attemptMs = 50;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    const u = String(url);
    if (u.includes('/models?')) return Response.json({ models: [{ name: 'models/gemini-3.8-flash-lite', supportedGenerationMethods: ['generateContent'] }] });
    if (u.includes('gemini-3.8-flash:')) {
      return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('timeout', 'TimeoutError'))));
    }
    return Response.json({ candidates: [{ content: { parts: [{ text: 'rapide' }] } }] });
  });
  const started = Date.now();
  const keepAlive = setInterval(() => {}, 1000); // AbortSignal.timeout ne garde pas le processus de test en vie
  t.after(() => clearInterval(keepAlive));
  const out = await generateWithFallback([{ id: 'slow', type: 'gemini', apiKey: encrypt('k-slow'), model: 'gemini-3.8-flash' }], { system: 's', messages: [{ role: 'user', text: 'a' }] });
  assert.equal(out.text, 'rapide');
  assert.equal(out.model, 'gemini-3.8-flash-lite');
  assert.ok(Date.now() - started < 2000);
  geminiRetry.attemptMs = 20_000;
});
