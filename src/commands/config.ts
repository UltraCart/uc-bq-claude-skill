import * as fs from 'fs';
import * as path from 'path';
import { Command } from 'commander';
import { BigQuery } from '@google-cloud/bigquery';
import { readRawConfig, writeConfig } from '../lib/config-writer';
import { loadConfig, resolveMerchant } from '../lib/config';
import { loadManifest, saveManifest } from '../lib/manifest';

function getMerchantId(cmd: Command): string {
  const globalOpts = cmd.optsWithGlobals ? cmd.optsWithGlobals() : (cmd.parent?.parent?.opts() || {});
  const raw = readRawConfig();
  return globalOpts.merchant || raw.default_merchant;
}

function ensureMerchant(raw: Record<string, any>, merchantId: string): Record<string, any> {
  if (!raw.merchants?.[merchantId]) {
    throw new Error(`Merchant "${merchantId}" not found in config. Available: ${Object.keys(raw.merchants || {}).join(', ')}`);
  }
  return raw.merchants[merchantId];
}

function ensureExternalProject(merchant: Record<string, any>, alias: string): Record<string, any> {
  if (!merchant.external_projects?.[alias]) {
    throw new Error(`External project "${alias}" not found. Available: ${Object.keys(merchant.external_projects || {}).join(', ') || 'none'}`);
  }
  return merchant.external_projects[alias];
}

export const configCommand = new Command('config')
  .description('Manage configuration — add/remove merchants, external projects, datasets, tables');

// show
configCommand
  .command('show')
  .description('Display current configuration')
  .action(() => {
    const raw = readRawConfig();
    console.log(JSON.stringify(raw, null, 2));
  });

// add-merchant
configCommand
  .command('add-merchant <id>')
  .description('Add a merchant to the config')
  .requiredOption('--taxonomy <level>', 'Taxonomy level: standard, low, medium, high')
  .option('--dataset <dataset>', 'BigQuery dataset name', 'ultracart_dw')
  .action((id: string, options: { taxonomy: string; dataset: string }) => {
    const validLevels = ['standard', 'low', 'medium', 'high'];
    if (!validLevels.includes(options.taxonomy)) {
      console.error(`Error: taxonomy must be one of: ${validLevels.join(', ')}`);
      process.exit(1);
    }

    const raw = readRawConfig();
    if (raw.merchants?.[id]) {
      console.error(`Error: Merchant "${id}" already exists.`);
      process.exit(1);
    }

    if (!raw.merchants) raw.merchants = {};
    raw.merchants[id] = { taxonomy_level: options.taxonomy, dataset: options.dataset };
    writeConfig(raw);
    console.log(`  Added merchant "${id}" (taxonomy: ${options.taxonomy}, dataset: ${options.dataset})`);
  });

// remove-merchant
configCommand
  .command('remove-merchant <id>')
  .description('Remove a merchant from the config')
  .action((id: string) => {
    const raw = readRawConfig();
    ensureMerchant(raw, id);

    if (raw.default_merchant === id) {
      console.error(`Error: Cannot remove the default merchant "${id}". Change default_merchant first.`);
      process.exit(1);
    }

    delete raw.merchants[id];
    writeConfig(raw);
    console.log(`  Removed merchant "${id}"`);
  });

// add-project
configCommand
  .command('add-project <alias>')
  .description('Register an external BigQuery project')
  .requiredOption('--project-id <id>', 'GCP project ID')
  .option('--description <desc>', 'Description of the project')
  .action((alias: string, options: { projectId: string; description?: string }, cmd: Command) => {
    const raw = readRawConfig();
    const merchantId = getMerchantId(cmd);
    const merchant = ensureMerchant(raw, merchantId);

    if (merchant.external_projects?.[alias]) {
      console.error(`Error: External project "${alias}" already exists for merchant "${merchantId}".`);
      process.exit(1);
    }

    if (!merchant.external_projects) merchant.external_projects = {};
    merchant.external_projects[alias] = {
      project_id: options.projectId,
      ...(options.description ? { description: options.description } : {}),
      datasets: {},
    };

    writeConfig(raw);
    console.log(`  Added external project "${alias}" (${options.projectId}) to merchant "${merchantId}"`);
  });

