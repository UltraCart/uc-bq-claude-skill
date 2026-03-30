#!/usr/bin/env node
import { Command } from 'commander';
import { initCommand } from './commands/init';
import { schemaCommand } from './commands/schema';
import { queryCommand } from './commands/query';
import { dryRunCommand } from './commands/dry-run';
import { validateCommand } from './commands/validate';
import { renderCommand } from './commands/render';
import { runCommand } from './commands/run';
import { runAllCommand } from './commands/run-all';
import { listCommand } from './commands/list';
import { historyCommand } from './commands/history';
import { configCommand } from './commands/config';
import { deckCommand } from './commands/deck';
import { alarmCommand } from './commands/alarm';

const pkg = require('../package.json');

const program = new Command();

program
  .name('uc-bq')
  .description('UltraCart BigQuery reporting CLI — create, refine, and replay e-commerce reports')
  .version(pkg.version)
  .option('-m, --merchant <id>', 'Merchant ID (overrides default_merchant in config)')
  .option('--llm-provider <provider>', 'LLM provider: anthropic, openai, grok, bedrock, gemini');

program.addCommand(initCommand);
program.addCommand(schemaCommand);
program.addCommand(queryCommand);
program.addCommand(dryRunCommand);
program.addCommand(validateCommand);
program.addCommand(renderCommand);
program.addCommand(runCommand);
program.addCommand(runAllCommand);
program.addCommand(listCommand);
program.addCommand(historyCommand);
program.addCommand(configCommand);
program.addCommand(deckCommand);
program.addCommand(alarmCommand);

program.parse();
