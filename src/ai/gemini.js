// Google Gemini via Google AI Studio (offre gratuite) – API REST generateContent.
const BASE = 'https://generativelanguage.googleapis.com/v1beta';

export const geminiProvider = {
  type: 'gemini',
  label: 'Google Gemini (AI Studio – gratuit)',
  defaultModel: 'gemini-2.5-flash',
  keyUrl: 'https://aistudio.google.com/app/apikey',
  media: ['image/', 'audio/', 'video/', 'application/pdf'],

  async generate({ apiKey, model, system, messages, json, maxTokens = 1024, signal }) {
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
        maxOutputTokens: maxTokens,
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