// remove-project
configCommand
  .command('remove-project <alias>')
  .description('Remove an external BigQuery project')
  .action((alias: string, _options: any, cmd: Command) => {
    const raw = readRawConfig();
    const merchantId = getMerchantId(cmd);
    const merchant = ensureMerchant(raw, merchantId);
    ensureExternalProject(merchant, alias);

    delete merchant.external_projects[alias];
    if (Object.keys(merchant.external_projects).length === 0) {
      delete merchant.external_projects;
    }

    writeConfig(raw);
    console.log(`  Removed external project "${alias}" from merchant "${merchantId}"`);
  });

// add-dataset
configCommand
  .command('add-dataset <alias> <dataset>')
  .description('Add a dataset to an external project')
  .option('--discover', 'Auto-discover and add all tables from the dataset')
  .action(async (alias: string, dataset: string, options: { discover?: boolean }, cmd: Command) => {
    const raw = readRawConfig();
    const merchantId = getMerchantId(cmd);
    const merchant = ensureMerchant(raw, merchantId);
    const project = ensureExternalProject(merchant, alias);

    if (project.datasets[dataset]) {
      console.error(`Error: Dataset "${dataset}" already exists in project "${alias}".`);
      process.exit(1);
    }

    let tables: string[] = [];
    if (options.discover) {
      console.log(`  Discovering tables in ${project.project_id}.${dataset}...`);
      const bq = new BigQuery({ projectId: project.project_id });
      const [bqTables] = await bq.dataset(dataset).getTables();
      tables = bqTables.map(t => t.id!).filter(Boolean);
      console.log(`  Found ${tables.length} tables`);
    }

    project.datasets[dataset] = tables;
    writeConfig(raw);
    console.log(`  Added dataset "${dataset}" to project "${alias}" (${tables.length} tables)`);
  });

// remove-dataset
configCommand
  .command('remove-dataset <alias> <dataset>')
  .description('Remove a dataset from an external project')
  .action((alias: string, dataset: string, _options: any, cmd: Command) => {
    const raw = readRawConfig();
    const merchantId = getMerchantId(cmd);
    const merchant = ensureMerchant(raw, merchantId);
    const project = ensureExternalProject(merchant, alias);

    if (!project.datasets[dataset]) {
      console.error(`Error: Dataset "${dataset}" not found in project "${alias}".`);
      process.exit(1);
    }

    delete project.datasets[dataset];
    writeConfig(raw);
    console.log(`  Removed dataset "${dataset}" from project "${alias}"`);
  });

// add-tables
configCommand
  .command('add-tables <alias> <dataset> <tables...>')
  .description('Add tables to a dataset in an external project')
  .action((alias: string, dataset: string, tables: string[], cmd: Command) => {
    const raw = readRawConfig();
    const merchantId = getMerchantId(cmd);
    const merchant = ensureMerchant(raw, merchantId);
    const project = ensureExternalProject(merchant, alias);

    if (!project.datasets[dataset]) {
      project.datasets[dataset] = [];
    }

    const existing = new Set(project.datasets[dataset]);
    let added = 0;
    for (const t of tables) {
      if (!existing.has(t)) {
        project.datasets[dataset].push(t);
        existing.add(t);
        added++;
      }
    }

    writeConfig(raw);
    console.log(`  Added ${added} table(s) to ${alias}.${dataset} (${project.datasets[dataset].length} total)`);
  });

// remove-tables
configCommand
  .command('remove-tables <alias> <dataset> <tables...>')
  .description('Remove tables from a dataset in an external project')
  .action((alias: string, dataset: string, tables: string[], cmd: Command) => {
    const raw = readRawConfig();
    const merchantId = getMerchantId(cmd);
    const merchant = ensureMerchant(raw, merchantId);
    const project = ensureExternalProject(merchant, alias);

    if (!project.datasets[dataset]) {
      console.error(`Error: Dataset "${dataset}" not found in project "${alias}".`);
      process.exit(1);
    }

    const toRemove = new Set(tables);
    const before = project.datasets[dataset].length;
    project.datasets[dataset] = project.datasets[dataset].filter((t: string) => !toRemove.has(t));

    writeConfig(raw);
    console.log(`  Removed ${before - project.datasets[dataset].length} table(s) from ${alias}.${dataset} (${project.datasets[dataset].length} remaining)`);
  });

