// Google Gemini via Google AI Studio (offre gratuite) – API REST generateContent.
const BASE = 'https://generativelanguage.googleapis.com/v1beta';

export const geminiProvider = {
  type: 'gemini',
  label: 'Google Gemini (AI Studio – gratuit)',
  defaultModel: 'gemini-3.8-flash',
  keyUrl: 'https://aistudio.google.com/app/apikey',
  media: ['image/', 'audio/', 'video/', 'application/pdf'],

  async generate({ apiKey, model, system, messages, json, maxTokens = 1024, signal }) {
    const request = { apiKey, system, messages, json, maxTokens, signal };
    try {
      return { ...(await generateWithRetry({ ...request, model })), model };
    } catch (err) {
      // Google retire régulièrement des modèles (404) : on bascule tout seul sur le remplaçant et on le retient.
      if (err.status === 404) {
        const replacement = suggestedModel(err.message, model) || pickBestModel(await this.listModels({ apiKey }).catch(() => []), model);
        if (!replacement) throw err;
        const out = await generateWithRetry({ ...request, model: replacement });
        return { ...out, model: replacement, modelChanged: { from: model, to: replacement } };
      }
      // Surcharge (503) ou quota du modèle épuisé (429) : chaque modèle gratuit a ses propres limites,
      // on dépanne avec un autre modèle Gemini avant de passer à une autre IA.
      if (!err.retryable) throw err;
      const backups = pickBackupModels(await this.listModels({ apiKey }).catch(() => []), model);
      for (const backup of backups) {
        try {
          return { ...(await generateOnce({ ...request, model: backup })), model: backup, temporaryModel: true };
        } catch (e) {
          if (!e.retryable) break;
        }
      }
      throw err;
    }
  },

  async listModels({ apiKey }) {
    const res = await fetch(`${BASE}/models?pageSize=200`, { headers: { 'x-goog-api-key': apiKey } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw httpError('Gemini', res.status, data?.error?.message);
    return (data.models || [])
      .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
      .map((m) => m.name.replace(/^models\//, ''));
  },
};

export function httpError(provider, status, detail) {
  const err = new Error(`${provider} ${status}: ${detail || 'erreur'}`);
  err.status = status;
  // 429 = quota gratuit dépassé, 5xx = panne : on passe à l'IA suivante
  err.retryable = status === 429 || status >= 500 || status === 408;
  return err;
}

async function generateOnce({ apiKey, model, system, messages, json, maxTokens, signal }) {
  const contents = messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [
      ...(m.media || []).map((f) => ({ inlineData: { mimeType: f.mime, data: f.base64 } })),
      { text: m.text || ' ' },
    ],
  }));
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents,
    generationConfig: {
      // Les modèles Gemini récents « réfléchissent » avant de répondre : marge large pour ne pas couper la réponse
      maxOutputTokens: Math.max(maxTokens, 8192),
      temperature: 0.7,
      ...(json ? { responseMimeType: 'application/json' } : {}),
    },
  };
  const res = await fetch(`${BASE}/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify(body),
    signal,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw httpError('Gemini', res.status, data?.error?.message);
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
export const geminiRetry = { delays: [1500, 4000] };

async function generateWithRetry(request) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await generateOnce(request);
    } catch (err) {
      // Les 503 « high demand » sont en général très courts : on réessaie avant d'abandonner (pas les 429 de quota).
      const delay = geminiRetry.delays[attempt];
      if (!(err.status >= 500) || delay === undefined || request.signal?.aborted) throw err;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

/** Modèles de dépannage : autres « flash » (y compris « lite », plus légers et moins demandés). */
export function pickBackupModels(models, current, max = 2) {
  const version = (m) => Number(m.match(/gemini-(\d+(?:\.\d+)?)/)?.[1] || 0);
  return models
    .filter((m) => /^gemini-/.test(m) && /flash/.test(m) && m !== current)
    .filter((m) => !/(image|tts|audio|embed|live|vision|exp|robotics|computer)/.test(m))
    .sort((a, b) => Number(/preview/.test(a)) - Number(/preview/.test(b)) || version(b) - version(a) || a.length - b.length)
    .slice(0, max);
}
