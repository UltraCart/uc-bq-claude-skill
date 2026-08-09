import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import {
  loadManifest,
  saveManifest,
  addRunHistoryEntry,
  listReports,
  getRunHistory,
  ReportManifest,
} from '../../src/lib/manifest';
import { withTempDir, writeFile } from '../helpers/tmp';

function manifest(overrides: Partial<ReportManifest> = {}): ReportManifest {
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
    chart: { type: 'line', echarts_file: 'chart.js', output_format: 'png', width: 1200, height: 600 },
    ...overrides,
  };
}

describe('saveManifest / loadManifest', () => {
  it('round-trips a manifest through YAML', () => {
    withTempDir((dir) => {
      const original = manifest();
      saveManifest(dir, original);
      assert.deepEqual(loadManifest(dir), original);
    });
  });

  it('writes to report.yaml', () => {
    withTempDir((dir) => {
      saveManifest(dir, manifest());
      assert.ok(fs.existsSync(path.join(dir, 'report.yaml')));
    });
  });

  it('round-trips alarms and delivery config', () => {
    withTempDir((dir) => {
      const original = manifest({
        alarms: [
          { name: 'low_rev', type: 'threshold', metric: 'revenue', operator: '<', value: 100, severity: 'high', cooldown: '24h' },
        ],
        delivery: {
          mode: 'alarm_only',
          slack: { channels: ['C0123456789'], mention_on_alarm: '<!here>' },
        },
      });
      saveManifest(dir, original);
      assert.deepEqual(loadManifest(dir), original);
    });
  });

  it('round-trips parameters and run history', () => {
    withTempDir((dir) => {
      const original = manifest({
        parameters: [
          { name: 'start_date', type: 'date', label: 'Start', description: 'From', required: true, default: '-30d' },
        ],
        run_history: [
          { run_date: '2026-01-02', parameters: { start_date: '2025-12-03' }, status: 'success', rows_returned: 31 },
        ],
      });
      saveManifest(dir, original);
      assert.deepEqual(loadManifest(dir), original);
    });
  });

  it('keeps date-like strings as strings rather than Date objects', () => {
    // The JSON_SCHEMA loader is what prevents YAML from auto-converting
    // 2026-01-01 into a timestamp; a Date here would break JSON.stringify
    // round-tripping and SQL parameter substitution.
    withTempDir((dir) => {
      saveManifest(dir, manifest({ created: '2026-01-01', last_run: '2026-06-15' }));
      const loaded = loadManifest(dir);
      assert.equal(typeof loaded.created, 'string');
      assert.equal(loaded.created, '2026-01-01');
      assert.equal(typeof loaded.last_run, 'string');
    });
  });

  it('preserves strings that YAML would otherwise coerce', () => {
    withTempDir((dir) => {
      const original = manifest({ description: 'yes', prompt: '12345' });
      saveManifest(dir, original);
      const loaded = loadManifest(dir);
      assert.equal(loaded.description, 'yes');
      assert.equal(typeof loaded.prompt, 'string');
    });
  });

  it('throws when the manifest is absent', () => {
    withTempDir((dir) => {
      assert.throws(() => loadManifest(dir), /ENOENT/);
    });
  });
});

describe('addRunHistoryEntry', () => {
  it('creates the history array on first use', () => {
    const m = manifest();
    addRunHistoryEntry(m, { run_date: '2026-02-01', parameters: {}, status: 'success' });
    assert.equal(m.run_history?.length, 1);
  });

  it('appends to existing history', () => {
    const m = manifest({ run_history: [{ run_date: '2026-01-01', parameters: {} }] });
    addRunHistoryEntry(m, { run_date: '2026-02-01', parameters: {}, status: 'success' });
    assert.equal(m.run_history?.length, 2);
    assert.equal(m.run_history?.[1].run_date, '2026-02-01');
  });

  it('advances last_run to the new entry', () => {
    const m = manifest({ last_run: '2026-01-01' });
    addRunHistoryEntry(m, { run_date: '2026-02-01', parameters: {}, status: 'success' });
    assert.equal(m.last_run, '2026-02-01');
  });

  it('records failures too', () => {
    const m = manifest();
    addRunHistoryEntry(m, { run_date: '2026-02-01', parameters: {}, status: 'error', error_message: 'boom' });
    assert.equal(m.run_history?.[0].status, 'error');
    assert.equal(m.run_history?.[0].error_message, 'boom');
  });
});

describe('listReports', () => {
  it('returns an empty list when the directory does not exist', () => {
    assert.deepEqual(listReports('/nonexistent/path/for/test'), []);
  });

  it('returns an empty list for an empty directory', () => {
    withTempDir((dir) => assert.deepEqual(listReports(dir), []));
  });

  it('lists directories containing a manifest', () => {
    withTempDir((dir) => {
      fs.mkdirSync(path.join(dir, 'report-a'));
      saveManifest(path.join(dir, 'report-a'), manifest({ name: 'A', description: 'first' }));
      fs.mkdirSync(path.join(dir, 'report-b'));
      saveManifest(path.join(dir, 'report-b'), manifest({ name: 'B', description: 'second' }));

      const reports = listReports(dir);
      assert.equal(reports.length, 2);
      assert.deepEqual(reports.map((r) => r.name).sort(), ['A', 'B']);
      assert.deepEqual(reports.map((r) => r.dir).sort(), ['report-a', 'report-b']);
    });
  });

  it('skips directories without a manifest, and loose files', () => {
    withTempDir((dir) => {
      fs.mkdirSync(path.join(dir, 'not-a-report'));
      writeFile(dir, 'stray.txt', 'hello');
      fs.mkdirSync(path.join(dir, 'real'));
      saveManifest(path.join(dir, 'real'), manifest({ name: 'Real' }));

      const reports = listReports(dir);
      assert.equal(reports.length, 1);
      assert.equal(reports[0].name, 'Real');
    });
  });
});

describe('getRunHistory', () => {
  it('reports when there is no history', () => {
    assert.match(getRunHistory(manifest()), /No run history/);
    assert.match(getRunHistory(manifest({ run_history: [] })), /No run history/);
  });

  it('numbers entries and includes date, status and parameters', () => {
    const m = manifest({
      run_history: [
        { run_date: '2026-01-01', parameters: { start: '2025-12-01' }, status: 'success', rows_returned: 10 },
        { run_date: '2026-01-02', parameters: {}, status: 'error', error_message: 'timeout' },
      ],
    });
    const output = getRunHistory(m);
    assert.match(output, /1\. 2026-01-01 \[success\]/);
    assert.match(output, /start=2025-12-01/);
    assert.match(output, /10 rows/);
    assert.match(output, /2\. 2026-01-02 \[error\]/);
    assert.match(output, /timeout/);
    assert.equal(output.split('\n').length, 2);
  });

  it('labels a missing status as unknown', () => {
    const m = manifest({ run_history: [{ run_date: '2026-01-01', parameters: {} }] });
    assert.match(getRunHistory(m), /\[unknown\]/);
  });

  it('renders bytes processed in MB', () => {
    const m = manifest({
      run_history: [{ run_date: '2026-01-01', parameters: {}, bytes_processed: 5 * 1024 * 1024 }],
    });
    assert.match(getRunHistory(m), /5\.0MB processed/);
  });
});
