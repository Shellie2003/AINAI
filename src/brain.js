import { generateWithFallback } from './ai/index.js';

const KNOWLEDGE_BUDGET = 24000; // caractères de base de connaissances injectés au maximum

export const normalize = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9@+.\s]/g, ' ');

const STOP = new Set('le la les un une des de du et ou a au aux en est ce cet cette pour par sur dans avec vous je tu il elle on nous ils que qui quoi bonjour salut merci svp stp ny ary sy fa dia ve'.split(' '));

function tokens(s) {
  return normalize(s).split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));
}

/** Sélectionne les fiches de connaissances les plus pertinentes pour la question. */
export function selectKnowledge(knowledge, query, budget = KNOWLEDGE_BUDGET) {
  const items = (knowledge || []).filter((k) => k.enabled !== false && k.content);
  const total = items.reduce((n, k) => n + k.title.length + k.content.length, 0);
  if (total <= budget) return items;
  const q = new Set(tokens(query));
  const scored = items
    .map((k) => {
      const words = tokens(`${k.title} ${k.title} ${k.content}`);
      const hits = words.filter((w) => q.has(w)).length;
      return { k, score: hits / Math.sqrt(words.length + 1) + (k.pinned ? 100 : 0) };
    })
    .sort((a, b) => b.score - a.score);
  const out = [];
  let used = 0;
  for (const { k } of scored) {
    const size = k.title.length + k.content.length;
    if (used + size > budget) continue;
    out.push(k);
    used += size;
  }
  return out;
}

/** Règles par mot-clé : réponse fixe instantanée, sans IA (et sans consommer de quota). */
export function matchRule(rules, text, channel) {
  const n = ` ${normalize(text)} `;
  return (rules || []).find(
    (r) =>
      r.enabled !== false &&
      (r.channel === 'all' || r.channel === channel) &&
      (r.keywords || []).some((kw) => kw.trim() && n.includes(` ${normalize(kw).trim()} `)),
  );
}

