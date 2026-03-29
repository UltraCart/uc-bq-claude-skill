import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { loadConfig, resolveMerchant } from '../lib/config';
import { listReports } from '../lib/manifest';

export const listCommand = new Command('list')
  .description('List saved reports with status and parameters')
  .action(async (_options: any, cmd: Command) => {
    try {
      const config = loadConfig();
      const globalOpts = cmd.optsWithGlobals ? cmd.optsWithGlobals() : (cmd.parent?.opts() || {});
      const merchant = resolveMerchant(config, globalOpts.merchant);
      const reportsDir = path.resolve(merchant.default_output_dir);

      if (!fs.existsSync(reportsDir)) {
        console.log('No reports directory found. Run "uc-bq init" first.');
        return;
      }

      const reports = listReports(reportsDir);
      if (reports.length === 0) {
        console.log('No reports found in ' + reportsDir);
        return;
      }

      // Column widths
      const nameW = Math.max(6, ...reports.map((r) => r.name.length)) + 2;
      const runW = 12;
      const descW = 30;

      console.log('');
      console.log(`  Reports for merchant: ${merchant.merchant_id}`);
      console.log('');

      // Header
      console.log(
        '  ' +
        'Name'.padEnd(nameW) +
        'Last Run'.padEnd(runW) +
        'Description'.padEnd(descW)
      );
      console.log(
        '  ' +
        '─'.repeat(nameW) +
        '─'.repeat(runW) +
        '─'.repeat(descW)
      );

      // Rows
      for (const row of reports) {
        console.log(
          '  ' +
          row.name.padEnd(nameW) +
          row.lastRun.padEnd(runW) +
          row.description.padEnd(descW)
        );
      }

      console.log('');
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });
