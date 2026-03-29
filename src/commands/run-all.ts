import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { loadConfig, resolveMerchant, resolveLlmConfig } from '../lib/config';
import { createProvider } from '../lib/llm';
import { getDefaultModels } from '../lib/llm/models';
import { executeQuery, QueryParameter } from '../lib/bigquery';
import { listReports, loadManifest, saveManifest, addRunHistoryEntry } from '../lib/manifest';
import { resolveParameters, ReportParameter } from '../lib/params';
import { substituteParams } from '../lib/template';
import { renderChart } from '../lib/renderer';
import { generateAnalysis } from '../lib/analysis';
import { generatePdf } from '../lib/pdf';
import { deliverReport } from '../lib/deliver';

function safePath(baseDir: string, relativePath: string): string {
  const resolved = path.resolve(baseDir, relativePath);
  const realBase = fs.realpathSync(baseDir);
  if (!resolved.startsWith(path.resolve(baseDir))) {
    throw new Error(`Path traversal detected: "${relativePath}" escapes report directory`);
  }
  if (fs.existsSync(resolved)) {
    const realResolved = fs.realpathSync(resolved);
    if (!realResolved.startsWith(realBase + path.sep) && realResolved !== realBase) {
      throw new Error(`Symlink traversal detected: "${relativePath}" resolves outside report directory`);
    }
  }
  return resolved;
}

interface RunResult {
  name: string;
  status: 'success' | 'error';
  bytesProcessed: number;
  rows: number;
  error?: string;
}

