import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { loadConfig, resolveMerchant } from '../lib/config';
import { loadManifest } from '../lib/manifest';

export const historyCommand = new Command('history')
  .description('Show run history for a report')
  .argument('<report-name>', 'Name of the report directory under ./reports/')
  .action(async (reportName: string, _options: any, cmd: Command) => {
    try {
      if (reportName.includes('..') || reportName.includes('/') || reportName.includes('\\')) {
        throw new Error('Invalid report name');
      }

      const config = loadConfig();
      const globalOpts = cmd.optsWithGlobals ? cmd.optsWithGlobals() : (cmd.parent?.opts() || {});
      const merchant = resolveMerchant(config, globalOpts.merchant);
      const reportsDir = path.resolve(merchant.default_output_dir);
      const reportDir = path.join(reportsDir, reportName);

      if (!fs.existsSync(reportDir)) {
        console.error(`Error: Report directory not found: ${reportDir}`);
        process.exit(1);
      }

      const manifestPath = path.join(reportDir, 'report.yaml');
      if (!fs.existsSync(manifestPath)) {
        console.error(`Error: Manifest not found: ${path.relative(process.cwd(), manifestPath)}`);
        process.exit(1);
      }

      const manifest = loadManifest(reportDir);
      const history = manifest.run_history || [];

      console.log('');
      console.log(`  ${manifest.name} — Run History`);
      console.log('  ' + '─'.repeat(60));

      if (history.length === 0) {
        console.log('  No run history found.');
        console.log('');
        return;
      }

      // Build param summary strings for each run
      const paramSummaries = history.map((entry: any) => {
        if (!entry.parameters || Object.keys(entry.parameters).length === 0) {
          return '(none)';
        }
        return Object.entries(entry.parameters)
          .map(([k, v]) => {
            const shortKey = k.replace(/_/g, '').substring(0, 8);
            const shortVal = String(v).length > 12 ? String(v).substring(0, 12) : String(v);
            return `${shortKey}=${shortVal}`;
          })
          .join('  ');
      });

      // Column widths
      const dateW = 13;
      const paramW = Math.max(20, ...paramSummaries.map((s: string) => s.length)) + 2;
      const rowsW = 10;
      const costW = 10;

      // Header
      console.log(
        '  ' +
        'Run Date'.padEnd(dateW) +
        'Parameters'.padEnd(paramW) +
        'Rows'.padEnd(rowsW) +
        'Cost'.padEnd(costW)
      );
      console.log(
        '  ' +
        '─'.repeat(dateW) +
        '─'.repeat(paramW) +
        '─'.repeat(rowsW) +
        '─'.repeat(costW)
      );

      // Rows
      for (let i = 0; i < history.length; i++) {
        const entry = history[i];
        const date = entry.run_date || '--';
        const params = paramSummaries[i];
        const rows = entry.rows_returned != null
          ? entry.rows_returned.toLocaleString()
          : '--';
        const cost = entry.bytes_processed != null
          ? `$${((entry.bytes_processed / (1024 * 1024 * 1024 * 1024)) * 6.25).toFixed(3)}`
          : '--';

        console.log(
          '  ' +
          date.padEnd(dateW) +
          params.padEnd(paramW) +
          rows.padEnd(rowsW) +
          cost.padEnd(costW)
        );
      }

      console.log('');
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });
