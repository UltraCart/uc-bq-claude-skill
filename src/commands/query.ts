import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { loadConfig, resolveMerchant } from '../lib/config';
import { executeQuery, QueryParameter } from '../lib/bigquery';
import { substituteParams } from '../lib/template';

export const queryCommand = new Command('query')
  .description('Execute SQL against BigQuery and return results')
  .option('--file <path>', 'Path to SQL file')
  .option('--sql <sql>', 'Inline SQL string')
  .option('--params <json>', 'JSON string of parameter values')
  .option('--sample <rows>', 'Max rows to display (default: 20)', '20')
  .option('--output <path>', 'Save full results to JSON file')
  .option('--force', 'Skip cost safety check')
  .option('--max-bytes <bytes>', 'Max bytes processed before aborting (default: 10 GB)')
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
          console.error(`Error: SQL file not found: ${path.relative(process.cwd(), options.file)}`);
          process.exit(1);
        }
        sql = fs.readFileSync(options.file, 'utf-8');
      } else {
        sql = options.sql;
      }

      // Parse and substitute parameters
      const params: Record<string, string> = options.params ? JSON.parse(options.params) : {};
      sql = substituteParams(sql, params);

      // Build query parameters array
      const queryParams: QueryParameter[] = Object.entries(params).map(([name, value]) => ({
        name,
        type: 'STRING' as const,
        value,
      }));

      // Execute query
      const result = await executeQuery(merchant, sql, queryParams, {
        force: options.force,
        maxBytes: options.maxBytes ? parseInt(options.maxBytes, 10) : undefined,
      });
      const sampleSize = parseInt(options.sample, 10);
      const sampleRows = result.rows.slice(0, sampleSize);

      // Display results
      console.log('');
      console.log(`  Query Results`);
      console.log('  ' + '─'.repeat(50));
      console.log(`  Total rows: ${result.totalRows}`);
      console.log(`  Bytes processed: ${formatBytes(result.bytesProcessed)}`);
      console.log('');

      if (sampleRows.length > 0) {
        // Get column names from first row
        const columns = Object.keys(sampleRows[0]);
        const colWidths = columns.map((col) => {
          const maxVal = Math.max(
            col.length,
            ...sampleRows.map((row) => String(row[col] ?? '').length)
          );
          return Math.min(maxVal + 2, 40);
        });

        // Header
        const header = columns.map((col, i) => col.padEnd(colWidths[i])).join('');
        console.log('  ' + header);
        console.log('  ' + colWidths.map((w) => '─'.repeat(w)).join(''));

        // Rows
        for (const row of sampleRows) {
          const line = columns
            .map((col, i) => {
              const val = String(row[col] ?? '');
              return val.length > colWidths[i] - 2
                ? val.substring(0, colWidths[i] - 4) + '..'
                : val.padEnd(colWidths[i]);
            })
            .join('');
          console.log('  ' + line);
        }

        if (result.totalRows > sampleSize) {
          console.log('');
          console.log(`  Showing ${sampleRows.length} of ${result.totalRows} rows`);
        }
      } else {
        console.log('  (no rows returned)');
      }
      console.log('');

      // Save full results if requested
      if (options.output) {
        const outputData = {
          rows: result.rows,
          totalRows: result.totalRows,
          bytesProcessed: result.bytesProcessed,
        };
        fs.writeFileSync(options.output, JSON.stringify(outputData, null, 2));
        console.log(`  Results saved to ${path.relative(process.cwd(), options.output)}`);
        console.log('');
      }
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
