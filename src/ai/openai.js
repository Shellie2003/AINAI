// Tout fournisseur compatible avec l'API « chat completions » d'OpenAI.
import { httpError } from './gemini.js';

export const OPENAI_PRESETS = {
  groq: { label: 'Groq (gratuit, très rapide)', baseUrl: 'https://api.groq.com/openai/v1', defaultModel: 'llama-3.3-70b-versatile', keyUrl: 'https://console.groq.com/keys' },
  cerebras: { label: 'Cerebras (gratuit, très rapide)', baseUrl: 'https://api.cerebras.ai/v1', defaultModel: 'gpt-oss-120b', keyUrl: 'https://cloud.cerebras.ai/platform/' },
  openrouter: { label: 'OpenRouter (modèles gratuits)', baseUrl: 'https://openrouter.ai/api/v1', defaultModel: 'openrouter/free', keyUrl: 'https://openrouter.ai/keys' },
  mistral: { label: 'Mistral AI (offre gratuite)', baseUrl: 'https://api.mistral.ai/v1', defaultModel: 'mistral-small-latest', keyUrl: 'https://console.mistral.ai/api-keys' },
  openai: { label: 'OpenAI (ChatGPT)', baseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4o-mini', keyUrl: 'https://platform.openai.com/api-keys' },
  deepseek: { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', defaultModel: 'deepseek-chat', keyUrl: 'https://platform.deepseek.com/api_keys' },
  ollama: { label: 'Ollama (local)', baseUrl: 'http://localhost:11434/v1', defaultModel: 'llama3.1', keyUrl: '' },
  custom: { label: 'Autre (compatible OpenAI)', baseUrl: '', defaultModel: '', keyUrl: '' },
};

// Modèle introuvable ou retiré : formulations des différents fournisseurs.
const MODEL_GONE = /decommission|deprecat|not found|does not exist|no longer|model_not_found|invalid model|unknown model|not a valid model|no endpoints found/i;

// Préférences pour choisir un remplaçant : bons modèles de conversation multilingues, du meilleur au moins bon.
const PREFERRED = [/gpt-oss-120b/, /llama-4-maverick/, /llama-3\.3-70b/, /qwen-?3.*(235|32)b/, /llama-4-scout/, /mistral-(small|medium)/, /gpt-4o-mini|gpt-4\.1-mini/, /deepseek-(chat|v3)/, /gpt-oss-20b/, /llama-3\.1-8b/];
const NOT_CHAT = /whisper|guard|tts|embed|moderation|vision|audio|transcribe|compound|image|ocr|rerank|playai|distil/;

export function pickOpenAiModel(models, current, preset) {
  let list = models.filter((m) => m !== current && !NOT_CHAT.test(m));
  if (preset === 'openrouter') list = list.filter((m) => m.endsWith(':free') || m === 'openrouter/free');
  for (const re of PREFERRED) {
    const found = list.find((m) => re.test(m));
    if (found) return found;
  }
  return list[0] || null;
}

export function openaiProvider(preset) {
  const p = OPENAI_PRESETS[preset] || OPENAI_PRESETS.custom;
  const root = (baseUrl) => (baseUrl || p.baseUrl).replace(/\/+$/, '');

  async function chat({ apiKey, model, baseUrl, system, messages, json, maxTokens, signal }) {
    const body = {
      model,
      // Marge pour les modèles qui « réfléchissent » avant de répondre (gpt-oss, qwen3…)
      // (Cerebras gratuit limite le contexte total à 8 192 jetons : réponse plafonnée plus bas)
      max_tokens: preset === 'cerebras' ? 2048 : Math.max(maxTokens, 4096),
      messages: [
        { role: 'system', content: system },
        ...messages.map((m) => ({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: m.media?.length
            ? [
                ...m.media.map((f) => ({ type: 'image_url', image_url: { url: `data:${f.mime};base64,${f.base64}` } })),
                { type: 'text', text: m.text || ' ' },
              ]
            : m.text || ' ',
        })),
      ],
      ...(json && preset !== 'ollama' ? { response_format: { type: 'json_object' } } : {}),
    };
    const res = await fetch(`${root(baseUrl)}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
      body: JSON.stringify(body),
      signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = httpError(p.label, res.status, data?.error?.message || data?.message);
      err.modelGone = (res.status === 404 || res.status === 400) && MODEL_GONE.test(`${data?.error?.message} ${data?.error?.code}`);
      // Certains modèles refusent le mode JSON : on le signale pour réessayer sans
      err.jsonUnsupported = res.status === 400 && /response_format|json/i.test(data?.error?.message || '');
      throw err;
    }
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw httpError(p.label, 502, 'réponse vide');
    return { text, usage: { input: data.usage?.prompt_tokens, output: data.usage?.completion_tokens } };
  }

  return {
    type: preset,
    label: p.label,
    defaultModel: p.defaultModel,
    defaultBaseUrl: p.baseUrl,
    keyUrl: p.keyUrl,
    media: ['image/'],

    async generate(request) {
      const req = { ...request, maxTokens: request.maxTokens ?? 1024 };
      const once = async (model) => {
        try {
          return await chat({ ...req, model });
        } catch (err) {
          if (!err.jsonUnsupported || !req.json) throw err;
          return chat({ ...req, model, json: false }); // le JSON est quand même extrait de la réponse
        }
      };
      try {
        return { ...(await once(req.model)), model: req.model };
      } catch (err) {
        // Modèle retiré par le fournisseur : on choisit un remplaçant dans sa liste et on le retient.
        if (!err.modelGone) throw err;
        const replacement = pickOpenAiModel(await this.listModels(req).catch(() => []), req.model, preset);
        if (!replacement) throw err;
        const out = await once(replacement);
        return { ...out, model: replacement, modelChanged: { from: req.model, to: replacement } };
      }
    },

    async listModels({ apiKey, baseUrl }) {
      const res = await fetch(`${root(baseUrl)}/models`, { headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {} });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw httpError(p.label, res.status, data?.error?.message);
      return (data.data || []).map((m) => m.id).sort();
    },
  };
}
