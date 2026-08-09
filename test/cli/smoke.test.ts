import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, execFileSync as _exec } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { withTempDir, writeFile } from '../helpers/tmp';

/**
 * End-to-end smoke tests against the real built CLI.
 *
 * These run `dist/cli.js` as a subprocess, so they catch the failures the unit
 * tests structurally cannot: a bad require in a lazily-loaded module, a
 * command that throws before parsing arguments, an ESM/CJS mismatch introduced
 * by a dependency bump. Nothing here touches BigQuery or an LLM.
 */

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const CLI = path.join(REPO_ROOT, 'dist', 'cli.js');

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], options: { cwd?: string } = {}): RunResult {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], {
      cwd: options.cwd ?? REPO_ROOT,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30_000,
    });
    return { status: 0, stdout, stderr: '' };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

describe('CLI smoke tests', () => {
  before(() => {
    // The suite compiles to dist-test/, but these exercise the shipped
    // dist/ build, so make sure it exists and is current.
    _exec('npm', ['run', 'build'], { cwd: REPO_ROOT, stdio: 'ignore' });
    assert.ok(fs.existsSync(CLI), `expected built CLI at ${CLI}`);
  });

  it('reports its version', () => {
    const { status, stdout } = runCli(['--version']);
    assert.equal(status, 0);
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf-8'));
    assert.equal(stdout.trim(), pkg.version);
  });

  it('prints help listing the documented commands', () => {
    const { status, stdout } = runCli(['--help']);
    assert.equal(status, 0);
    for (const command of ['init', 'schema', 'query', 'dry-run', 'validate', 'render', 'run', 'run-all', 'list', 'history']) {
      assert.match(stdout, new RegExp(`\\b${command}\\b`), `help should mention ${command}`);
    }
  });

  it('exits non-zero on an unknown command', () => {
    const { status } = runCli(['definitely-not-a-command']);
    assert.notEqual(status, 0);
  });

  it('prints help for each subcommand without executing it', () => {
    // Catches a module that throws at import time — the failure mode a bumped
    // dependency is most likely to introduce.
    for (const command of ['init', 'schema', 'query', 'dry-run', 'validate', 'render', 'run', 'run-all', 'list', 'history']) {
      const { status, stdout, stderr } = runCli([command, '--help']);
      assert.equal(status, 0, `${command} --help exited ${status}: ${stderr}`);
      assert.ok(stdout.length > 0, `${command} --help produced no output`);
    }
  });

  // `validate --config` is a boolean flag: it validates the .ultracart-bq.json
  // discovered from the working directory, so these run the CLI with cwd set
  // to a temp directory containing one. That also exercises config discovery.
  it('validates a good config file, including max_query_bytes', () => {
    withTempDir((dir) => {
      writeFile(dir, '.ultracart-bq.json', JSON.stringify({
        default_merchant: 'demo',
        merchants: { demo: { taxonomy_level: 'standard', dataset: 'ultracart_dw' } },
        max_query_bytes: 5_000_000_000,
      }));

      const { status, stdout, stderr } = runCli(['validate', '--config'], { cwd: dir });
      assert.equal(status, 0, `expected success, got: ${stderr || stdout}`);
    });
  });

  it('rejects an invalid config file with a non-zero exit', () => {
    withTempDir((dir) => {
      writeFile(dir, '.ultracart-bq.json', JSON.stringify({ merchants: {} }));

      const { status } = runCli(['validate', '--config'], { cwd: dir });
      assert.notEqual(status, 0, 'invalid config should fail validation');
    });
  });

  it('validates a manifest that uses alarms', () => {
    // Regression guard at the CLI level for the schema gap: this exact file
    // was rejected before alarms were added to report-manifest.schema.json.
    withTempDir((dir) => {
      const manifestPath = writeFile(dir, 'report.yaml', [
        'name: daily-revenue',
        'description: Revenue by day',
        'created: "2026-01-01"',
        'last_run: "2026-01-01"',
        'prompt: Show revenue by day',
        'config:',
        '  merchant_id: demo',
        '  project_id: ultracart-dw-demo',
        '  taxonomy_level: standard',
        '  dataset: ultracart_dw',
        '  tables_used:',
        '    - orders',
        'sql_file: query.sql',
        'chart:',
        '  type: line',
        '  echarts_file: chart.js',
        '  output_format: png',
        '  width: 1200',
        '  height: 600',
        'alarms:',
        '  - name: low_revenue',
        '    type: threshold',
        '    metric: revenue',
        '    operator: "<"',
        '    value: 1000',
        '    severity: high',
        '',
      ].join('\n'));

      const { status, stdout, stderr } = runCli(['validate', '--manifest', manifestPath]);
      assert.equal(status, 0, `expected success, got: ${stderr || stdout}`);
    });
  });

  it('reports a clear error when no config is present', () => {
    withTempDir((dir) => {
      const { status, stdout, stderr } = runCli(['list'], { cwd: dir });
      const output = stdout + stderr;
      assert.notEqual(status, 0);
      assert.match(output, /config/i, 'error should mention the missing config');
    });
  });
});
