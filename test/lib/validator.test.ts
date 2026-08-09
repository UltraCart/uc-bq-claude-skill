import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig, validateManifest } from '../../src/lib/validator';

/**
 * These run against the real schemas in schemas/, not fixtures, because the
 * defect they guard against is drift between the TypeScript interfaces and the
 * schema files. Both schemas set additionalProperties: false, so any option
 * the code supports but the schema omits makes `uc-bq validate` reject a
 * perfectly good file.
 */

function minimalConfig(): Record<string, unknown> {
  return {
    default_merchant: 'demo',
    merchants: {
      demo: { taxonomy_level: 'standard', dataset: 'ultracart_dw' },
    },
  };
}

function minimalManifest(): Record<string, unknown> {
  return {
    name: 'daily-revenue',
    description: 'Revenue by day',
    created: '2026-01-01',
    last_run: '2026-01-01',
    prompt: 'Show revenue by day',
    config: {
      merchant_id: 'demo',
      project_id: 'ultracart-dw-demo',
      taxonomy_level: 'standard',
      dataset: 'ultracart_dw',
      tables_used: ['orders'],
    },
    sql_file: 'query.sql',
    chart: {
      type: 'line',
      echarts_file: 'chart.js',
      output_format: 'png',
      width: 1200,
      height: 600,
    },
  };
}

describe('validateConfig', () => {
  it('accepts a minimal config', () => {
    const result = validateConfig(minimalConfig());
    assert.equal(result.valid, true, result.errors.join('; '));
  });

  it('accepts max_query_bytes', () => {
    // Regression: max_query_bytes is read by resolveMerchant and documented as
    // a supported option, but was absent from the schema. With
    // additionalProperties: false that made every config using it invalid.
    const result = validateConfig({ ...minimalConfig(), max_query_bytes: 5_000_000_000 });
    assert.equal(result.valid, true, result.errors.join('; '));
  });

  it('accepts max_query_bytes: 0, which disables the check', () => {
    const result = validateConfig({ ...minimalConfig(), max_query_bytes: 0 });
    assert.equal(result.valid, true, result.errors.join('; '));
  });

  it('accepts a fully-populated config', () => {
    const result = validateConfig({
      ...minimalConfig(),
      default_output_dir: './reports',
      output_format: 'both',
      chart_theme: 'dark',
      chart_defaults: { width: 1600, height: 900 },
      max_query_bytes: 10_737_418_240,
      llm: {
        provider: 'anthropic',
        api_key_env: 'ANTHROPIC_API_KEY',
        analysis_model: 'claude-opus-5',
        schema_filter_model: 'claude-haiku-4-5-20251001',
      },
    });
    assert.equal(result.valid, true, result.errors.join('; '));
  });

  it('rejects a config missing required fields', () => {
    assert.equal(validateConfig({}).valid, false);
    assert.equal(validateConfig({ default_merchant: 'demo' }).valid, false);
  });

  it('rejects an unknown top-level key', () => {
    const result = validateConfig({ ...minimalConfig(), not_a_real_option: true });
    assert.equal(result.valid, false);
  });

  it('rejects an out-of-range chart size', () => {
    const result = validateConfig({
      ...minimalConfig(),
      chart_defaults: { width: 10, height: 10 },
    });
    assert.equal(result.valid, false);
  });

  it('reports errors with a path and a message', () => {
    const result = validateConfig({ ...minimalConfig(), output_format: 'gif' });
    assert.equal(result.valid, false);
    assert.ok(result.errors.length > 0);
    assert.match(result.errors[0], /output_format/);
  });
});

