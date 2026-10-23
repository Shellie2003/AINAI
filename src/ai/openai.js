// Tout fournisseur compatible avec l'API « chat completions » d'OpenAI.
import { httpError } from './gemini.js';

export const OPENAI_PRESETS = {
  openai: { label: 'OpenAI (ChatGPT)', baseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4o-mini', keyUrl: 'https://platform.openai.com/api-keys' },
  groq: { label: 'Groq (gratuit, très rapide)', baseUrl: 'https://api.groq.com/openai/v1', defaultModel: 'llama-3.3-70b-versatile', keyUrl: 'https://console.groq.com/keys' },
  openrouter: { label: 'OpenRouter (modèles gratuits)', baseUrl: 'https://openrouter.ai/api/v1', defaultModel: 'meta-llama/llama-3.3-70b-instruct:free', keyUrl: 'https://openrouter.ai/keys' },
  mistral: { label: 'Mistral AI', baseUrl: 'https://api.mistral.ai/v1', defaultModel: 'mistral-small-latest', keyUrl: 'https://console.mistral.ai/api-keys' },
  deepseek: { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', defaultModel: 'deepseek-chat', keyUrl: 'https://platform.deepseek.com/api_keys' },
  ollama: { label: 'Ollama (local)', baseUrl: 'http://localhost:11434/v1', defaultModel: 'llama3.1', keyUrl: '' },
  custom: { label: 'Autre (compatible OpenAI)', baseUrl: '', defaultModel: '', keyUrl: '' },
};

export function openaiProvider(preset) {
  const p = OPENAI_PRESETS[preset] || OPENAI_PRESETS.custom;
  return {
    type: preset,
    label: p.label,
    defaultModel: p.defaultModel,
    defaultBaseUrl: p.baseUrl,
    keyUrl: p.keyUrl,
    media: ['image/'],

    async generate({ apiKey, model, baseUrl, system, messages, json, maxTokens = 1024, signal }) {
      const body = {
        model,
        max_tokens: maxTokens,
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
      const res = await fetch(`${(baseUrl || p.baseUrl).replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
        body: JSON.stringify(body),
        signal,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw httpError(p.label, res.status, data?.error?.message || data?.message);
      const text = data.choices?.[0]?.message?.content;
      if (!text) throw httpError(p.label, 502, 'réponse vide');
      return { text, usage: { input: data.usage?.prompt_tokens, output: data.usage?.completion_tokens } };
    },

    async listModels({ apiKey, baseUrl }) {
      const res = await fetch(`${(baseUrl || p.baseUrl).replace(/\/+$/, '')}/models`, {
        headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw httpError(p.label, res.status, data?.error?.message);
      return (data.data || []).map((m) => m.id).sort();
    },
  };
}