export function isWithinBusinessHours(bh, now = new Date()) {
  if (!bh?.enabled) return true;
  const parts = new Intl.DateTimeFormat('fr-FR', { timeZone: bh.timezone || 'UTC', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
  const [start, end] = [bh.start, bh.end];
  return start <= end ? parts >= start && parts < end : parts >= start || parts < end;
}

export function buildSystemPrompt(settings, { channel, knowledge, offHours, userName, postContext }) {
  const p = settings.persona;
  const lines = [
    `Tu es l'assistante virtuelle officielle de la page Facebook « ${p.businessName || 'notre page'} ».`,
    p.description ? `À propos de l'entreprise : ${p.description}` : '',
    `Ton : ${p.tone}. ${p.useEmojis ? 'Tu peux utiliser quelques emojis avec modération.' : "N'utilise pas d'emojis."}`,
    `Langue : réponds TOUJOURS dans la langue de la personne (français, malgache, anglais, etc.). Si elle n'est pas claire, réponds en ${p.defaultLanguage}.`,
    channel === 'comment'
      ? `Tu réponds à un COMMENTAIRE PUBLIC : reste bref (1 à 3 phrases), ne donne jamais d'informations personnelles en public ; pour les détails (prix sur demande, commande, adresse), propose de continuer en message privé.`
      : `Tu réponds en MESSAGE PRIVÉ (Messenger) : sois utile et précis, guide la personne vers l'achat ou la solution, pose une question si nécessaire.`,
    `Longueur maximale de la réponse : ${p.maxLength} caractères. Pas de markdown (Facebook ne l'affiche pas).`,
    userName ? `La personne s'appelle ${userName}. Tu peux utiliser son prénom.` : '',
    `N'invente JAMAIS de prix, de stock, de délais ou de promesses absents de la base de connaissances. Si tu ne sais pas, dis qu'un membre de l'équipe va répondre et mets "needs_human": true.`,
    p.humanContact ? `Contact humain à donner si besoin : ${p.humanContact}` : '',
    offHours ? `Nous sommes actuellement EN DEHORS des heures d'ouverture (${settings.automation.businessHours.start}–${settings.automation.businessHours.end}). ${settings.automation.businessHours.offHoursNote || 'Précise-le gentiment si la demande nécessite un humain.'}` : '',
    p.customInstructions ? `Consignes spécifiques du propriétaire :\n${p.customInstructions}` : '',
    p.signature ? `Termine les messages privés par la signature : ${p.signature}` : '',
  ];
  if (postContext) lines.push(`Publication sur laquelle porte le commentaire :\n"""${postContext.slice(0, 1500)}"""`);
  if (knowledge.length) {
    lines.push('BASE DE CONNAISSANCES (source de vérité) :');
    for (const k of knowledge) lines.push(`### ${k.title}\n${k.content}`);
  }
  const examples = (settings.examples || []).slice(-15);
  if (examples.length) {
    lines.push('EXEMPLES DE BONNES RÉPONSES validées par le propriétaire (imite ce style) :');
    for (const e of examples) lines.push(`Client : ${e.input}\nRéponse : ${e.output}`);
  }
  lines.push(`Réponds UNIQUEMENT avec un objet JSON valide, sans texte autour, de la forme :
{
  "reply": "ta réponse à envoyer (chaîne vide si aucune réponse n'est appropriée)",
  "intent": "question | achat | reclamation | compliment | spam | insulte | autre",
  "sentiment": "positif | neutre | negatif",
  "language": "code langue ISO, ex. fr, mg, en",
  "needs_human": false,
  "hide": false,
  "private_message": "${channel === 'comment' ? "message privé à envoyer à l'auteur du commentaire si la personne veut acheter / demande un prix ou des détails, sinon chaîne vide" : 'chaîne vide'}",
  "lead": { "name": "", "phone": "", "email": "", "interest": "" }
}
"hide" = true uniquement pour le spam, les arnaques, les liens suspects ou les insultes graves.
"lead" : remplis les champs si la personne donne un téléphone, un e-mail ou montre une intention d'achat claire, sinon laisse-les vides.`);
  return lines.filter(Boolean).join('\n\n');
}

/** Extrait le JSON même si l'IA l'entoure de texte ou de ```json. */
export function parseAiJson(text) {
  const clean = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const candidates = [clean];
  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');
  if (start !== -1 && end > start) candidates.push(clean.slice(start, end + 1));
  for (const c of candidates) {
    try {
      const obj = JSON.parse(c);
      if (obj && typeof obj === 'object') return normalizeResult(obj);
    } catch {
      /* essai suivant */
    }
  }
  // L'IA a répondu en texte brut : on l'utilise tel quel comme réponse.
  return normalizeResult({ reply: clean });
}

function normalizeResult(o) {
  const lead = o.lead && typeof o.lead === 'object' ? o.lead : {};
  return {
    reply: String(o.reply || '').trim(),
    intent: String(o.intent || 'autre').toLowerCase(),
    sentiment: String(o.sentiment || 'neutre').toLowerCase(),
    language: String(o.language || ''),
    needsHuman: Boolean(o.needs_human ?? o.needsHuman),
    hide: Boolean(o.hide),
    privateMessage: String(o.private_message || o.privateMessage || '').trim(),
    lead: {
      name: String(lead.name || ''),
      phone: String(lead.phone || ''),
      email: String(lead.email || ''),
      interest: String(lead.interest || ''),
    },
  };
}

// Détection locale des coordonnées, en complément de l'IA.
export function extractContacts(text) {
  const phone = String(text).match(/(?:\+?\d[\d\s.-]{7,}\d)/)?.[0]?.replace(/[\s.-]/g, '') || '';
  const email = String(text).match(/[\w.+-]+@[\w-]+\.[\w.]+/)?.[0] || '';
  return { phone, email };
}

/**
 * Cœur de l'assistante : produit la réponse et l'analyse (intention, sentiment, action).
 * @param history messages précédents [{role, text, media?}] – le dernier est celui du client
 */
export async function think(settings, { channel, history, userName, postContext, now = new Date() }) {
  const last = history[history.length - 1]?.text || '';
  const rule = matchRule(settings.rules, last, channel);
  if (rule && !rule.useAi) {
    return {
      reply: rule.response,
      privateMessage: rule.privateMessage || '',
      intent: 'regle',
      sentiment: 'neutre',
      needsHuman: false,
      hide: false,
      lead: { name: '', phone: '', email: '', interest: '' },
      provider: `Règle « ${rule.name || rule.keywords.join(', ')} »`,
      ms: 0,
      rule: rule.id,
    };
  }
  const offHours = !isWithinBusinessHours(settings.automation.businessHours, now);
  const query = history.slice(-4).map((m) => m.text).join(' ');
  const knowledge = selectKnowledge(settings.knowledge, `${query} ${postContext || ''}`);
  let system = buildSystemPrompt(settings, { channel, knowledge, offHours, userName, postContext });
  if (rule?.useAi) system += `\n\nConsigne pour ce message (règle « ${rule.name || rule.keywords.join(', ')} ») : ${rule.response}`;

  const out = await generateWithFallback(settings.providers, { system, messages: history, json: true, maxTokens: 2048 });
  const result = parseAiJson(out.text);
  const contacts = extractContacts(history.filter((m) => m.role === 'user').map((m) => m.text).join(' '));
  result.lead.phone ||= contacts.phone;
  result.lead.email ||= contacts.email;
  const max = Number(settings.persona.maxLength) || 600;
  if (result.reply.length > max * 1.5) result.reply = `${result.reply.slice(0, max * 1.5 - 1)}…`;
  return { ...result, provider: out.provider, model: out.model, ms: out.ms, fallbackErrors: out.errors, modelChanged: out.modelChanged };
}