describe('validateManifest', () => {
  it('accepts a minimal manifest', () => {
    const result = validateManifest(minimalManifest());
    assert.equal(result.valid, true, result.errors.join('; '));
  });

  it('accepts alarms', () => {
    // Regression: the entire alarm subsystem (evaluateAlarms, alarm_state.json,
    // alarm notifications) was unrepresented in the schema, so any manifest
    // using it failed validation.
    const result = validateManifest({
      ...minimalManifest(),
      alarms: [
        {
          name: 'revenue_drop',
          type: 'threshold',
          metric: 'revenue',
          aggregate: 'sum',
          operator: '<',
          value: 1000,
          severity: 'high',
          cooldown: '24h',
        },
      ],
    });
    assert.equal(result.valid, true, result.errors.join('; '));
  });

  it('accepts every alarm type', () => {
    for (const alarm of [
      { name: 'a', type: 'threshold', metric: 'revenue', operator: '<', value: 1, severity: 'low' },
      { name: 'b', type: 'pct_change', metric: 'revenue', operator: '<', value: -20, compare_to: 'previous_run', severity: 'high' },
      { name: 'c', type: 'missing_data', severity: 'critical' },
    ]) {
      const result = validateManifest({ ...minimalManifest(), alarms: [alarm] });
      assert.equal(result.valid, true, `${alarm.type}: ${result.errors.join('; ')}`);
    }
  });

  it('accepts every aggregate and operator the evaluator implements', () => {
    for (const aggregate of ['sum', 'avg', 'min', 'max', 'first', 'last']) {
      const result = validateManifest({
        ...minimalManifest(),
        alarms: [{ name: 'a', type: 'threshold', metric: 'm', aggregate, operator: '>', value: 1, severity: 'low' }],
      });
      assert.equal(result.valid, true, `aggregate ${aggregate}: ${result.errors.join('; ')}`);
    }

    for (const operator of ['<', '>', '<=', '>=', '==', '!=']) {
      const result = validateManifest({
        ...minimalManifest(),
        alarms: [{ name: 'a', type: 'threshold', metric: 'm', operator, value: 1, severity: 'low' }],
      });
      assert.equal(result.valid, true, `operator ${operator}: ${result.errors.join('; ')}`);
    }
  });

  it('accepts cooldown formats the parser understands, and "0"', () => {
    for (const cooldown of ['24h', '7d', '30m', '0']) {
      const result = validateManifest({
        ...minimalManifest(),
        alarms: [{ name: 'a', type: 'missing_data', severity: 'low', cooldown }],
      });
      assert.equal(result.valid, true, `cooldown ${cooldown}: ${result.errors.join('; ')}`);
    }
  });

  it('rejects an unknown alarm type or severity', () => {
    assert.equal(
      validateManifest({ ...minimalManifest(), alarms: [{ name: 'a', type: 'nonsense', severity: 'low' }] }).valid,
      false,
    );
    assert.equal(
      validateManifest({ ...minimalManifest(), alarms: [{ name: 'a', type: 'missing_data', severity: 'urgent' }] }).valid,
      false,
    );
  });

  it('accepts delivery.mode and slack.mention_on_alarm', () => {
    // Both are honored by the delivery code but were missing from the schema.
    const result = validateManifest({
      ...minimalManifest(),
      delivery: {
        mode: 'alarm_only',
        slack: { channels: ['C0123456789'], mention_on_alarm: '<!here>' },
      },
    });
    assert.equal(result.valid, true, result.errors.join('; '));
  });

  it('accepts analysis.landscape', () => {
    const result = validateManifest({
      ...minimalManifest(),
      analysis: { include: true, prompt_file: 'analysis_prompt.md', output_file: 'report.md', landscape: true },
    });
    assert.equal(result.valid, true, result.errors.join('; '));
  });

  it('accepts a fully-populated manifest', () => {
    // The broadest guard: everything the TypeScript interfaces allow, in one
    // document. If an interface grows a field and the schema does not, this
    // fails.
    const result = validateManifest({
      ...minimalManifest(),
      refinements: ['Group by week instead of day'],
      parameters: [
        {
          name: 'start_date',
          type: 'date',
          label: 'Start date',
          description: 'Beginning of range',
          required: true,
          default: '-30d',
        },
      ],
      run_history: [
        {
          run_date: '2026-01-02',
          parameters: { start_date: '2025-12-03' },
          status: 'success',
          rows_returned: 31,
          bytes_processed: 1048576,
        },
      ],
      analysis: { include: true, landscape: false },
      alarms: [{ name: 'no_data', type: 'missing_data', severity: 'critical', cooldown: '12h' }],
      delivery: {
        mode: 'always',
        slack: { channels: ['C0123456789'], mention_on_alarm: '<!channel>' },
        email: { to: ['ops@example.com'], subject: 'Daily revenue', provider: 'sendgrid' },
      },
    });
    assert.equal(result.valid, true, result.errors.join('; '));
  });

  it('rejects a manifest missing required fields', () => {
    assert.equal(validateManifest({}).valid, false);
    const { name, ...withoutName } = minimalManifest();
    void name;
    assert.equal(validateManifest(withoutName).valid, false);
  });

  it('rejects an unknown top-level key', () => {
    assert.equal(validateManifest({ ...minimalManifest(), bogus: 1 }).valid, false);
  });
});
