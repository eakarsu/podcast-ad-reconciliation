import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildProviderRouting,
  chatCompletion,
  parseIgnoreProviders,
} from '../server/lib/openrouter.mjs';

test('parseIgnoreProviders trims, lowercases, and drops empties', () => {
  assert.deepEqual(parseIgnoreProviders('z-ai, novita , GMICloud,'), ['z-ai', 'novita', 'gmicloud']);
  assert.deepEqual(parseIgnoreProviders(''), []);
  assert.deepEqual(parseIgnoreProviders(undefined), []);
});

test('buildProviderRouting returns empty object with no config', () => {
  assert.deepEqual(buildProviderRouting(''), {});
  assert.deepEqual(buildProviderRouting(undefined), {});
});

test('buildProviderRouting builds ignore list from env value', () => {
  assert.deepEqual(buildProviderRouting('z-ai,novita,gmicloud'), {
    ignore: ['z-ai', 'novita', 'gmicloud'],
  });
});

test('chatCompletion injects provider.ignore and keeps caller provider fields', async () => {
  let captured;
  const fetchImpl = async (_url, init) => {
    captured = JSON.parse(init.body);
    return {
      ok: true,
      json: async () => ({ id: 'resp-1' }),
    };
  };
  const result = await chatCompletion(
    { messages: [{ role: 'user', content: 'hi' }], provider: { sort: 'price' } },
    {
      apiKey: 'test-key',
      baseUrl: 'https://openrouter.ai/api/v1/',
      model: 'qwen/qwen3.8-flash',
      ignoreProviders: 'z-ai,novita,gmicloud',
      fetchImpl,
    }
  );
  assert.equal(result.id, 'resp-1');
  assert.equal(captured.model, 'qwen/qwen3.8-flash');
  assert.deepEqual(captured.provider, {
    sort: 'price',
    ignore: ['z-ai', 'novita', 'gmicloud'],
  });
});

test('chatCompletion omits provider when ignore list is empty', async () => {
  let captured;
  const fetchImpl = async (_url, init) => {
    captured = JSON.parse(init.body);
    return { ok: true, json: async () => ({}) };
  };
  await chatCompletion(
    { messages: [] },
    { apiKey: 'k', baseUrl: 'https://x', model: 'm', ignoreProviders: '', fetchImpl }
  );
  assert.equal('provider' in captured, false);
});

test('chatCompletion throws on missing key and on HTTP errors', async () => {
  await assert.rejects(
    () => chatCompletion({ messages: [] }, { apiKey: '', baseUrl: 'https://x', model: 'm', fetchImpl: async () => ({}) }),
    /OPENROUTER_API_KEY/
  );
  await assert.rejects(
    () =>
      chatCompletion(
        { messages: [] },
        {
          apiKey: 'k',
          baseUrl: 'https://x',
          model: 'm',
          fetchImpl: async () => ({ ok: false, status: 402, json: async () => ({ error: { message: 'no credits' } }) }),
        }
      ),
    /\(402\).*no credits/
  );
});
