import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { loadConfig, resolveMerchant, resolveLlmConfig } from '../lib/config';
import { createProvider } from '../lib/llm';
import { getDefaultModels } from '../lib/llm/models';
import { executeQuery, QueryParameter } from '../lib/bigquery';
import { loadManifest, saveManifest, addRunHistoryEntry, listReports } from '../lib/manifest';
import { resolveParameters, ReportParameter } from '../lib/params';
import { substituteParams } from '../lib/template';
import { renderChart } from '../lib/renderer';
import { generateAnalysis } from '../lib/analysis';
import { generatePdf } from '../lib/pdf';
import { deliverSlack } from '../lib/deliver-slack';
import { deliverEmail } from '../lib/deliver-email';
import { loadDeck, saveDeck, listDecks, buildDeckMarkdown, generateDeckPdf, DeckConfig } from '../lib/deck';

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

      console.log('');
      console.log(`  Deck: ${deck.title}`);
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
          // Resolve parameters (defaults only, no prompting for deck runs)
          const paramDefs: ReportParameter[] = (manifest.parameters || []) as ReportParameter[];
          const resolved = await resolveParameters(paramDefs, {});

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
  .description('Interactively create a new deck definition')
  .argument('<deck-name>', 'Name for the deck file (without .yaml)')
  .action(async (deckName: string, _options, command: Command) => {
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
        throw new Error(`Deck "${deckName}" already exists at ${deckFilePath}`);
      }

      // List available reports
      const availableReports = listReports(reportsDir);
      if (availableReports.length === 0) {
        console.error('\n  No reports available. Create some reports first with: uc-bq run <report-name>\n');
        process.exit(1);
      }

      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      try {
        console.log('');
        console.log(`  Creating deck: ${deckName}`);
        console.log('  ' + '─'.repeat(50));

        const title = await prompt(rl, '  Deck title: ');
        if (!title) {
          throw new Error('Title is required');
        }

        const company = await prompt(rl, '  Company name (optional): ');
        const logoUrl = await prompt(rl, '  Logo URL (optional): ');

        console.log('');
        console.log('  Available reports:');
        for (let i = 0; i < availableReports.length; i++) {
          console.log(`    ${i + 1}. ${availableReports[i].name} (${availableReports[i].dir})`);
        }
        console.log('');

        const picksStr = await prompt(rl, '  Select reports (comma-separated numbers, e.g., 1,3,5): ');
        const picks = picksStr
          .split(',')
          .map((s) => parseInt(s.trim(), 10))
          .filter((n) => !isNaN(n) && n >= 1 && n <= availableReports.length);

        if (picks.length === 0) {
          throw new Error('At least one report must be selected');
        }

        const selectedReports = picks.map((n) => availableReports[n - 1].dir);

        const deckConfig: DeckConfig = {
          name: title,
          title,
          reports: selectedReports,
        };

        if (company || logoUrl) {
          deckConfig.cover = {};
          if (company) deckConfig.cover.company = company;
          if (logoUrl) deckConfig.cover.logo_url = logoUrl;
        }

        saveDeck(decksDir, deckName, deckConfig);

        console.log('');
        console.log(`  Deck saved: ${path.relative(process.cwd(), deckFilePath)}`);
        console.log(`  Reports: ${selectedReports.join(', ')}`);
        console.log('');
        console.log(`  Run it with: uc-bq deck run ${deckName}`);
        console.log('');
      } finally {
        rl.close();
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