export const runAllCommand = new Command('run-all')
  .description('Replay all saved reports')
  .option('--no-analysis', 'Skip analysis generation')
  .option('--analysis-api-key <key>', 'API key for headless analysis generation')
  .option('--analysis-model <model>', 'Model for analysis generation', 'claude-sonnet-4-5-20250929')
  .option('--deliver', 'Deliver report via Slack/email as configured in manifest')
  .option('--no-deliver', 'Skip delivery even if configured')
  .option('--landscape', 'Generate PDF in landscape orientation')
  .option('--force', 'Skip cost safety check')
  .option('--max-bytes <bytes>', 'Max bytes processed before aborting (default: 10 GB)')
  .allowUnknownOption(true)
  .action(async (options, command: Command) => {
    try {
      const config = loadConfig();
      const globalOpts = command.optsWithGlobals ? command.optsWithGlobals() : (command.parent?.opts() || {});
      const merchant = resolveMerchant(config, globalOpts.merchant);
      const reportsDir = path.resolve(merchant.default_output_dir);

      if (!fs.existsSync(reportsDir)) {
        console.error(`Error: Reports directory not found: ${path.relative(process.cwd(), reportsDir)}`);
        process.exit(1);
      }

      // List all reports
      const reports = listReports(reportsDir);
      if (reports.length === 0) {
        console.log('No reports found in ' + path.relative(process.cwd(), reportsDir));
        return;
      }

      // Extract CLI parameter overrides
      const cliOverrides: Record<string, string> = {};
      for (const arg of process.argv) {
        const match = arg.match(/^--([a-z][a-z0-9_]*)=(.+)$/);
        if (match && !['no-analysis', 'analysis-api-key'].includes(match[1])) {
          cliOverrides[match[1]] = match[2];
        }
      }

      console.log('');
      const results: RunResult[] = [];
      let totalBytes = 0;

      for (let i = 0; i < reports.length; i++) {
        const reportInfo = reports[i];
        const reportDir = path.join(reportsDir, reportInfo.dir);
        const manifest = loadManifest(reportDir);
        const label = `[${i + 1}/${reports.length}] ${manifest.name}`;

        try {
          // Resolve report-specific params
          const paramDefs: ReportParameter[] = (manifest.parameters || []) as ReportParameter[];
          const resolved = await resolveParameters(paramDefs, cliOverrides);

          // Load and substitute SQL
          const sqlPath = safePath(reportDir, manifest.sql_file);
          if (!fs.existsSync(sqlPath)) {
            throw new Error(`SQL file not found: ${path.relative(process.cwd(), sqlPath)}`);
          }

          let sql = fs.readFileSync(sqlPath, 'utf-8');
          sql = substituteParams(sql, resolved);

          // Build query parameters array
          const queryParams: QueryParameter[] = Object.entries(resolved).map(([name, value]) => ({
            name,
            type: 'STRING' as const,
            value,
          }));

          // Execute query
          const result = await executeQuery(merchant, sql, queryParams, {
            force: options.force,
            maxBytes: options.maxBytes ? parseInt(options.maxBytes, 10) : undefined,
          });

          // Save data
          const dataPath = path.join(reportDir, 'data.json');
          fs.writeFileSync(dataPath, JSON.stringify(result.rows, null, 2));

          // Render chart
          const chartConfig = manifest.chart;
          const chartPath = safePath(reportDir, chartConfig.echarts_file);
          if (fs.existsSync(chartPath)) {
            const outputExt = chartConfig.output_format === 'pdf' ? 'pdf' : 'png';
            const outputPath = path.join(reportDir, `chart.${outputExt}`);

            await renderChart({
              chartJsPath: chartPath,
              dataJsonPath: dataPath,
              outputPath,
              width: chartConfig.width,
              height: chartConfig.height,
              format: outputExt,
              isDashboard: false,
            });
          }

          // Analysis generation
          if (options.analysis !== false) {
            const analysisConfig = manifest.analysis || { include: true, prompt_file: 'analysis_prompt.md', output_file: 'report.md' };
            const promptFile = safePath(reportDir, analysisConfig.prompt_file || 'analysis_prompt.md');
            const outputFile = safePath(reportDir, analysisConfig.output_file || 'report.md');

            // Resolve LLM config: CLI flags > config file > defaults
            const llmConfig = resolveLlmConfig(config, {
              provider: globalOpts.llmProvider,
              apiKey: options.analysisApiKey,
            });
            const defaultModels = getDefaultModels(llmConfig.provider);
            const analysisModel = options.analysisModel || llmConfig.analysisModel || defaultModels.analysis;

            if ((llmConfig.apiKey || llmConfig.provider === 'bedrock') && fs.existsSync(promptFile)) {
              try {
                const provider = createProvider(llmConfig.provider, {
                  apiKey: llmConfig.apiKey,
                  region: llmConfig.region,
                });
                const chartPng = path.join(reportDir, 'chart.png');
                await generateAnalysis({
                  provider,
                  analysisPromptPath: promptFile,
                  dataJsonPath: dataPath,
                  chartPngPath: fs.existsSync(chartPng) ? chartPng : undefined,
                  outputPath: outputFile,
                  model: analysisModel,
                });
              } catch (analysisErr: any) {
                console.error(`  Analysis failed for ${manifest.name}: ${analysisErr.message}`);
              }
            }
          }

          // Generate PDF if report.md exists
          const reportMdPath = path.join(reportDir, 'report.md');
          if (fs.existsSync(reportMdPath)) {
            try {
              const chartPng = path.join(reportDir, 'chart.png');
              const analysisConf = manifest.analysis || {};
              const useLandscape = options.landscape ?? analysisConf.landscape ?? false;
              await generatePdf({
                markdownPath: reportMdPath,
                outputPath: path.join(reportDir, 'report.pdf'),
                chartPngPath: fs.existsSync(chartPng) ? chartPng : undefined,
                landscape: useLandscape,
              });
            } catch (pdfErr: any) {
              console.error(`  PDF failed for ${manifest.name}: ${pdfErr.message}`);
            }
          }

          // Update manifest
          addRunHistoryEntry(manifest, {
            run_date: new Date().toISOString().split('T')[0],
            parameters: resolved,
            status: 'success',
            rows_returned: result.totalRows,
            bytes_processed: result.bytesProcessed,
          });
          saveManifest(reportDir, manifest);

          // Deliver report if --deliver flag is set
          if (options.deliver && manifest.delivery) {
            await deliverReport(reportDir, manifest);
          }

          const cost = (result.bytesProcessed / (1024 * 1024 * 1024 * 1024)) * 6.25;
          totalBytes += result.bytesProcessed;

          const dots = '.'.repeat(Math.max(1, 55 - label.length));
          console.log(`  ${label} ${dots} +  (${formatBytes(result.bytesProcessed)}, $${cost.toFixed(3)})`);

          results.push({
            name: manifest.name,
            status: 'success',
            bytesProcessed: result.bytesProcessed,
            rows: result.totalRows,
          });
        } catch (err: any) {
          const dots = '.'.repeat(Math.max(1, 55 - label.length));
          console.log(`  ${label} ${dots} x  ${err.message}`);

          results.push({
            name: manifest.name,
            status: 'error',
            bytesProcessed: 0,
            rows: 0,
            error: err.message,
          });
        }
      }

      // Summary
      const successful = results.filter((r) => r.status === 'success');
      const failed = results.filter((r) => r.status === 'error');
      const totalCost = (totalBytes / (1024 * 1024 * 1024 * 1024)) * 6.25;

      console.log('');
      console.log(`  Total: ${successful.length} reports, ${formatBytes(totalBytes)} processed, $${totalCost.toFixed(3)}`);
      if (failed.length > 0) {
        console.log(`  Failed: ${failed.length} reports`);
      }
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