// ---------------------------------------------------------------------------
// Delivery config helpers & subcommands
// ---------------------------------------------------------------------------

function loadReportForDelivery(cmd: Command, reportName: string) {
  const config = loadConfig();
  const globalOpts = cmd.optsWithGlobals ? cmd.optsWithGlobals() : (cmd.parent?.parent?.opts() || {});
  const merchant = resolveMerchant(config, globalOpts.merchant);
  const reportDir = path.join(path.resolve(merchant.default_output_dir), reportName);
  if (!fs.existsSync(reportDir)) throw new Error(`Report "${reportName}" not found`);
  const manifest = loadManifest(reportDir);
  return { manifest, reportDir };
}

// add-slack
configCommand
  .command('add-slack <report> <channels...>')
  .description('Add Slack channel(s) to a report\'s delivery config')
  .action((report: string, channels: string[], _options: any, cmd: Command) => {
    const { manifest, reportDir } = loadReportForDelivery(cmd, report);
    if (!manifest.delivery) manifest.delivery = {};
    if (!manifest.delivery.slack) manifest.delivery.slack = { channels: [] };
    const existing = new Set(manifest.delivery.slack.channels);
    for (const ch of channels) {
      existing.add(ch);
    }
    manifest.delivery.slack.channels = [...existing];
    saveManifest(reportDir, manifest);
    console.log(`  Slack channels for "${report}": ${manifest.delivery.slack.channels.join(', ')}`);
  });

// remove-slack
configCommand
  .command('remove-slack <report> <channels...>')
  .description('Remove Slack channel(s) from a report\'s delivery config')
  .action((report: string, channels: string[], _options: any, cmd: Command) => {
    const { manifest, reportDir } = loadReportForDelivery(cmd, report);
    if (!manifest.delivery?.slack) {
      console.log('  No Slack delivery configured.');
      return;
    }
    const toRemove = new Set(channels);
    manifest.delivery.slack.channels = manifest.delivery.slack.channels.filter(ch => !toRemove.has(ch));
    if (manifest.delivery.slack.channels.length === 0) {
      delete manifest.delivery.slack;
    }
    if (manifest.delivery && !manifest.delivery.slack && !manifest.delivery.email) {
      delete manifest.delivery;
    }
    saveManifest(reportDir, manifest);
    if (manifest.delivery?.slack) {
      console.log(`  Slack channels for "${report}": ${manifest.delivery.slack.channels.join(', ')}`);
    } else {
      console.log(`  Removed all Slack channels from "${report}".`);
    }
  });

// set-email
configCommand
  .command('set-email <report>')
  .description('Set email delivery config for a report')
  .option('--to <emails>', 'Comma-separated recipient email addresses')
  .option('--provider <provider>', 'Email provider: sendgrid, ses, postmark, mailgun, resend')
  .option('--subject <subject>', 'Email subject line')
  .action((report: string, options: { to?: string; provider?: string; subject?: string }, cmd: Command) => {
    const { manifest, reportDir } = loadReportForDelivery(cmd, report);
    if (!manifest.delivery) manifest.delivery = {};

    const validProviders = ['sendgrid', 'ses', 'postmark', 'mailgun', 'resend'];

    if (!manifest.delivery.email) {
      // First use — all three are required
      if (!options.to || !options.provider || !options.subject) {
        console.error('Error: --to, --provider, and --subject are all required when creating email delivery config.');
        process.exit(1);
      }
      if (!validProviders.includes(options.provider)) {
        console.error(`Error: provider must be one of: ${validProviders.join(', ')}`);
        process.exit(1);
      }
      manifest.delivery.email = {
        to: options.to.split(',').map(e => e.trim()),
        provider: options.provider,
        subject: options.subject,
      };
    } else {
      // Subsequent use — update only what's specified
      if (options.to) {
        manifest.delivery.email.to = options.to.split(',').map(e => e.trim());
      }
      if (options.provider) {
        if (!validProviders.includes(options.provider)) {
          console.error(`Error: provider must be one of: ${validProviders.join(', ')}`);
          process.exit(1);
        }
        manifest.delivery.email.provider = options.provider;
      }
      if (options.subject) {
        manifest.delivery.email.subject = options.subject;
      }
    }

    saveManifest(reportDir, manifest);
    console.log(`  Email delivery for "${report}":`);
    console.log(`    To: ${manifest.delivery.email.to.join(', ')}`);
    console.log(`    Provider: ${manifest.delivery.email.provider}`);
    console.log(`    Subject: ${manifest.delivery.email.subject}`);
  });

