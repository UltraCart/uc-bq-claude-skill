import { Command } from 'commander';
import * as fs from 'fs';
import { loadConfig, resolveMerchant } from '../lib/config';
import { executeQuery, QueryParameter } from '../lib/bigquery';
import { substituteParams } from '../lib/template';
import { resolveRelativeDate } from '../lib/params';

export const dryRunCommand = new Command('dry-run')
  .description('Estimate query cost without executing')
  .option('--file <path>', 'Path to SQL file')
  .option('--sql <sql>', 'Inline SQL string')
  .option('--params <json>', 'JSON string of parameter values')
  .action(async (options, cmd: Command) => {
    try {
      if (!options.file && !options.sql) {
        console.error('Error: Specify --file or --sql.');
        process.exit(1);
      }

      const config = loadConfig();
      const globalOpts = cmd.optsWithGlobals ? cmd.optsWithGlobals() : (cmd.parent?.opts() || {});
      const merchant = resolveMerchant(config, globalOpts.merchant);

      // Load SQL
      let sql: string;
      if (options.file) {
        if (!fs.existsSync(options.file)) {
          console.error(`Error: SQL file not found: ${options.file}`);
          process.exit(1);
        }
        sql = fs.readFileSync(options.file, 'utf-8');
      } else {
        sql = options.sql;
      }

      // Parse and substitute parameters, resolving any relative date expressions
      const rawParams: Record<string, string> = options.params ? JSON.parse(options.params) : {};
      const params: Record<string, string> = {};
      for (const [name, value] of Object.entries(rawParams)) {
        params[name] = resolveRelativeDate(value);
      }
      sql = substituteParams(sql, params);

      // Build query parameters array
      const queryParams: QueryParameter[] = Object.entries(params).map(([name, value]) => ({
        name,
        type: 'STRING' as const,
        value,
      }));

      // Execute dry run
      const result = await executeQuery(merchant, sql, queryParams, { dryRun: true });

      const bytesProcessed = result.bytesProcessed;
      const estimatedCost = (bytesProcessed / (1024 * 1024 * 1024 * 1024)) * 6.25; // $6.25/TB on-demand

      console.log('');
      console.log(`  Dry Run Results`);
      console.log('  ' + '─'.repeat(50));
      console.log(`  Estimated bytes processed: ${formatBytes(bytesProcessed)}`);
      console.log(`  Estimated cost: $${estimatedCost.toFixed(4)} (on-demand pricing)`);
      console.log('');
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + units[i];
}
