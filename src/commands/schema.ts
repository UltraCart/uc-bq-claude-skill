import { Command } from 'commander';
import { BigQuery } from '@google-cloud/bigquery';
import { loadConfig, resolveMerchant, resolveLlmConfig } from '../lib/config';
import { createProvider } from '../lib/llm';
import { getDefaultModels } from '../lib/llm/models';
import { getTables, getTableSchema, getExternalTables, getExternalTableSchema, refreshSchemaCache } from '../lib/bigquery';
import { filterSchemaWithLLM } from '../lib/schema-filter';

export const schemaCommand = new Command('schema')
  .description('Fetch and filter table schemas from BigQuery')
  .option('--tables <tables>', 'Comma-separated list of table names')
  .option('--filter <query>', 'Filter columns — uses LLM with API key, keyword matching without')
  .option('--api-key <key>', 'Anthropic API key for LLM-powered schema filtering')
  .option('--format <format>', 'Output format: json or text', 'text')
  .option('--dataset <dataset>', 'Dataset to query')
  .option('--project <project>', 'Browse any GCP project you have access to (for exploration before registering)')
  .option('--list', 'List available tables/views at configured taxonomy level')
  .option('--refresh', 'Clear and re-fetch all cached external table schemas')
  .option('--live', 'Force fetching schema from BigQuery (bypass enhanced schemas)')
  .action(async (options, cmd: Command) => {
    try {
      // If --project is specified, browse that project directly (no config needed)
      if (options.project) {
        await browseProject(options);
        return;
      }

      const config = loadConfig();
      const globalOpts = cmd.optsWithGlobals ? cmd.optsWithGlobals() : (cmd.parent?.opts() || {});
      const merchant = resolveMerchant(config, globalOpts.merchant);
      const datasetId = options.dataset || merchant.dataset;

      if (options.refresh) {
        console.log('  Refreshing external schema cache...');
        await refreshSchemaCache(merchant);
        console.log('  Schema cache refreshed.');
        return;
      }

      if (options.list) {
        const tables = getTables(merchant, datasetId);
        const externalTables = getExternalTables(merchant);

        if (options.format === 'json') {
          console.log(JSON.stringify({ ultracart: tables, external: externalTables }, null, 2));
        } else {
          console.log('');
          console.log(`  Available tables/views (merchant: ${merchant.merchant_id}, taxonomy: ${merchant.taxonomy_level})`);
          console.log('  ' + '─'.repeat(50));
          for (const table of tables) {
            console.log(`  ${table.table_name} — ${table.description}`);
          }
          console.log('');
          console.log(`  ${tables.length} tables found`);

          if (externalTables.length > 0) {
            // Group by alias
            const grouped: Record<string, typeof externalTables> = {};
            for (const et of externalTables) {
              if (!grouped[et.alias]) grouped[et.alias] = [];
              grouped[et.alias].push(et);
            }

            console.log('');
            console.log('  External projects');
            console.log('  ' + '─'.repeat(50));
            for (const [alias, tables] of Object.entries(grouped)) {
              const desc = tables[0].description ? ` — ${tables[0].description}` : '';
              console.log(`  [${alias}] (${tables[0].projectId})${desc}`);
              for (const t of tables) {
                console.log(`    ${alias}.${t.dataset}.${t.table}`);
              }
            }
            console.log('');
            console.log(`  ${externalTables.length} external tables found`);
          }

          console.log('');
        }
        return;
      }

      if (!options.tables) {
        console.error('Error: Specify --tables or use --list to see available tables.');
        process.exit(1);
      }

      const tableNames = options.tables.split(',').map((t: string) => t.trim());

      // Resolve LLM config for schema filtering
      const llmConfig = resolveLlmConfig(config, {
        provider: globalOpts.llmProvider,
        apiKey: options.apiKey,
      });
      const defaultModels = getDefaultModels(llmConfig.provider);
      const schemaFilterModel = llmConfig.schemaFilterModel || defaultModels.schemaFilter;

      const results: Record<string, any[]> = {};

      for (const tableName of tableNames) {
        const dotParts = tableName.split('.');
        let columns: any[];

        if (dotParts.length === 3) {
          // External table: alias.dataset.table
          const [alias, extDataset, extTable] = dotParts;
          const extProjects = merchant.external_projects;
          if (!extProjects || !extProjects[alias]) {
            throw new Error(`External project alias "${alias}" not found in config. Available: ${extProjects ? Object.keys(extProjects).join(', ') : 'none'}`);
          }
          const extProject = extProjects[alias];
          columns = await getExternalTableSchema(merchant, extProject.project_id, extDataset, extTable);
        } else {
          columns = await getTableSchema(merchant, datasetId, tableName, { live: options.live });
        }

        let filtered: any[];
        if (options.filter && (llmConfig.apiKey || llmConfig.provider === 'bedrock')) {
          // LLM-powered filtering
          const llmProvider = createProvider(llmConfig.provider, {
            apiKey: llmConfig.apiKey,
            region: llmConfig.region,
          });
          filtered = await filterSchemaWithLLM(columns, options.filter, llmProvider, schemaFilterModel);
        } else if (options.filter) {
          // Keyword fallback (no API key available)
          const filterKeywords = options.filter.split(',').map((k: string) => k.trim().toLowerCase());
          filtered = columns.filter((col: any) => {
            const name = (col.name || '').toLowerCase();
            const desc = (col.description || '').toLowerCase();
            return filterKeywords.some((kw: string) => name.includes(kw) || desc.includes(kw));
          });
        } else {
          filtered = columns;
        }

        results[tableName] = filtered;
      }

      if (options.format === 'json') {
        console.log(JSON.stringify(results, null, 2));
      } else {
        for (const [tableName, columns] of Object.entries(results)) {
          console.log('');
          console.log(`  ${tableName}`);
          console.log('  ' + '─'.repeat(60));

          if (columns.length === 0) {
            console.log('  (no columns match filter)');
          } else {
            const nameWidth = Math.max(20, ...columns.map((c: any) => (c.name || '').length + 2));
            const typeWidth = 15;

            console.log(
              '  ' +
              'Column'.padEnd(nameWidth) +
              'Type'.padEnd(typeWidth) +
              'Description'
            );
            console.log(
              '  ' +
              '─'.repeat(nameWidth) +
              '─'.repeat(typeWidth) +
              '─'.repeat(30)
            );

            for (const col of columns) {
              console.log(
                '  ' +
                (col.name || '').padEnd(nameWidth) +
                (col.type || '').padEnd(typeWidth) +
                (col.description || '')
              );
            }
          }

          console.log(`  ${columns.length} columns`);
        }
        console.log('');
      }
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

async function browseProject(options: { project: string; dataset?: string; tables?: string; list?: boolean; filter?: string; format?: string }) {
  const bq = new BigQuery({ projectId: options.project });

  // If no dataset specified, list all datasets in the project
  if (!options.dataset && !options.tables) {
    const [datasets] = await bq.getDatasets();
    if (options.format === 'json') {
      console.log(JSON.stringify(datasets.map(d => d.id), null, 2));
    } else {
      console.log('');
      console.log(`  Datasets in project: ${options.project}`);
      console.log('  ' + '─'.repeat(50));
      for (const ds of datasets) {
        console.log(`  ${ds.id}`);
      }
      console.log('');
      console.log(`  ${datasets.length} datasets found`);
      console.log('');
      console.log('  To list tables in a dataset:');
      console.log(`    uc-bq schema --project=${options.project} --dataset=DATASET_NAME --list`);
      console.log('');
    }
    return;
  }

  // If dataset specified with --list, list tables in that dataset
  if (options.dataset && (options.list || !options.tables)) {
    const [tables] = await bq.dataset(options.dataset).getTables();
    if (options.format === 'json') {
      console.log(JSON.stringify(tables.map(t => t.id), null, 2));
    } else {
      console.log('');
      console.log(`  Tables in ${options.project}.${options.dataset}`);
      console.log('  ' + '─'.repeat(50));
      for (const t of tables) {
        console.log(`  ${t.id}`);
      }
      console.log('');
      console.log(`  ${tables.length} tables found`);
      console.log('');
      console.log('  To get schema for a table:');
      console.log(`    uc-bq schema --project=${options.project} --dataset=${options.dataset} --tables=TABLE_NAME`);
      console.log('');
    }
    return;
  }

  // If dataset + tables specified, fetch schemas
  if (options.dataset && options.tables) {
    const tableNames = options.tables.split(',').map((t: string) => t.trim());
    const filterKeywords = options.filter
      ? options.filter.split(',').map((k: string) => k.trim().toLowerCase())
      : null;

    const results: Record<string, any[]> = {};

    for (const tableName of tableNames) {
      const [metadata] = await bq.dataset(options.dataset).table(tableName).getMetadata();
      let columns = metadata.schema?.fields || [];

      if (filterKeywords) {
        columns = columns.filter((col: any) => {
          const name = (col.name || '').toLowerCase();
          const desc = (col.description || '').toLowerCase();
          return filterKeywords.some((kw: string) => name.includes(kw) || desc.includes(kw));
        });
      }

      results[tableName] = columns;
    }

    if (options.format === 'json') {
      console.log(JSON.stringify(results, null, 2));
    } else {
      for (const [tableName, columns] of Object.entries(results)) {
        console.log('');
        console.log(`  ${options.project}.${options.dataset}.${tableName}`);
        console.log('  ' + '─'.repeat(60));

        if (columns.length === 0) {
          console.log('  (no columns match filter)');
        } else {
          const nameWidth = Math.max(20, ...columns.map((c: any) => (c.name || '').length + 2));
          const typeWidth = 15;

          console.log(
            '  ' +
            'Column'.padEnd(nameWidth) +
            'Type'.padEnd(typeWidth) +
            'Mode'
          );
          console.log(
            '  ' +
            '─'.repeat(nameWidth) +
            '─'.repeat(typeWidth) +
            '─'.repeat(15)
          );

          for (const col of columns) {
            console.log(
              '  ' +
              (col.name || '').padEnd(nameWidth) +
              (col.type || '').padEnd(typeWidth) +
              (col.mode || '')
            );
          }
        }

        console.log(`  ${columns.length} columns`);
      }
      console.log('');
    }
    return;
  }
}
