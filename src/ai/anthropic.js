// Anthropic Claude via le SDK officiel.
import Anthropic from '@anthropic-ai/sdk';
import { httpError } from './gemini.js';

// Modèles qui acceptent le repli serveur automatique en cas de refus de sécurité.
const SERVER_FALLBACK_MODELS = new Set(['claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5']);

export const anthropicProvider = {
  type: 'anthropic',
  label: 'Anthropic Claude',
  malagasy: true,
  defaultModel: 'claude-opus-5-5',
  keyUrl: 'https://console.anthropic.com/settings/keys',
  media: ['image/', 'application/pdf'],

  async generate({ apiKey, model, system, messages, maxTokens = 1024, signal }) {
    const client = new Anthropic({ apiKey, maxRetries: 1 });
    const params = {
      model,
      max_tokens: Math.max(maxTokens, 2048),
      system,
      messages: toClaudeMessages(messages),
      // Réponses courtes de service client : effort bas = rapide et économique
      output_config: { effort: 'low' },
    };
    if (SERVER_FALLBACK_MODELS.has(model)) {
      params.betas = ['server-side-fallback-2026-07-01'];
      params.fallbacks = 'default';
    }
    let response;
    try {
      response = await client.beta.messages.create(params, { signal });
    } catch (err) {
      if (err instanceof Anthropic.APIError) throw httpError('Claude', err.status ?? 502, err.message);
      throw err;
    }
    if (response.stop_reason === 'refusal') throw httpError('Claude', 502, 'requête refusée par le modèle');
    const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    if (!text) throw httpError('Claude', 502, `réponse vide (${response.stop_reason})`);
    return { text, usage: { input: response.usage?.input_tokens, output: response.usage?.output_tokens } };
  },

  async listModels({ apiKey }) {
    const client = new Anthropic({ apiKey });
    const ids = [];
    for await (const m of client.models.list()) ids.push(m.id);
    return ids;
  },
};

// Claude exige une alternance user/assistant commençant par user.
function toClaudeMessages(messages) {
  const out = [];
  for (const m of messages) {
    const role = m.role === 'assistant' ? 'assistant' : 'user';
    const content = [
      ...(m.media || []).map((f) =>
        f.mime === 'application/pdf'
          ? { type: 'document', source: { type: 'base64', media_type: f.mime, data: f.base64 } }
          : { type: 'image', source: { type: 'base64', media_type: f.mime, data: f.base64 } },
      ),
      { type: 'text', text: m.text || ' ' },
    ];
    const last = out[out.length - 1];
    if (last && last.role === role) last.content.push(...content);
    else out.push({ role, content });
  }
  if (out[0]?.role === 'assistant') out.unshift({ role: 'user', content: [{ type: 'text', text: '(début de la conversation)' }] });
  return out;
}
