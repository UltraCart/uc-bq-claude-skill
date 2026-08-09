import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { flattenRow, getExternalTables } from '../../src/lib/bigquery';
import { ResolvedMerchantConfig } from '../../src/lib/config';

/**
 * flattenRow normalizes the wrapper objects the BigQuery client returns —
 * `{ value: '2026-03-21' }` for dates, and Big-style `{ s, e, c }` objects for
 * NUMERIC/BIGNUMERIC — into plain JSON. Everything downstream (charts,
 * analysis prompts, alarm metrics) assumes that has happened.
 */
describe('flattenRow', () => {
  it('passes primitives through unchanged', () => {
    const row = { name: 'widget', count: 42, active: true, missing: null };
    assert.deepEqual(flattenRow(row), row);
  });

  it('unwraps BigQuery date/timestamp objects', () => {
    assert.deepEqual(
      flattenRow({ order_date: { value: '2026-03-21' } }),
      { order_date: '2026-03-21' },
    );
  });

  it('converts Big-style NUMERIC objects to numbers', () => {
    // The real client returns a Big instance; what matters to flattenRow is
    // the s/e/c shape plus a toString.
    const big = { s: 1, e: 2, c: [1, 2, 3], toString: () => '123.45' };
    assert.deepEqual(flattenRow({ revenue: big }), { revenue: 123.45 });
  });

  it('handles negative NUMERIC values', () => {
    const big = { s: -1, e: 1, c: [5, 0], toString: () => '-50.5' };
    assert.deepEqual(flattenRow({ delta: big }), { delta: -50.5 });
  });

  it('does not unwrap an object that merely has a value key alongside others', () => {
    // Only a lone `value` key marks a BigQuery date wrapper. Unwrapping a
    // record that happens to contain `value` would silently drop its siblings.
    const row = { thing: { value: 'x', label: 'y' } };
    assert.deepEqual(flattenRow(row), { thing: { value: 'x', label: 'y' } });
  });

  it('recurses into nested records', () => {
    assert.deepEqual(
      flattenRow({ nested: { when: { value: '2026-01-01' }, count: 3 } }),
      { nested: { when: '2026-01-01', count: 3 } },
    );
  });

  it('maps over arrays, flattening each element', () => {
    assert.deepEqual(
      flattenRow({ days: [{ value: '2026-01-01' }, { value: '2026-01-02' }] }),
      { days: ['2026-01-01', '2026-01-02'] },
    );
  });

  it('preserves arrays of primitives', () => {
    assert.deepEqual(flattenRow({ tags: ['a', 'b'] }), { tags: ['a', 'b'] });
  });

  it('preserves null and undefined', () => {
    assert.deepEqual(flattenRow({ a: null, b: undefined }), { a: null, b: undefined });
  });

  it('returns an empty object for an empty row', () => {
    assert.deepEqual(flattenRow({}), {});
  });

  it('produces output that survives JSON round-tripping', () => {
    // The result is written to data.json, so nothing exotic may survive.
    const big = { s: 1, e: 0, c: [7], toString: () => '7' };
    const flattened = flattenRow({ d: { value: '2026-01-01' }, n: big, s: 'x' });
    assert.deepEqual(JSON.parse(JSON.stringify(flattened)), { d: '2026-01-01', n: 7, s: 'x' });
  });
});

describe('getExternalTables', () => {
  function config(external?: ResolvedMerchantConfig['external_projects']): ResolvedMerchantConfig {
    return {
      merchant_id: 'demo',
      project_id: 'ultracart-dw-demo',
      taxonomy_level: 'standard',
      dataset: 'ultracart_dw',
      default_output_dir: './reports/demo',
      output_format: 'png',
      chart_theme: 'default',
      chart_defaults: { width: 1200, height: 600 },
      external_projects: external,
      max_query_bytes: 0,
    };
  }

  it('returns an empty list when no external projects are configured', () => {
    assert.deepEqual(getExternalTables(config()), []);
    assert.deepEqual(getExternalTables(config({})), []);
  });

  it('flattens projects, datasets and tables into one list', () => {
    const result = getExternalTables(config({
      ads: {
        project_id: 'my-ads-project',
        description: 'Ad spend',
        datasets: { google_ads: ['campaigns', 'keywords'] },
      },
    }));

    assert.equal(result.length, 2);
    assert.deepEqual(result[0], {
      alias: 'ads',
      projectId: 'my-ads-project',
      description: 'Ad spend',
      dataset: 'google_ads',
      table: 'campaigns',
      fullyQualified: 'my-ads-project.google_ads.campaigns',
    });
    assert.equal(result[1].fullyQualified, 'my-ads-project.google_ads.keywords');
  });

  it('handles several datasets across several projects', () => {
    const result = getExternalTables(config({
      ads: { project_id: 'p1', datasets: { d1: ['t1'], d2: ['t2'] } },
      crm: { project_id: 'p2', datasets: { d3: ['t3'] } },
    }));

    assert.equal(result.length, 3);
    assert.deepEqual(
      result.map((r) => r.fullyQualified).sort(),
      ['p1.d1.t1', 'p1.d2.t2', 'p2.d3.t3'],
    );
  });

  it('omits description when the project does not set one', () => {
    const [first] = getExternalTables(config({
      ads: { project_id: 'p1', datasets: { d1: ['t1'] } },
    }));
    assert.equal(first.description, undefined);
  });

  it('skips a dataset with no tables', () => {
    assert.deepEqual(getExternalTables(config({
      ads: { project_id: 'p1', datasets: { empty: [] } },
    })), []);
  });
});
