import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveMerchant, resolveLlmConfig, UcBqConfig } from '../../src/lib/config';

function config(overrides: Partial<UcBqConfig> = {}): UcBqConfig {
  return {
    default_merchant: 'demo',
    merchants: {
      demo: { taxonomy_level: 'standard', dataset: 'ultracart_dw' },
      other: { taxonomy_level: 'high', dataset: 'other_dw' },
    },
    default_output_dir: './reports',
    output_format: 'png',
    chart_theme: 'default',
    chart_defaults: { width: 1200, height: 600 },
    ...overrides,
  };
}

describe('resolveMerchant', () => {
  it('falls back to default_merchant when none is given', () => {
    assert.equal(resolveMerchant(config()).merchant_id, 'demo');
  });

  it('honors an explicit merchant id', () => {
    const resolved = resolveMerchant(config(), 'other');
    assert.equal(resolved.merchant_id, 'other');
    assert.equal(resolved.taxonomy_level, 'high');
    assert.equal(resolved.dataset, 'other_dw');
  });

  it('derives the project id from the merchant id', () => {
    assert.equal(resolveMerchant(config()).project_id, 'ultracart-dw-demo');
  });

  it('lowercases the merchant id when deriving the project id', () => {
    // BigQuery project ids are lowercase, but merchant ids are entered by hand
    // and often typed uppercase.
    const cfg = config({ merchants: { DEMO: { taxonomy_level: 'standard', dataset: 'd' } } });
    assert.equal(resolveMerchant(cfg, 'DEMO').project_id, 'ultracart-dw-demo');
  });

  it('namespaces the output directory per merchant', () => {
    // Without this, two merchants would overwrite each other's reports.
    assert.match(resolveMerchant(config(), 'other').default_output_dir, /reports[/\\]other$/);
  });

  it('throws a message naming the available merchants', () => {
    assert.throws(
      () => resolveMerchant(config(), 'missing'),
      (err: Error) => {
        assert.match(err.message, /missing/);
        assert.match(err.message, /demo/);
        assert.match(err.message, /other/);
        return true;
      },
    );
  });

  it('defaults max_query_bytes to 10 GB when unset', () => {
    assert.equal(resolveMerchant(config()).max_query_bytes, 10 * 1024 * 1024 * 1024);
  });

  it('honors an explicit max_query_bytes', () => {
    assert.equal(resolveMerchant(config({ max_query_bytes: 500 })).max_query_bytes, 500);
  });

  it('preserves max_query_bytes: 0, which disables the guard', () => {
    // `??` rather than `||` matters here: 0 is a meaningful value, and
    // collapsing it to the default would re-enable a limit the user turned off.
    assert.equal(resolveMerchant(config({ max_query_bytes: 0 })).max_query_bytes, 0);
  });

  it('carries external_projects through', () => {
    const cfg = config({
      merchants: {
        demo: {
          taxonomy_level: 'standard',
          dataset: 'd',
          external_projects: { ads: { project_id: 'p', datasets: { ds: ['t'] } } },
        },
      },
    });
    assert.deepEqual(Object.keys(resolveMerchant(cfg, 'demo').external_projects ?? {}), ['ads']);
  });
});

describe('resolveLlmConfig', () => {
  const ANTHROPIC_KEY = 'ANTHROPIC_API_KEY';

  function withEnv<T>(vars: Record<string, string | undefined>, fn: () => T): T {
    const saved: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(vars)) {
      saved[k] = process.env[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    try {
      return fn();
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  }

  it('defaults to anthropic', () => {
    withEnv({ [ANTHROPIC_KEY]: undefined }, () => {
      assert.equal(resolveLlmConfig(config()).provider, 'anthropic');
    });
  });

  it('prefers an explicit override over the configured provider', () => {
    const cfg = config({ llm: { provider: 'openai' } });
    assert.equal(resolveLlmConfig(cfg, { provider: 'gemini' }).provider, 'gemini');
  });

  it('uses the configured provider when there is no override', () => {
    assert.equal(resolveLlmConfig(config({ llm: { provider: 'openai' } })).provider, 'openai');
  });

  it('prefers an explicit apiKey over the environment', () => {
    withEnv({ [ANTHROPIC_KEY]: 'from-env' }, () => {
      assert.equal(resolveLlmConfig(config(), { apiKey: 'explicit' }).apiKey, 'explicit');
    });
  });

  it('reads the provider default env var', () => {
    withEnv({ [ANTHROPIC_KEY]: 'from-env' }, () => {
      const resolved = resolveLlmConfig(config());
      assert.equal(resolved.apiKey, 'from-env');
      assert.equal(resolved.apiKeyEnv, ANTHROPIC_KEY);
    });
  });

  it('honors a custom api_key_env', () => {
    withEnv({ CUSTOM_KEY: 'custom-value' }, () => {
      const cfg = config({ llm: { provider: 'anthropic', api_key_env: 'CUSTOM_KEY' } });
      const resolved = resolveLlmConfig(cfg);
      assert.equal(resolved.apiKey, 'custom-value');
      assert.equal(resolved.apiKeyEnv, 'CUSTOM_KEY');
    });
  });

  it('maps each provider to its conventional env var', () => {
    const cases: Array<[string, string]> = [
      ['anthropic', 'ANTHROPIC_API_KEY'],
      ['openai', 'OPENAI_API_KEY'],
      ['grok', 'XAI_API_KEY'],
      ['gemini', 'GOOGLE_API_KEY'],
    ];
    for (const [provider, envVar] of cases) {
      withEnv({ [envVar]: `key-for-${provider}` }, () => {
        const resolved = resolveLlmConfig(config(), { provider });
        assert.equal(resolved.apiKey, `key-for-${provider}`, provider);
        assert.equal(resolved.apiKeyEnv, envVar, provider);
      });
    }
  });

  it('leaves the api key unset for bedrock, which uses the AWS credential chain', () => {
    const resolved = resolveLlmConfig(config(), { provider: 'bedrock' });
    assert.equal(resolved.apiKey, undefined);
  });

  it('leaves apiKey undefined when the env var is absent', () => {
    withEnv({ [ANTHROPIC_KEY]: undefined }, () => {
      assert.equal(resolveLlmConfig(config()).apiKey, undefined);
    });
  });

  it('passes model and region settings through', () => {
    const cfg = config({
      llm: { provider: 'bedrock', analysis_model: 'model-a', schema_filter_model: 'model-b', region: 'us-west-2' },
    });
    const resolved = resolveLlmConfig(cfg);
    assert.equal(resolved.analysisModel, 'model-a');
    assert.equal(resolved.schemaFilterModel, 'model-b');
    assert.equal(resolved.region, 'us-west-2');
  });
});
