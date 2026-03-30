import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { BigQuery } from '@google-cloud/bigquery';
import { UcBqConfig, ExternalProject, validateConfig, resolveMerchant } from '../lib/config';
import { getTables } from '../lib/bigquery';

const CONFIG_FILENAME = '.ultracart-bq.json';

function prompt(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

interface MerchantEntry {
  merchant_id: string;
  taxonomy_level: string;
  dataset: string;
}

export const initCommand = new Command('init')
  .description('Setup — creates .ultracart-bq.json (interactive or via flags)')
  .option('--merchant-id <id>', 'Merchant ID (skips interactive mode when provided)')
  .option('--taxonomy <level>', 'Taxonomy level: standard, low, medium, high', 'standard')
  .option('--dataset <dataset>', 'BigQuery dataset name', 'ultracart_dw')
  .option('--output-dir <dir>', 'Output directory for reports', './reports')
  .option('--output-format <format>', 'Output format: png, pdf, both', 'png')
  .action(async (opts) => {
    const taxonomyLevels = ['standard', 'low', 'medium', 'high'] as const;
    const formatOptions = ['png', 'pdf', 'both'] as const;

    // Also check global -m/--merchant from parent command
    const merchantId = opts.merchantId || opts.parent?.merchant;

    // Non-interactive mode when merchant ID is provided
    if (merchantId) {
      if (!taxonomyLevels.includes(opts.taxonomy as any)) {
        console.error(`Error: Invalid taxonomy level "${opts.taxonomy}". Must be one of: ${taxonomyLevels.join(', ')}`);
        process.exit(1);
      }
      if (!formatOptions.includes(opts.outputFormat as any)) {
        console.error(`Error: Invalid output format "${opts.outputFormat}". Must be one of: ${formatOptions.join(', ')}`);
        process.exit(1);
      }

      console.log('');
      console.log('  UltraCart BigQuery Skill Setup');
      console.log('  ──────────────────────────────');
      console.log('');

      const config = {
        default_merchant: merchantId,
        merchants: {
          [merchantId]: {
            taxonomy_level: opts.taxonomy,
            dataset: opts.dataset,
          },
        },
        default_output_dir: opts.outputDir,
        output_format: opts.outputFormat,
        chart_theme: 'default',
        chart_defaults: { width: 1200, height: 600 },
      } as UcBqConfig;

      const validation = validateConfig(config);
      if (!validation.valid) {
        console.error('  Config validation failed:');
        for (const err of validation.errors) {
          console.error(`    - ${err}`);
        }
        process.exit(1);
      }

      const configPath = path.join(process.cwd(), CONFIG_FILENAME);
      const configWithSchema = {
        $schema: 'https://ultracart.com/schemas/ultracart-bq-config.schema.json',
        ...config,
      };
      fs.writeFileSync(configPath, JSON.stringify(configWithSchema, null, 2) + '\n');

      console.log(`  + Created ${CONFIG_FILENAME}`);
      console.log(`  + Merchant "${merchantId}" configured (taxonomy: ${opts.taxonomy})`);
      console.log('  + Validated against schema');

      console.log('  + Testing BigQuery connection...');
      try {
        const merchant = resolveMerchant(config);
        const tables = getTables(merchant, merchant.dataset);
        console.log(`  + Connected to ${merchant.project_id}`);
        console.log(`  + Found ${tables.length} tables/views at taxonomy level '${merchant.taxonomy_level}'`);
      } catch (err: any) {
        console.error(`  x BigQuery connection failed: ${err.message}`);
        console.error('');
        console.error('  Config file was written, but BigQuery connection could not be verified.');
        console.error('  Make sure you have authenticated via:');
        console.error('    gcloud auth application-default login');
        process.exit(1);
      }

      console.log('');
      return;
    }

    // Interactive mode (original behavior)
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    try {
      console.log('');
      console.log('  UltraCart BigQuery Skill Setup');
      console.log('  ──────────────────────────────');
      console.log('');

      const merchants: MerchantEntry[] = [];

      // Prompt for merchants in a loop
      let addMore = true;
      while (addMore) {
        const ordinal = merchants.length === 0 ? 'Default merchant' : `Merchant #${merchants.length + 1}`;
        const merchantId = await prompt(rl, `  ${ordinal} ID: `);
        if (!merchantId) {
          if (merchants.length === 0) {
            console.error('Error: At least one merchant ID is required.');
            process.exit(1);
          }
          break;
        }

        const taxonomyInput = await prompt(rl, '  Taxonomy Level [standard / low / medium / high]: ');
        const taxonomyLevel = taxonomyInput || 'standard';
        if (!taxonomyLevels.includes(taxonomyLevel as any)) {
          console.error(`Error: Invalid taxonomy level "${taxonomyLevel}". Must be one of: ${taxonomyLevels.join(', ')}`);
          process.exit(1);
        }

        const datasetInput = await prompt(rl, '  Dataset [ultracart_dw]: ');
        const dataset = datasetInput || 'ultracart_dw';

        merchants.push({ merchant_id: merchantId, taxonomy_level: taxonomyLevel, dataset });

        const another = await prompt(rl, '  Add another merchant? (y/n): ');
        addMore = another.toLowerCase() === 'y' || another.toLowerCase() === 'yes';
      }

      // External project registration
      const externalProjectsByMerchant: Record<string, Record<string, ExternalProject>> = {};
      const addExternal = await prompt(rl, '  Do you have external BigQuery projects to register? (y/n): ');
      if (addExternal.toLowerCase() === 'y' || addExternal.toLowerCase() === 'yes') {
        let targetMerchantId = merchants[0].merchant_id;
        if (merchants.length > 1) {
          const ids = merchants.map(m => m.merchant_id).join(', ');
          const chosen = await prompt(rl, `  Which merchant to add external projects to? (${ids}) [${merchants[0].merchant_id}]: `);
          targetMerchantId = chosen || merchants[0].merchant_id;
        }

        let addMoreProjects = true;
        const extProjects: Record<string, ExternalProject> = {};

        while (addMoreProjects) {
          const alias = await prompt(rl, '  External project alias (short name): ');
          if (!alias) break;

          const extProjectId = await prompt(rl, '  GCP project ID: ');
          if (!extProjectId) break;

          const extDesc = await prompt(rl, '  Description (optional): ');

          // List available datasets
          console.log(`  Listing datasets in ${extProjectId}...`);
          const extBq = new BigQuery({ projectId: extProjectId });
          let availableDatasets: string[] = [];
          try {
            const [datasets] = await extBq.getDatasets();
            availableDatasets = datasets.map(d => d.id!).filter(Boolean);
            console.log(`  Available datasets: ${availableDatasets.join(', ')}`);
          } catch (err: any) {
            console.error(`  Warning: Could not list datasets: ${err.message}`);
            console.error('  You can enter dataset names manually.');
          }

          const dsInput = await prompt(rl, '  Which datasets to include? (comma-separated): ');
          const selectedDatasets = dsInput.split(',').map(s => s.trim()).filter(Boolean);

          const datasetsMap: Record<string, string[]> = {};
          for (const ds of selectedDatasets) {
            console.log(`  Listing tables in ${ds}...`);
            let availableTables: string[] = [];
            try {
              const [tables] = await extBq.dataset(ds).getTables();
              availableTables = tables.map(t => t.id!).filter(Boolean);
              console.log(`  Available tables: ${availableTables.join(', ')}`);
            } catch (err: any) {
              console.error(`  Warning: Could not list tables: ${err.message}`);
              console.error('  You can enter table names manually.');
            }

            const tblInput = await prompt(rl, `  Which tables from ${ds}? (comma-separated, or "all"): `);
            if (tblInput.toLowerCase() === 'all') {
              datasetsMap[ds] = availableTables;
            } else {
              datasetsMap[ds] = tblInput.split(',').map(s => s.trim()).filter(Boolean);
            }
          }

          extProjects[alias] = {
            project_id: extProjectId,
            ...(extDesc ? { description: extDesc } : {}),
            datasets: datasetsMap,
          };

          const another = await prompt(rl, '  Add another external project? (y/n): ');
          addMoreProjects = another.toLowerCase() === 'y' || another.toLowerCase() === 'yes';
        }

        if (Object.keys(extProjects).length > 0) {
          externalProjectsByMerchant[targetMerchantId] = extProjects;
        }
      }

      const outputDirInput = await prompt(rl, '  Output Directory [./reports]: ');
      const outputDir = outputDirInput || './reports';

      const formatInput = await prompt(rl, '  Output Format [png / pdf / both]: ');
      const outputFormat = formatInput || 'png';
      if (!formatOptions.includes(outputFormat as any)) {
        console.error(`Error: Invalid output format "${outputFormat}". Must be one of: ${formatOptions.join(', ')}`);
        process.exit(1);
      }

      rl.close();

      // Build multi-merchant config — first merchant is default
      const merchantsMap: Record<string, { taxonomy_level: string; dataset: string; external_projects?: Record<string, ExternalProject> }> = {};
      for (const m of merchants) {
        const entry: { taxonomy_level: string; dataset: string; external_projects?: Record<string, ExternalProject> } = {
          taxonomy_level: m.taxonomy_level,
          dataset: m.dataset,
        };
        if (externalProjectsByMerchant[m.merchant_id]) {
          entry.external_projects = externalProjectsByMerchant[m.merchant_id];
        }
        merchantsMap[m.merchant_id] = entry;
      }

      const config = {
        default_merchant: merchants[0].merchant_id,
        merchants: merchantsMap,
        default_output_dir: outputDir,
        output_format: outputFormat,
        chart_theme: 'default',
        chart_defaults: { width: 1200, height: 600 },
      } as UcBqConfig;

      // Validate against schema
      const validation = validateConfig(config);
      if (!validation.valid) {
        console.error('');
        console.error('  Config validation failed:');
        for (const err of validation.errors) {
          console.error(`    - ${err}`);
        }
        process.exit(1);
      }

      // Write config file
      const configPath = path.join(process.cwd(), CONFIG_FILENAME);
      const configWithSchema = {
        $schema: 'https://ultracart.com/schemas/ultracart-bq-config.schema.json',
        ...config,
      };
      fs.writeFileSync(configPath, JSON.stringify(configWithSchema, null, 2) + '\n');

      console.log('');
      console.log(`  + Created ${CONFIG_FILENAME}`);
      console.log(`  + ${merchants.length} merchant(s) configured (default: ${merchants[0].merchant_id})`);
      console.log('  + Validated against schema');

      // Test BigQuery connection using default merchant
      console.log('  + Testing BigQuery connection...');
      try {
        const merchant = resolveMerchant(config);
        const tables = getTables(merchant, merchant.dataset);
        console.log(`  + Connected to ${merchant.project_id}`);
        console.log(`  + Found ${tables.length} tables/views at taxonomy level '${merchant.taxonomy_level}'`);
      } catch (err: any) {
        console.error(`  x BigQuery connection failed: ${err.message}`);
        console.error('');
        console.error('  Config file was written, but BigQuery connection could not be verified.');
        console.error('  Make sure you have authenticated via:');
        console.error('    gcloud auth application-default login');
        console.error('  Or set up a service account key.');
        process.exit(1);
      }

      console.log('');
    } catch (err: any) {
      rl.close();
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });
