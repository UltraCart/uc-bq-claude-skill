import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { loadConfig, resolveMerchant, resolveLlmConfig } from '../lib/config';
import { createProvider } from '../lib/llm';
import { getDefaultModels } from '../lib/llm/models';
import { executeQuery, QueryParameter } from '../lib/bigquery';
import { loadManifest, saveManifest, addRunHistoryEntry, listReports } from '../lib/manifest';
import { resolveParameters, resolveRelativeDate, ReportParameter } from '../lib/params';
import { substituteParams } from '../lib/template';
import { renderChart } from '../lib/renderer';
import { generateAnalysis } from '../lib/analysis';
import { generatePdf } from '../lib/pdf';
import { deliverSlack } from '../lib/deliver-slack';
import { deliverEmail } from '../lib/deliver-email';
import { loadDeck, saveDeck, listDecks, buildDeckMarkdown, generateDeckPdf, DeckConfig } from '../lib/deck';
import { buildDashboardHtml } from '../lib/dashboard';
import { exec } from 'child_process';

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

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + units[i];
}

function prompt(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

// ---- deck run ----

const deckRunCommand = new Command('run')
  .description('Generate a deck PDF from multiple reports')
  .argument('<deck-name>', 'Name of the deck definition (without .yaml)')
  .option('--deliver', 'Deliver the deck PDF via Slack/email as configured')
  .option('--no-analysis', 'Skip analysis generation for contained reports')
  .option('--landscape', 'Generate PDF in landscape orientation')
  .option('--force', 'Skip cost safety check')
  .option('--analysis-api-key <key>', 'API key for headless analysis generation')
  .option('--analysis-model <model>', 'Model for analysis generation', 'claude-sonnet-4-5-20250929')
  .option('--max-bytes <bytes>', 'Max bytes processed before aborting (default: 10 GB)')
  .allowUnknownOption(true)
  .action(async (deckName: string, options, command: Command) => {
    try {
      if (deckName.includes('..') || deckName.includes('/') || deckName.includes('\\')) {
        throw new Error('Invalid deck name');
      }

      const config = loadConfig();
      const globalOpts = command.optsWithGlobals ? command.optsWithGlobals() : (command.parent?.parent?.opts() || {});
      const merchant = resolveMerchant(config, globalOpts.merchant);
      const reportsDir = path.resolve(merchant.default_output_dir);
      const decksDir = path.join(reportsDir, 'decks');

      // Load deck definition
      const deck = loadDeck(decksDir, deckName);
      const useLandscape = options.landscape ?? deck.landscape ?? false;

      // Extract CLI parameter overrides from process.argv (--param_name=value)
      const knownFlags = ['deliver', 'no-analysis', 'landscape', 'force', 'analysis-api-key', 'analysis-model', 'max-bytes', 'merchant', 'llm-provider'];
      const cliOverrides: Record<string, string> = {};
      for (const arg of process.argv) {
        const match = arg.match(/^--([a-z][a-z0-9_]*)=(.+)$/);
        if (match && !knownFlags.includes(match[1])) {
          cliOverrides[match[1]] = match[2];
        }
      }

      // Merge: CLI overrides > deck parameters > (report defaults handled per-report)
      const deckParams = deck.parameters || {};
      const deckOverrides: Record<string, string> = { ...deckParams, ...cliOverrides };

      // Resolve relative date expressions in deck overrides
      for (const key of Object.keys(deckOverrides)) {
        deckOverrides[key] = resolveRelativeDate(deckOverrides[key]);
      }

      console.log('');
      console.log(`  Deck: ${deck.title}`);
      if (Object.keys(deckOverrides).length > 0) {
        const paramStr = Object.entries(deckOverrides).map(([k, v]) => `${k}=${v}`).join(', ');
        console.log(`  Parameters: ${paramStr}`);
      }
      console.log(`  Reports: ${deck.reports.length}`);
      console.log('  ' + '='.repeat(50));

      let totalBytes = 0;
      let successCount = 0;
      let failCount = 0;

      // Run each report in the deck
      for (let i = 0; i < deck.reports.length; i++) {
        const reportDirName = deck.reports[i];
        const reportDir = path.join(reportsDir, reportDirName);

        if (!fs.existsSync(reportDir)) {
          console.log(`  [${i + 1}/${deck.reports.length}] ${reportDirName} ... MISSING (skipped)`);
          failCount++;
          continue;
        }

        const manifest = loadManifest(reportDir);
        const label = `[${i + 1}/${deck.reports.length}] ${manifest.name}`;

        try {
          // Resolve parameters: deck overrides flow down to all reports
          const paramDefs: ReportParameter[] = (manifest.parameters || []) as ReportParameter[];
          const resolved = await resolveParameters(paramDefs, deckOverrides);

          // Load and substitute SQL
          const sqlPath = safePath(reportDir, manifest.sql_file);
          if (!fs.existsSync(sqlPath)) {
            throw new Error(`SQL file not found: ${manifest.sql_file}`);
          }

          let sql = fs.readFileSync(sqlPath, 'utf-8');
          sql = substituteParams(sql, resolved);

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
              for (const err of renderResult.errors) {
                console.error(`    Chart error: ${err}`);
              }
            }
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
                console.error(`    Analysis failed: ${analysisErr.message}`);
              }
            }
          }

          // Generate individual report PDF
          const reportMdPath = path.join(reportDir, 'report.md');
          if (fs.existsSync(reportMdPath)) {
            try {
              const chartPng = path.join(reportDir, 'chart.png');
              const analysisConf = manifest.analysis || {};
              await generatePdf({
                markdownPath: reportMdPath,
                outputPath: path.join(reportDir, 'report.pdf'),
                chartPngPath: fs.existsSync(chartPng) ? chartPng : undefined,
                landscape: useLandscape,
              });
            } catch (pdfErr: any) {
              console.error(`    PDF failed: ${pdfErr.message}`);
            }
          }

          totalBytes += result.bytesProcessed;
          successCount++;

          const cost = (result.bytesProcessed / (1024 * 1024 * 1024 * 1024)) * 6.25;
          const dots = '.'.repeat(Math.max(1, 50 - label.length));
          console.log(`  ${label} ${dots} OK  (${formatBytes(result.bytesProcessed)}, $${cost.toFixed(3)})`);
        } catch (err: any) {
          failCount++;
          const dots = '.'.repeat(Math.max(1, 50 - label.length));
          console.log(`  ${label} ${dots} FAIL  ${err.message}`);
        }
      }

      if (successCount === 0) {
        console.error('\n  No reports completed successfully. Deck PDF not generated.\n');
        process.exit(1);
      }

      // Build combined deck markdown
      console.log('');
      console.log('  Assembling deck...');
      const deckMarkdown = buildDeckMarkdown(deck, reportsDir);

      // Generate deck PDF
      const deckPdfPath = path.join(decksDir, `${deckName}.pdf`);
      await generateDeckPdf(deckMarkdown, deckPdfPath, decksDir, useLandscape);
      console.log(`  Deck PDF: ${path.relative(process.cwd(), deckPdfPath)}`);

      // Deliver the deck PDF if --deliver is set
      if (options.deliver && deck.delivery) {
        const dateStr = new Date().toISOString().split('T')[0];
        const comment = `${deck.title} — ${dateStr}`;
        const fileName = `${deckName}.pdf`;

        if (deck.delivery.slack) {
          try {
            await deliverSlack(deckPdfPath, fileName, deck.delivery.slack.channels, comment);
            console.log(`  Delivered to Slack channels: ${deck.delivery.slack.channels.join(', ')}`);
          } catch (err: any) {
            console.error(`  Slack delivery failed: ${err.message}`);
          }
        }

        if (deck.delivery.email) {
          try {
            await deliverEmail(deckPdfPath, fileName, deck.delivery.email);
            console.log(`  Delivered via email (${deck.delivery.email.provider}) to: ${deck.delivery.email.to.join(', ')}`);
          } catch (err: any) {
            console.error(`  Email delivery failed: ${err.message}`);
          }
        }
      } else if (options.deliver && !deck.delivery) {
        console.log('  Delivery: No delivery config in deck definition, skipping.');
      }

      // Summary
      const totalCost = (totalBytes / (1024 * 1024 * 1024 * 1024)) * 6.25;
      console.log('');
      console.log(`  Summary: ${successCount} reports, ${formatBytes(totalBytes)} processed, $${totalCost.toFixed(3)}`);
      if (failCount > 0) {
        console.log(`  Failed: ${failCount} reports`);
      }
      console.log('');
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// ---- deck list ----

const deckListCommand = new Command('list')
  .description('List all defined report decks')
  .action((_options, command: Command) => {
    try {
      const config = loadConfig();
      const globalOpts = command.optsWithGlobals ? command.optsWithGlobals() : (command.parent?.parent?.opts() || {});
      const merchant = resolveMerchant(config, globalOpts.merchant);
      const reportsDir = path.resolve(merchant.default_output_dir);
      const decksDir = path.join(reportsDir, 'decks');

      const decks = listDecks(decksDir);

      if (decks.length === 0) {
        console.log('\n  No decks defined. Create one with: uc-bq deck create <deck-name>\n');
        return;
      }

      console.log('');
      console.log('  Report Decks');
      console.log('  ' + '─'.repeat(50));

      for (const deck of decks) {
        console.log(`  ${deck.name}`);
        console.log(`    Title:   ${deck.title}`);
        console.log(`    Reports: ${deck.reportCount}`);
        console.log('');
      }
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// ---- deck create ----

const deckCreateCommand = new Command('create')
  .description('Create a new deck definition')
  .argument('<deck-name>', 'Name for the deck file (without .yaml)')
  .option('--title <title>', 'Deck title')
  .option('--reports <reports>', 'Comma-separated report directory names')
  .option('--company <company>', 'Company name for cover page')
  .option('--logo-url <url>', 'Logo URL for cover page')
  .option('--landscape', 'Generate deck in landscape orientation')
  .option('--params <params>', 'Comma-separated param=value pairs (e.g., start_date=start_of_year,end_date=today)')
  .action(async (deckName: string, options: { title?: string; reports?: string; company?: string; logoUrl?: string; landscape?: boolean; params?: string }, command: Command) => {
    try {
      if (deckName.includes('..') || deckName.includes('/') || deckName.includes('\\')) {
        throw new Error('Invalid deck name');
      }

      const config = loadConfig();
      const globalOpts = command.optsWithGlobals ? command.optsWithGlobals() : (command.parent?.parent?.opts() || {});
      const merchant = resolveMerchant(config, globalOpts.merchant);
      const reportsDir = path.resolve(merchant.default_output_dir);
      const decksDir = path.join(reportsDir, 'decks');

      // Check if deck already exists
      const deckFilePath = path.join(decksDir, `${deckName}.yaml`);
      if (fs.existsSync(deckFilePath)) {
        throw new Error(`Deck "${deckName}" already exists at ${path.relative(process.cwd(), deckFilePath)}`);
      }

      // Non-interactive mode: all params via flags
      if (options.title && options.reports) {
        const selectedReports = options.reports.split(',').map(s => s.trim());

        // Validate reports exist
        for (const r of selectedReports) {
          const reportDir = path.join(reportsDir, r);
          if (!fs.existsSync(reportDir)) {
            throw new Error(`Report "${r}" not found at ${path.relative(process.cwd(), reportDir)}`);
          }
        }

        const deckConfig: DeckConfig = {
          name: options.title,
          title: options.title,
          reports: selectedReports,
        };

        if (options.company || options.logoUrl) {
          deckConfig.cover = {};
          if (options.company) deckConfig.cover.company = options.company;
          if (options.logoUrl) deckConfig.cover.logo_url = options.logoUrl;
        }

        if (options.landscape) {
          deckConfig.landscape = true;
        }

        if (options.params) {
          const parameters: Record<string, string> = {};
          for (const pair of options.params.split(',')) {
            const eqIdx = pair.indexOf('=');
            if (eqIdx > 0) {
              const key = pair.substring(0, eqIdx).trim();
              const value = pair.substring(eqIdx + 1).trim();
              parameters[key] = value;
            }
          }
          if (Object.keys(parameters).length > 0) {
            deckConfig.parameters = parameters;
          }
        }

        if (!fs.existsSync(decksDir)) {
          fs.mkdirSync(decksDir, { recursive: true });
        }

        saveDeck(decksDir, deckName, deckConfig);

        console.log('');
        console.log(`  Deck created: ${path.relative(process.cwd(), deckFilePath)}`);
        console.log(`  Title: ${options.title}`);
        console.log(`  Reports: ${selectedReports.join(', ')}`);
        if (options.company) console.log(`  Company: ${options.company}`);
        console.log('');
        console.log(`  Run it with: uc-bq deck run ${deckName}`);
        console.log('');
        return;
      }

      // Interactive mode: prompt for missing fields
      const availableReports = listReports(reportsDir);
      if (availableReports.length === 0) {
        console.error('\n  No reports available. Create some reports first.\n');
        process.exit(1);
      }

      if (!options.title || !options.reports) {
        console.error('Error: --title and --reports are required.');
        console.error('');
        console.error('Usage:');
        console.error(`  uc-bq deck create ${deckName} --title="Weekly Briefing" --reports=report1,report2`);
        console.error('');
        console.error('Available reports:');
        for (const r of availableReports) {
          console.log(`  ${r.dir} — ${r.name}`);
        }
        console.error('');
        process.exit(1);
      }
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// ---- deck dashboard ----

const deckDashboardCommand = new Command('dashboard')
  .description('Generate an interactive HTML dashboard from a deck')
  .argument('<deck-name>', 'Name of the deck definition (without .yaml)')
  .option('--open', 'Open the dashboard in the default browser')
  .action(async (deckName: string, options: { open?: boolean }, command: Command) => {
    try {
      if (deckName.includes('..') || deckName.includes('/') || deckName.includes('\\')) {
        throw new Error('Invalid deck name');
      }

      const config = loadConfig();
      const globalOpts = command.optsWithGlobals ? command.optsWithGlobals() : (command.parent?.parent?.opts() || {});
      const merchant = resolveMerchant(config, globalOpts.merchant);
      const reportsDir = path.resolve(merchant.default_output_dir);
      const decksDir = path.join(reportsDir, 'decks');

      // Load deck definition
      const deck = loadDeck(decksDir, deckName);

      // Check which reports have data
      let missingCount = 0;
      for (const reportDirName of deck.reports) {
        const dataPath = path.join(reportsDir, reportDirName, 'data.json');
        if (!fs.existsSync(dataPath)) {
          console.warn(`  Warning: ${reportDirName}/data.json not found — run "uc-bq deck run ${deckName}" first`);
          missingCount++;
        }
      }

      if (missingCount === deck.reports.length) {
        console.error('\n  No report data found. Run the deck first: uc-bq deck run ' + deckName + '\n');
        process.exit(1);
      }

      // Build the dashboard HTML
      const html = buildDashboardHtml(deck, reportsDir);

      // Write to decks directory
      if (!fs.existsSync(decksDir)) {
        fs.mkdirSync(decksDir, { recursive: true });
      }
      const dashboardPath = path.join(decksDir, `${deckName}-dashboard.html`);
      fs.writeFileSync(dashboardPath, html, 'utf-8');

      console.log('');
      console.log(`  Dashboard: ${path.relative(process.cwd(), dashboardPath)}`);
      console.log(`  Reports:   ${deck.reports.length - missingCount} of ${deck.reports.length} included`);
      console.log('');

      // Open in browser if requested
      if (options.open) {
        const openCmd = process.platform === 'darwin' ? 'open' : 'xdg-open';
        exec(`${openCmd} "${dashboardPath}"`);
      }
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// ---- deck command group ----

export const deckCommand = new Command('deck')
  .description('Manage and generate report decks (combined multi-report PDFs)');

deckCommand.addCommand(deckRunCommand);
deckCommand.addCommand(deckListCommand);
deckCommand.addCommand(deckCreateCommand);
deckCommand.addCommand(deckDashboardCommand);
