import { Command } from 'commander';
import * as fs from 'fs';
import * as yaml from 'js-yaml';
import { loadConfig, validateConfig } from '../lib/config';
import { validateManifest } from '../lib/validator';

export const validateCommand = new Command('validate')
  .description('Validate config or manifest against JSON Schema')
  .option('--config', 'Validate .ultracart-bq.json config file')
  .option('--manifest <path>', 'Path to report.yaml manifest file')
  .action(async (options) => {
    try {
      if (!options.config && !options.manifest) {
        console.error('Error: Specify --config or --manifest <path>.');
        process.exit(1);
      }

      let hasErrors = false;

      if (options.config) {
        console.log('');
        console.log('  Validating .ultracart-bq.json');
        console.log('  ' + '─'.repeat(40));

        try {
          const config = loadConfig();
          const result = validateConfig(config);

          if (result.valid) {
            console.log('  PASS - Config is valid');
          } else {
            hasErrors = true;
            console.log('  FAIL - Config validation errors:');
            for (const err of result.errors) {
              console.log(`    - ${err}`);
            }
          }
        } catch (err: any) {
          hasErrors = true;
          console.log(`  FAIL - ${err.message}`);
        }
        console.log('');
      }

      if (options.manifest) {
        console.log('');
        console.log(`  Validating ${options.manifest}`);
        console.log('  ' + '─'.repeat(40));

        if (!fs.existsSync(options.manifest)) {
          console.error(`  FAIL - File not found: ${options.manifest}`);
          process.exit(1);
        }

        const manifestContent = fs.readFileSync(options.manifest, 'utf-8');
        const manifestData = yaml.load(manifestContent, { schema: yaml.JSON_SCHEMA });
        const result = validateManifest(manifestData);

        if (result.valid) {
          console.log('  PASS - Manifest is valid');
        } else {
          hasErrors = true;
          console.log('  FAIL - Manifest validation errors:');
          for (const err of result.errors) {
            console.log(`    - ${err}`);
          }
        }
        console.log('');
      }

      if (hasErrors) {
        process.exit(1);
      }
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });
