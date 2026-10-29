// Google Gemini via Google AI Studio (offre gratuite) – API REST generateContent.
const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const modelCache = new Map();

export const geminiProvider = {
  type: 'gemini',
  label: 'Google Gemini (AI Studio – gratuit)',
  malagasy: true, // très bon en malgache
  defaultModel: 'gemini-3.8-flash',
  keyUrl: 'https://aistudio.google.com/app/apikey',
  media: ['image/', 'audio/', 'video/', 'application/pdf'],

  async generate({ apiKey, model, system, messages, json, maxTokens = 1024, signal }) {
    const request = { apiKey, system, messages, json, maxTokens, signal };
    // Liste des modèles de secours préparée tout de suite (en cache 1 h) pour ne pas perdre de temps ensuite
    const backups = this.listModels({ apiKey }).catch(() => []);
    return race(request, model, backups);
  },

  async listModels({ apiKey }) {
    // Liste gardée 1 h : évite un appel réseau supplémentaire à chaque surcharge
    const cached = modelCache.get(apiKey);
    if (cached && Date.now() - cached.at < 3600_000) return cached.list;
    const res = await fetch(`${BASE}/models?pageSize=200`, { headers: { 'x-goog-api-key': apiKey }, signal: AbortSignal.timeout(10_000) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw httpError('Gemini', res.status, data?.error?.message);
    const list = (data.models || [])
      .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
      .map((m) => m.name.replace(/^models\//, ''));
    if (list.length) modelCache.set(apiKey, { at: Date.now(), list }); // une liste vide n'est pas gardée
    return list;
  },

};

// Explications en clair pour les erreurs courantes des fournisseurs
const HINTS = {
  401: 'clé API invalide : recopiez-la',
  402: 'crédit épuisé : ce service est payant. Rechargez votre compte ou désactivez cette IA',
  403: 'accès refusé : vérifiez la clé et les droits de votre compte',
};

export function httpError(provider, status, detail) {
  const hint = HINTS[status] ? ` → ${HINTS[status]}` : '';
  const err = new Error(`${provider} ${status}: ${detail || 'erreur'}${hint}`);
  err.status = status;
  // 429 = quota gratuit dépassé, 5xx = panne : on passe à l'IA suivante
  err.retryable = status === 429 || status >= 500 || status === 408;
  return err;
}

// Modèles qui ont refusé notre réglage de réflexion : on ne le renvoie plus.
const noThinkingConfig = new Set();

/** Réflexion au minimum : pour des réponses de service client, c'est beaucoup plus rapide et aussi bon. */
export function thinkingConfigFor(model) {
  if (noThinkingConfig.has(model)) return null;
  const major = Number(model.match(/gemini-(\d+)/)?.[1] || 0);
  if (major >= 3) return { thinkingLevel: 'low' };
  if (/gemini-2\.5-flash/.test(model)) return { thinkingBudget: 0 };
  if (/gemini-2\.5-pro/.test(model)) return { thinkingBudget: 128 };
  return null;
}

async function generateOnce({ apiKey, model, system, messages, json, maxTokens, signal }) {
  const contents = messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [
      ...(m.media || []).map((f) => ({ inlineData: { mimeType: f.mime, data: f.base64 } })),
      { text: m.text || ' ' },
    ],
  }));
  // Gemma (gratuit, même clé) : pas d'instruction système ni de mode JSON → consignes placées en tête de conversation
  const gemma = /^gemma-/.test(model);
  if (gemma) contents.unshift({ role: 'user', parts: [{ text: `CONSIGNES (à suivre strictement) :\n${system}` }] }, { role: 'model', parts: [{ text: 'Compris.' }] });
  const thinkingConfig = gemma ? null : thinkingConfigFor(model);
  const body = {
    ...(gemma ? {} : { systemInstruction: { parts: [{ text: system }] } }),
    contents,
    generationConfig: {
      maxOutputTokens: Math.max(maxTokens, 4096),
      temperature: 0.7,
      ...(json && !gemma ? { responseMimeType: 'application/json' } : {}),
      ...(thinkingConfig ? { thinkingConfig } : {}),
    },
  };
  // Chaque essai a son propre délai : un modèle trop lent ne bloque pas toute la chaîne de secours.
  const attemptSignal = AbortSignal.any([signal, AbortSignal.timeout(geminiRetry.attemptMs)].filter(Boolean));
  let res;
  try {
    res = await fetch(`${BASE}/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
      signal: attemptSignal,
    });
  } catch (err) {
    if (signal?.aborted || !attemptSignal.aborted) throw err;
    throw httpError('Gemini', 504, `délai dépassé (${geminiRetry.attemptMs / 1000} s) pour ${model}`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Réglage de réflexion refusé par ce modèle : on réessaie sans, et on s'en souvient
    if (res.status === 400 && thinkingConfig && /thinking/i.test(data?.error?.message || '')) {
      noThinkingConfig.add(model);
      return generateOnce({ apiKey, model, system, messages, json, maxTokens, signal });
    }
    throw httpError('Gemini', res.status, data?.error?.message);
  }
  const cand = data.candidates?.[0];
  const text = (cand?.content?.parts || [])
    .filter((p) => !p.thought && p.text)
    .map((p) => p.text)
    .join('');
  if (!text) throw httpError('Gemini', 502, `réponse vide (${cand?.finishReason || data.promptFeedback?.blockReason || 'inconnu'})`);
  return { text, usage: { input: data.usageMetadata?.promptTokenCount, output: data.usageMetadata?.candidatesTokenCount } };
}

// « … use models/gemini-3.8-flash … » dans le message d'erreur de Google
export function suggestedModel(message, current) {
  const found = [...String(message).matchAll(/models\/([\w.-]+)/g)].map((m) => m[1].replace(/[.]+$/, ''));
  return found.find((m) => m !== current && m.startsWith('gemini')) || null;
}

/** Choisit le meilleur modèle « flash » généraliste et stable parmi ceux accessibles avec la clé. */
export function pickBestModel(models, current) {
  const version = (m) => Number(m.match(/gemini-(\d+(?:\.\d+)?)/)?.[1] || 0);
  const candidates = models
    .filter((m) => /^gemini-/.test(m) && /flash/.test(m) && m !== current)
    .filter((m) => !/(lite|image|tts|audio|embed|live|vision|exp|robotics|computer)/.test(m))
    .sort((a, b) => Number(/preview/.test(a)) - Number(/preview/.test(b)) || version(b) - version(a) || a.length - b.length);
  return candidates[0] || null;
}

// Délais entre deux essais quand Google est surchargé (modifiables dans les tests).
// hedgeMs : au-delà, on lance un modèle de secours en parallèle ; attemptMs : délai maximal d'un essai
export const geminiRetry = { delays: [1000], attemptMs: 30_000, hedgeMs: 8_000 };

async function generateWithRetry(request) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await generateOnce(request);
    } catch (err) {
      // Les 503 « high demand » sont en général très courts : on réessaie avant d'abandonner (pas les 429 de quota).
      const delay = geminiRetry.delays[attempt];
      // (pas après un délai dépassé : on passe directement à un modèle plus léger)
      if (!(err.status >= 500) || err.status === 504 || delay === undefined || request.signal?.aborted) throw err;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

/**
 * Modèles de dépannage, avec la même clé (chaque modèle a son propre quota gratuit) :
 * d'abord les autres Gemini « flash » (dont « lite », plus légers), puis Gemma (gratuit, multilingue).
 */
export function pickBackupModels(models, current, max = 3) {
  const version = (m) => Number(m.match(/(?:gemini|gemma)-(\d+(?:\.\d+)?)/)?.[1] || 0);
  const size = (m) => Number(m.match(/-(\d+)b/)?.[1] || 0);
  const usable = (m) => m !== current && !/(image|tts|audio|embed|live|vision|exp|robotics|computer|nano|-e\d+b|-1b)/.test(m);
  const flash = models
    .filter((m) => /^gemini-/.test(m) && /flash/.test(m) && usable(m))
    .sort((a, b) => Number(/preview/.test(a)) - Number(/preview/.test(b)) || version(b) - version(a) || a.length - b.length);
  // Gemma : la version la plus récente et le plus gros modèle (meilleur en malgache)
  const gemma = models.filter((m) => /^gemma-/.test(m) && usable(m)).sort((a, b) => version(b) - version(a) || size(b) - size(a));
  return [...flash.slice(0, max - (gemma.length ? 1 : 0)), ...gemma.slice(0, 1)].slice(0, max);
}

/**
 * Course entre modèles : on lance le modèle choisi ; s'il n'a pas répondu au bout de `hedgeMs`
 * (ou s'il échoue : surcharge, quota, délai), on lance un modèle de secours EN PARALLÈLE
 * et on garde la première bonne réponse. Les requêtes perdantes sont annulées.
 */
function race(request, model, backupsPromise) {
  return new Promise((resolve, reject) => {
    const controllers = [];
    const errors = [];
    let queue = null; // modèles de secours restants
    let running = 0;
    let done = false;
    let hedgeTimer = null;

    const finish = (fn, value) => {
      if (done) return;
      done = true;
      clearTimeout(hedgeTimer);
      controllers.forEach((c) => c.abort());
      fn(value);
    };

    const fail = () => {
      const first = errors[0];
      const err = new Error(errors.map((e) => e.message).join(' | '));
      Object.assign(err, { status: first?.status, retryable: errors.some((e) => e.retryable) });
      finish(reject, err);
    };

    const launch = (m, extra = {}) => {
      const ctrl = new AbortController();
      controllers.push(ctrl);
      running++;
      const signal = AbortSignal.any([request.signal, ctrl.signal].filter(Boolean));
      const call = m === model ? generateWithRetry({ ...request, model: m, signal }) : generateOnce({ ...request, model: m, signal });
      call.then(
        (out) => finish(resolve, { ...out, model: m, ...extra }),
        (err) => {
          running--;
          if (done) return;
          errors.push(err);
          // Modèle retiré (404) : on bascule sur son remplaçant et on le retient
          if (err.status === 404 && m === model) {
            backupsPromise.then((list) => {
              const replacement = suggestedModel(err.message, model) || pickBestModel(list, model);
              if (replacement && !done) return launch(replacement, { modelChanged: { from: model, to: replacement } });
              if (!running) fail();
            });
            return;
          }
          // Clé invalide, requête refusée… : inutile d'essayer d'autres modèles
          if (!err.retryable && err.status !== 504) {
            if (!running) fail();
            return;
          }
          next().then((started) => !started && !running && fail());
        },
      );
    };

    // Lance le prochain modèle de secours ; renvoie false s'il n'y en a plus
    const next = async () => {
      queue ??= pickBackupModels(await backupsPromise, model);
      if (done) return true;
      const m = queue.shift();
      if (!m) return false;
      launch(m, { temporaryModel: true });
      return true;
    };

    launch(model);
    hedgeTimer = setTimeout(() => !done && next(), geminiRetry.hedgeMs);
  });
}