// add-email
configCommand
  .command('add-email <report> <emails...>')
  .description('Add email recipient(s) to a report\'s delivery config')
  .action((report: string, emails: string[], _options: any, cmd: Command) => {
    const { manifest, reportDir } = loadReportForDelivery(cmd, report);
    if (!manifest.delivery?.email) {
      console.error('Error: No email delivery configured. Use "set-email" first to set provider and subject.');
      process.exit(1);
    }
    const existing = new Set(manifest.delivery.email.to);
    for (const e of emails) {
      existing.add(e);
    }
    manifest.delivery.email.to = [...existing];
    saveManifest(reportDir, manifest);
    console.log(`  Email recipients for "${report}": ${manifest.delivery.email.to.join(', ')}`);
  });

// remove-email
configCommand
  .command('remove-email <report> <emails...>')
  .description('Remove email recipient(s) from a report\'s delivery config')
  .action((report: string, emails: string[], _options: any, cmd: Command) => {
    const { manifest, reportDir } = loadReportForDelivery(cmd, report);
    if (!manifest.delivery?.email) {
      console.log('  No email delivery configured.');
      return;
    }
    const toRemove = new Set(emails);
    manifest.delivery.email.to = manifest.delivery.email.to.filter(e => !toRemove.has(e));
    if (manifest.delivery.email.to.length === 0) {
      delete manifest.delivery.email;
    }
    if (manifest.delivery && !manifest.delivery.slack && !manifest.delivery.email) {
      delete manifest.delivery;
    }
    saveManifest(reportDir, manifest);
    if (manifest.delivery?.email) {
      console.log(`  Email recipients for "${report}": ${manifest.delivery.email.to.join(', ')}`);
    } else {
      console.log(`  Removed all email delivery from "${report}".`);
    }
  });

// set-email-provider
configCommand
  .command('set-email-provider <report> <provider>')
  .description('Update the email provider for a report')
  .action((report: string, provider: string, _options: any, cmd: Command) => {
    const validProviders = ['sendgrid', 'ses', 'postmark', 'mailgun', 'resend'];
    if (!validProviders.includes(provider)) {
      console.error(`Error: provider must be one of: ${validProviders.join(', ')}`);
      process.exit(1);
    }
    const { manifest, reportDir } = loadReportForDelivery(cmd, report);
    if (!manifest.delivery?.email) {
      console.error('Error: No email delivery configured. Use "set-email" first.');
      process.exit(1);
    }
    manifest.delivery.email.provider = provider;
    saveManifest(reportDir, manifest);
    console.log(`  Email provider for "${report}" set to: ${provider}`);
  });

// set-email-subject
configCommand
  .command('set-email-subject <report> <subject>')
  .description('Update the email subject for a report')
  .action((report: string, subject: string, _options: any, cmd: Command) => {
    const { manifest, reportDir } = loadReportForDelivery(cmd, report);
    if (!manifest.delivery?.email) {
      console.error('Error: No email delivery configured. Use "set-email" first.');
      process.exit(1);
    }
    manifest.delivery.email.subject = subject;
    saveManifest(reportDir, manifest);
    console.log(`  Email subject for "${report}" set to: ${subject}`);
  });

// show-delivery
configCommand
  .command('show-delivery <report>')
  .description('Display the delivery configuration for a report')
  .action((report: string, _options: any, cmd: Command) => {
    const { manifest } = loadReportForDelivery(cmd, report);
    if (!manifest.delivery) {
      console.log(`  No delivery configured for "${report}".`);
      return;
    }
    console.log(`  Delivery config for "${report}":`);
    if (manifest.delivery.slack) {
      console.log(`    Slack channels: ${manifest.delivery.slack.channels.join(', ')}`);
    }
    if (manifest.delivery.email) {
      console.log(`    Email to: ${manifest.delivery.email.to.join(', ')}`);
      console.log(`    Email provider: ${manifest.delivery.email.provider}`);
      console.log(`    Email subject: ${manifest.delivery.email.subject}`);
    }
  });
