import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { loadConfig, resolveMerchant, resolveLlmConfig } from '../lib/config';
import { createProvider } from '../lib/llm';
import { getDefaultModels } from '../lib/llm/models';
import { executeQuery, QueryParameter } from '../lib/bigquery';
import { loadManifest, saveManifest, addRunHistoryEntry } from '../lib/manifest';
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
  // Also check resolved symlinks if the file exists
  if (fs.existsSync(resolved)) {
    const realResolved = fs.realpathSync(resolved);
    if (!realResolved.startsWith(realBase + path.sep) && realResolved !== realBase) {
      throw new Error(`Symlink traversal detected: "${relativePath}" resolves outside report directory`);
    }
  }
  return resolved;
}

export const runCommand = new Command('run')
  .description('Replay a saved report (resolve params, query, render)')
  .argument('<report-name>', 'Name of the report directory under ./reports/')
  .option('--no-analysis', 'Skip analysis generation')
  .option('--analysis-api-key <key>', 'API key for headless analysis generation')
  .option('--analysis-model <model>', 'Model for analysis generation', 'claude-sonnet-4-5-20250929')
  .option('--deliver', 'Deliver report via Slack/email as configured in manifest')
  .option('--no-deliver', 'Skip delivery even if configured')
  .option('--landscape', 'Generate PDF in landscape orientation')
  .option('--force', 'Skip cost safety check')
  .option('--max-bytes <bytes>', 'Max bytes processed before aborting (default: 10 GB)')
  .allowUnknownOption(true)
  .action(async (reportName: string, options, command: Command) => {
    try {
      const config = loadConfig();
      const globalOpts = command.optsWithGlobals ? command.optsWithGlobals() : (command.parent?.opts() || {});
      const merchant = resolveMerchant(config, globalOpts.merchant);

      if (reportName.includes('..') || reportName.includes('/') || reportName.includes('\\')) {
        throw new Error('Invalid report name');
      }

      const reportsDir = path.resolve(merchant.default_output_dir);
      const reportDir = path.join(reportsDir, reportName);

      if (!fs.existsSync(reportDir)) {
        console.error(`Error: Report directory not found: ${path.relative(process.cwd(), reportDir)}`);
        process.exit(1);
      }

      // Load manifest
      const manifest = loadManifest(reportDir);

      // Extract CLI parameter overrides from unknown args (--param_name=value)
      const cliOverrides: Record<string, string> = {};
      const rawArgs = command.args || [];
      for (const arg of rawArgs) {
        const match = arg.match(/^--([a-z][a-z0-9_]*)=(.+)$/);
        if (match) {
          cliOverrides[match[1]] = match[2];
        }
      }
      // Also check parent args for param overrides
      for (const arg of process.argv) {
        const match = arg.match(/^--([a-z][a-z0-9_]*)=(.+)$/);
        if (match && !['no-analysis', 'analysis-api-key'].includes(match[1])) {
          cliOverrides[match[1]] = match[2];
        }
      }

      // Resolve parameters: CLI overrides > manifest defaults > prompt
      const paramDefs: ReportParameter[] = (manifest.parameters || []) as ReportParameter[];
      const resolved = await resolveParameters(paramDefs, cliOverrides);

      console.log('');
      console.log(`  Running: ${manifest.name}`);
      console.log('  ' + '─'.repeat(50));

      // Show resolved params
      for (const [key, value] of Object.entries(resolved)) {
        console.log(`  ${key} = ${value}`);
      }
      console.log('');

      // Load and substitute SQL
      const sqlPath = safePath(reportDir, manifest.sql_file);
      if (!fs.existsSync(sqlPath)) {
        console.error(`Error: SQL file not found: ${path.relative(process.cwd(), sqlPath)}`);
        process.exit(1);
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
      console.log('  Executing query...');
      const result = await executeQuery(merchant, sql, queryParams, {
        force: options.force,
        maxBytes: options.maxBytes ? parseInt(options.maxBytes, 10) : undefined,
      });

      console.log(`  Rows: ${result.totalRows}`);
      console.log(`  Bytes processed: ${formatBytes(result.bytesProcessed)}`);
      console.log(`  Cost: $${((result.bytesProcessed / (1024 * 1024 * 1024 * 1024)) * 6.25).toFixed(4)}`);

      // Save data for chart rendering
      const dataPath = path.join(reportDir, 'data.json');
      fs.writeFileSync(dataPath, JSON.stringify(result.rows, null, 2));

      // Render chart
      const chartConfig = manifest.chart;
      const chartPath = safePath(reportDir, chartConfig.echarts_file);
      if (fs.existsSync(chartPath)) {
        const outputExt = chartConfig.output_format === 'pdf' ? 'pdf' : 'png';
        const outputPath = path.join(reportDir, `chart.${outputExt}`);

        console.log('  Rendering chart...');
        const renderResult = await renderChart({
          chartJsPath: chartPath,
          dataJsonPath: dataPath,
          outputPath,
          width: chartConfig.width,
          height: chartConfig.height,
          format: outputExt,
          isDashboard: false,
        });

        if (renderResult.errors && renderResult.errors.length > 0) {
          console.error('  Chart rendering errors:');
          for (const err of renderResult.errors) {
            console.error(`    - ${err}`);
          }
        } else {
          console.log(`  Chart: ${path.relative(process.cwd(), renderResult.outputPath)}`);
        }

        // Render dashboard version if output format is both or png
        if (chartConfig.output_format !== 'pdf') {
          const dashOutputPath = path.join(reportDir, 'chart-dashboard.png');
          await renderChart({
            chartJsPath: chartPath,
            dataJsonPath: dataPath,
            outputPath: dashOutputPath,
            width: 200,
            height: 200,
            format: 'png',
            isDashboard: true,
          });
        }
      } else {
        console.log(`  Skipping chart render (${chartConfig.echarts_file} not found)`);
      }

      // Update manifest run history
      addRunHistoryEntry(manifest, {
        run_date: new Date().toISOString().split('T')[0],
        parameters: resolved,
        status: 'success',
        rows_returned: result.totalRows,
        bytes_processed: result.bytesProcessed,
      });
      saveManifest(reportDir, manifest);

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
          console.log('  Generating analysis...');
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
            console.log(`  Analysis: ${path.relative(process.cwd(), outputFile)}`);
          } catch (err: any) {
            console.error(`  Analysis failed: ${err.message}`);
          }
        } else if (!fs.existsSync(promptFile)) {
          console.log('  Analysis: No analysis_prompt.md found. Use Claude Code to generate one.');
        } else {
          console.log(`  Analysis: Set --analysis-api-key or ${llmConfig.apiKeyEnv || 'ANTHROPIC_API_KEY'} to generate analysis on replay.`);
        }
      }

      // Generate PDF combining analysis + chart
      const reportMd = path.join(reportDir, 'report.md');
      if (fs.existsSync(reportMd)) {
        const pdfPath = path.join(reportDir, 'report.pdf');
        console.log('  Generating PDF...');
        try {
          const chartPng = path.join(reportDir, 'chart.png');
          const analysisConfig = manifest.analysis || {};
          const useLandscape = options.landscape ?? analysisConfig.landscape ?? false;
          await generatePdf({
            markdownPath: reportMd,
            outputPath: pdfPath,
            chartPngPath: fs.existsSync(chartPng) ? chartPng : undefined,
            landscape: useLandscape,
          });
          console.log(`  PDF: ${path.relative(process.cwd(), pdfPath)}`);
        } catch (err: any) {
          console.error(`  PDF generation failed: ${err.message}`);
        }
      }

      // Deliver report if --deliver flag is set
      if (options.deliver) {
        if (manifest.delivery) {
          await deliverReport(reportDir, manifest);
        } else {
          console.log('  Delivery: No delivery config in manifest, skipping.');
        }
      }

      console.log('');
      console.log('  Done.');
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
