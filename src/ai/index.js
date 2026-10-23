import { geminiProvider } from './gemini.js';
import { anthropicProvider } from './anthropic.js';
import { openaiProvider, OPENAI_PRESETS } from './openai.js';
import { decrypt } from '../crypto.js';

export const PROVIDERS = {
  gemini: geminiProvider,
  anthropic: anthropicProvider,
  ...Object.fromEntries(Object.keys(OPENAI_PRESETS).map((k) => [k, openaiProvider(k)])),
};

export function providerCatalog() {
  return Object.values(PROVIDERS).map((p) => ({
    type: p.type,
    label: p.label,
    defaultModel: p.defaultModel,
    defaultBaseUrl: p.defaultBaseUrl || '',
    keyUrl: p.keyUrl,
    media: p.media,
  }));
}

// Mise en veille temporaire d'une IA qui renvoie « quota dépassé » (429).
const cooldown = new Map();

function supportsMedia(impl, mime) {
  return impl.media.some((prefix) => mime.startsWith(prefix));
}

// Retire les pièces jointes que le fournisseur ne sait pas lire et le signale dans le texte.
function adaptMessages(impl, messages) {
  return messages.map((m) => {
    if (!m.media?.length) return m;
    const ok = m.media.filter((f) => supportsMedia(impl, f.mime));
    const dropped = m.media.length - ok.length;
    return {
      ...m,
      media: ok,
      text: dropped ? `${m.text || ''}\n[${dropped} pièce(s) jointe(s) non lisible(s) par cette IA]`.trim() : m.text,
    };
  });
}

/**
 * Appelle les IA activées dans l'ordre de priorité ; si l'une échoue (quota gratuit
 * épuisé, panne, clé invalide…), la suivante prend le relais automatiquement.
 */
export async function generateWithFallback(providers, request, { timeoutMs = 45000 } = {}) {
  const active = providers.filter((p) => p.enabled !== false && PROVIDERS[p.type]);
  if (!active.length) throw new Error('Aucune IA configurée. Ajoutez une clé (Gemini gratuit) dans l’onglet « IA ».');
  const needsMedia = request.messages.some((m) => m.media?.length);
  // Si des fichiers sont joints, on privilégie les IA capables de les lire (sans changer l'ordre sinon)
  const ordered = needsMedia
    ? [...active].sort((a, b) => Number(!PROVIDERS[a.type].media.length) - Number(!PROVIDERS[b.type].media.length))
    : active;

  const errors = [];
  for (const p of ordered) {
    if ((cooldown.get(p.id) || 0) > Date.now()) {
      errors.push(`${p.name || p.type}: en pause (quota)`);
      continue;
    }
    const impl = PROVIDERS[p.type];
    const started = Date.now();
    try {
      const out = await impl.generate({
        ...request,
        messages: adaptMessages(impl, request.messages),
        apiKey: decrypt(p.apiKey),
        model: p.model || impl.defaultModel,
        baseUrl: p.baseUrl || impl.defaultBaseUrl,
        signal: AbortSignal.timeout(timeoutMs),
      });
      return { ...out, provider: p.name || impl.label, providerId: p.id, model: p.model || impl.defaultModel, ms: Date.now() - started, errors };
    } catch (err) {
      if (err.status === 429) cooldown.set(p.id, Date.now() + 60_000);
      errors.push(`${p.name || p.type}: ${err.message}`);
    }
  }
  const err = new Error(`Toutes les IA ont échoué → ${errors.join(' | ')}`);
  err.errors = errors;
  throw err;
}

export async function listModels(p) {
  const impl = PROVIDERS[p.type];
  if (!impl) throw new Error('Fournisseur inconnu');
  return impl.listModels({ apiKey: decrypt(p.apiKey), baseUrl: p.baseUrl || impl.defaultBaseUrl });
}
