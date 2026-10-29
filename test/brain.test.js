import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';

const { parseAiJson, matchRule, selectKnowledge, isWithinBusinessHours, extractContacts, buildSystemPrompt } = await import('../src/brain.js');
const { defaultData } = await import('../src/store.js');

test('parseAiJson lit le JSON, même entouré de texte ou de ```json', () => {
  assert.equal(parseAiJson('{"reply":"Salut","intent":"question"}').reply, 'Salut');
  const r = parseAiJson('Voici :\n```json\n{"reply":"Ok","needs_human":true,"hide":false}\n```');
  assert.equal(r.reply, 'Ok');
  assert.equal(r.needsHuman, true);
  assert.equal(parseAiJson('Bonjour, merci !').reply, 'Bonjour, merci !');
});

test('matchRule repère les mots-clés sans tenir compte des accents ni de la casse', () => {
  const rules = [{ id: 'r1', keywords: ['prix', 'tarif'], channel: 'comment', response: 'MP envoyé' }];
  assert.equal(matchRule(rules, 'Quel est le PRIX ?', 'comment')?.id, 'r1');
  assert.equal(matchRule(rules, 'Quel est le prix ?', 'message'), undefined);
  assert.equal(matchRule(rules, 'tarifé', 'comment'), undefined);
  assert.equal(matchRule([{ ...rules[0], keywords: ['livraison gratuite'] }], 'La Livraison gratuite ?', 'comment')?.id, 'r1');
});

test('selectKnowledge garde tout si petit, sinon les fiches pertinentes et épinglées', () => {
  const small = [{ title: 'A', content: 'abc' }];
  assert.equal(selectKnowledge(small, 'x').length, 1);
  const big = [
    { title: 'Livraison', content: `livraison tana 5000 ar ${'x'.repeat(300)}` },
    { title: 'Horaires', content: `ouvert lundi ${'y'.repeat(300)}` },
    { title: 'Mentions', content: `important ${'z'.repeat(300)}`, pinned: true },
  ];
  const out = selectKnowledge(big, 'combien pour la livraison ?', 700);
  assert.deepEqual(out.map((k) => k.title), ['Mentions', 'Livraison']);
});

test('isWithinBusinessHours gère les horaires de nuit', () => {
  const noon = new Date('2026-01-05T12:00:00Z');
  assert.equal(isWithinBusinessHours({ enabled: true, start: '08:00', end: '18:00', timezone: 'UTC' }, noon), true);
  assert.equal(isWithinBusinessHours({ enabled: true, start: '20:00', end: '06:00', timezone: 'UTC' }, noon), false);
  assert.equal(isWithinBusinessHours({ enabled: false }, noon), true);
});

test('extractContacts trouve téléphone et e-mail', () => {
  assert.deepEqual(extractContacts('Appelez-moi au 034 12 345 67 ou rakoto@mail.mg'), { phone: '0341234567', email: 'rakoto@mail.mg' });
});

test('le prompt inclut connaissances, exemples et consigne de langue', () => {
  const s = defaultData().settings;
  s.persona.businessName = 'Boutique Soa';
  s.examples = [{ input: 'Dispo ?', output: 'Oui !' }];
  const p = buildSystemPrompt(s, { channel: 'comment', knowledge: [{ title: 'Tarifs', content: 'Robe 45 000 Ar' }] });
  assert.match(p, /Boutique Soa/);
  assert.match(p, /Robe 45 000 Ar/);
  assert.match(p, /Dispo \?/);
  assert.match(p, /malgache/);
  assert.match(p, /COMMENTAIRE PUBLIC/);
});

test('message en malgache : seules les IA qui parlent malgache répondent, sinon message d’attente', async (t) => {
  const { think, isMalagasy } = await import('../src/brain.js');
  const { encrypt } = await import('../src/crypto.js');
  assert.equal(isMalagasy('Salama, ohatrinona ity akanjo ity?'), true);
  assert.equal(isMalagasy('Bonjour, combien pour la livraison ?'), false);
  const calls = [];
  let geminiDown = false;
  t.mock.method(globalThis, 'fetch', async (url) => {
    const u = String(url);
    calls.push(u.includes('generativelanguage') ? 'gemini' : 'groq');
    if (u.includes('generativelanguage')) {
      if (geminiDown) return Response.json({ error: { message: 'bad key' } }, { status: 400 });
      return Response.json({ candidates: [{ content: { parts: [{ text: '{"reply":"Salama! 45 000 Ar ny vidiny."}' }] } }] });
    }
    return Response.json({ choices: [{ message: { content: '{"reply":"réponse groq"}' } }] });
  });
  const s = defaultData().settings;
  s.providers = [
    { id: 'g', type: 'gemini', apiKey: encrypt('k-mg'), model: 'gemini-3.8-flash' },
    { id: 'q', type: 'groq', apiKey: encrypt('gsk') },
  ];
  const mg = [{ role: 'user', text: 'Salama, ohatrinona ity akanjo ity?' }];
  assert.match((await think(s, { channel: 'message', history: mg })).reply, /vidiny/);

  geminiDown = true;
  calls.length = 0;
  const r = await think(s, { channel: 'message', history: mg });
  assert.equal(r.needsHuman, true);
  assert.match(r.reply, /Misaotra/);
  assert.ok(!calls.includes('groq'), 'Groq ne doit pas répondre en malgache');

  // En français, Groq peut servir de secours
  const fr = await think(s, { channel: 'message', history: [{ role: 'user', text: 'Bonjour, quel est le prix ?' }] });
  assert.equal(fr.reply, 'réponse groq');
});

test('Gemma en secours : consignes dans la conversation, sans mode JSON', async (t) => {
  const { pickBackupModels } = await import('../src/ai/gemini.js');
  assert.deepEqual(
    pickBackupModels(['gemini-3.8-flash', 'gemini-3.8-flash-lite', 'gemma-3-27b-it', 'gemma-4-31b-it', 'gemma-4-e4b-it'], 'gemini-3.8-flash'),
    ['gemini-3.8-flash-lite', 'gemma-4-31b-it'],
  );
  const { generateWithFallback } = await import('../src/ai/index.js');
  const { encrypt } = await import('../src/crypto.js');
  let gemmaBody;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    const u = String(url);
    if (u.includes('/models?')) return Response.json({ models: [{ name: 'models/gemma-4-31b-it', supportedGenerationMethods: ['generateContent'] }] });
    if (u.includes('gemma-4-31b-it:')) {
      gemmaBody = JSON.parse(init.body);
      return Response.json({ candidates: [{ content: { parts: [{ text: '{"reply":"Salama"}' }] } }] });
    }
    return Response.json({ error: { message: 'quota' } }, { status: 429 });
  });
  const out = await generateWithFallback([{ id: 'gm', type: 'gemini', apiKey: encrypt('k-gemma'), model: 'gemini-3.8-flash' }], { system: 'SYS', messages: [{ role: 'user', text: 'a' }], json: true });
  assert.equal(out.model, 'gemma-4-31b-it');
  assert.equal(gemmaBody.systemInstruction, undefined);
  assert.equal(gemmaBody.generationConfig.responseMimeType, undefined);
  assert.match(gemmaBody.contents[0].parts[0].text, /SYS/);
});
