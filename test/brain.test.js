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
