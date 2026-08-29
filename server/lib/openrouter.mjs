// Central OpenRouter request helper.
// Every OpenRouter call must go through here so provider-routing policy
// (disabled providers) is enforced in one place, even before any integration
// lands. Nothing else in the server should hit the OpenRouter API directly.

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';

// Parse "z-ai, novita, gmicloud" -> ["z-ai", "novita", "gmicloud"]
export function parseIgnoreProviders(raw) {
  if (!raw) return [];
  return String(raw)
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

// Build the OpenRouter `provider` routing object from a raw env value.
export function buildProviderRouting(rawIgnore) {
  const ignore = parseIgnoreProviders(rawIgnore);
  return ignore.length ? { ignore } : {};
}

export function openRouterConfig(env = process.env) {
  return {
    apiKey: env.OPENROUTER_API_KEY,
    baseUrl: (env.OPENROUTER_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, ''),
    model: env.OPENROUTER_MODEL,
    ignoreProviders: env.OPENROUTER_IGNORE_PROVIDERS || '',
  };
}

// POST /chat/completions with routing policy merged into the payload.
// Merges with (never overrides) a caller-supplied `provider` object apart
// from `ignore`, which is always owned by server config.
export async function chatCompletion(body, opts = {}) {
  const { apiKey, baseUrl, model, ignoreProviders } = { ...openRouterConfig(), ...opts };
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not configured');
  if (!model) throw new Error('OPENROUTER_MODEL is not configured');

  const payload = { ...body, model };
  const routing = buildProviderRouting(ignoreProviders);
  if (routing.ignore) {
    payload.provider = { ...(body.provider || {}), ignore: routing.ignore };
  }

  const res = await (opts.fetchImpl || fetch)(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    let detail = '';
    try {
      detail = (await res.json())?.error?.message || '';
    } catch {
      /* ignore */
    }
    throw new Error(`OpenRouter request failed (${res.status})${detail ? `: ${detail}` : ''}`);
  }
  return res.json();
}
