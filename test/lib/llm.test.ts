import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createProvider } from '../../src/lib/llm';
import { getDefaultModels } from '../../src/lib/llm/models';

/**
 * Provider construction only — no network calls. These guard the dispatch
 * logic and the argument checks, which is where a misconfigured provider
 * surfaces as a confusing error much later in a report run.
 *
 * This also exercises the lazy require() inside createProvider, which is why
 * the suite compiles to CommonJS: under ESM that require would be undefined.
 */
describe('createProvider', () => {
  it('constructs each supported provider', () => {
    assert.ok(createProvider('anthropic', { apiKey: 'test-key' }));
    assert.ok(createProvider('openai', { apiKey: 'test-key' }));
    assert.ok(createProvider('grok', { apiKey: 'test-key' }));
    assert.ok(createProvider('gemini', { apiKey: 'test-key' }));
    assert.ok(createProvider('bedrock', {}));
  });

  it('rejects an unknown provider and names the supported ones', () => {
    assert.throws(
      () => createProvider('not-a-provider', { apiKey: 'k' }),
      (err: Error) => {
        assert.match(err.message, /Unknown LLM provider/);
        assert.match(err.message, /anthropic/);
        return true;
      },
    );
  });

  it('requires an api key for the key-based providers', () => {
    for (const provider of ['anthropic', 'openai', 'grok', 'gemini']) {
      assert.throws(
        () => createProvider(provider, {}),
        /requires an API key/,
        `${provider} should require an API key`,
      );
    }
  });

  it('does not require an api key for bedrock', () => {
    // Bedrock authenticates through the AWS credential chain.
    assert.ok(createProvider('bedrock', {}));
  });

  it('accepts a region for bedrock', () => {
    assert.ok(createProvider('bedrock', { region: 'us-west-2' }));
  });

  it('accepts a custom baseUrl for openai-compatible providers', () => {
    assert.ok(createProvider('openai', { apiKey: 'k', baseUrl: 'https://example.test/v1' }));
    assert.ok(createProvider('grok', { apiKey: 'k', baseUrl: 'https://example.test/v1' }));
  });

  it('returns objects exposing the provider interface', () => {
    const provider = createProvider('anthropic', { apiKey: 'test-key' });
    assert.equal(typeof provider.complete, 'function');
  });
});

describe('getDefaultModels', () => {
  it('returns analysis and schema-filter models for each provider', () => {
    for (const provider of ['anthropic', 'openai', 'grok', 'bedrock', 'gemini']) {
      const models = getDefaultModels(provider);
      assert.ok(models, `${provider} should have defaults`);
      assert.equal(typeof models.analysis, 'string', `${provider}.analysis`);
      assert.equal(typeof models.schemaFilter, 'string', `${provider}.schemaFilter`);
      assert.ok(models.analysis.length > 0, `${provider}.analysis should be non-empty`);
      assert.ok(models.schemaFilter.length > 0, `${provider}.schemaFilter should be non-empty`);
    }
  });

  it('throws on an unknown provider', () => {
    assert.throws(() => getDefaultModels('nope'), /Unknown provider/);
  });

  it('returns a fresh object each call, so callers cannot mutate the defaults', () => {
    const first = getDefaultModels('anthropic');
    first.analysis = 'mutated';
    assert.notEqual(getDefaultModels('anthropic').analysis, 'mutated');
  });

  it('covers exactly the providers createProvider supports', () => {
    // Drift here means a provider can be constructed but has no default
    // models, which fails only once someone actually runs an analysis.
    for (const provider of ['anthropic', 'openai', 'grok', 'bedrock', 'gemini']) {
      assert.doesNotThrow(() => getDefaultModels(provider), `${provider} missing from MODEL_DEFAULTS`);
    }
  });
});
