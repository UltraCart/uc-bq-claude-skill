import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { loadConfig, resolveMerchant } from '../lib/config';
import { loadManifest } from '../lib/manifest';
import { loadAlarmState, formatAlarmHistory } from '../lib/alarm-state';
import { evaluateAlarms, AlarmResult } from '../lib/alarm';

function loadReportContext(cmd: Command, reportName: string) {
  const config = loadConfig();
  const globalOpts = cmd.optsWithGlobals ? cmd.optsWithGlobals() : (cmd.parent?.parent?.opts() || {});
  const merchant = resolveMerchant(config, globalOpts.merchant);
  const reportDir = path.join(path.resolve(merchant.default_output_dir), reportName);
  if (!fs.existsSync(reportDir)) throw new Error(`Report "${reportName}" not found`);
  return { reportDir };
}

// ---- alarm test ----

const alarmTestCommand = new Command('test')
  .description('Test alarms against current data.json (no query, no delivery)')
  .argument('<report-name>', 'Report directory name')
  .action((reportName: string, _options: any, cmd: Command) => {
    try {
      const { reportDir } = loadReportContext(cmd, reportName);
      const manifest = loadManifest(reportDir);

      if (!manifest.alarms || manifest.alarms.length === 0) {
        console.log(`\n  No alarms defined for "${reportName}".\n`);
        return;
      }

      // Load current data.json
      const dataPath = path.join(reportDir, 'data.json');
      if (!fs.existsSync(dataPath)) {
        console.error(`Error: No data.json found. Run the report first: uc-bq run ${reportName}`);
        process.exit(1);
      }

      const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8')) as Record<string, unknown>[];
      const alarmState = loadAlarmState(reportDir);
      const results = evaluateAlarms(manifest.alarms, data, alarmState);

      console.log('');
      console.log(`  Alarm Test: ${manifest.name}`);
      console.log('  ' + '\u2500'.repeat(60));
      console.log(`  Data rows: ${data.length}`);
      console.log(`  Alarms defined: ${manifest.alarms.length}`);
      console.log('');

      for (const result of results) {
        const icon = result.triggered
          ? (result.suppressed ? '\u23f8' : '\u26a0')
          : '\u2713';
        const status = result.triggered
          ? (result.suppressed ? 'TRIGGERED (suppressed)' : 'TRIGGERED')
          : 'OK';
        const severityLabel = result.alarm.severity.toUpperCase();

        console.log(`  ${icon} ${result.alarm.name} [${severityLabel}] — ${status}`);
        console.log(`    ${result.reason}`);

        if (result.currentValue !== undefined) {
          console.log(`    Current value: ${result.currentValue}`);
        }
        if (result.previousValue !== undefined) {
          console.log(`    Previous value: ${result.previousValue}`);
        }
        if (result.pctChange !== undefined) {
          console.log(`    Change: ${result.pctChange >= 0 ? '+' : ''}${result.pctChange.toFixed(1)}%`);
        }
        console.log('');
      }

      const triggered = results.filter(r => r.triggered && !r.suppressed);
      const suppressed = results.filter(r => r.triggered && r.suppressed);
      const ok = results.filter(r => !r.triggered);

      console.log('  ' + '\u2500'.repeat(60));
      console.log(`  Summary: ${triggered.length} would fire, ${suppressed.length} suppressed, ${ok.length} OK`);
      console.log('');
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// ---- alarm history ----

const alarmHistoryCommand = new Command('history')
  .description('Show alarm history from alarm_state.json')
  .argument('<report-name>', 'Report directory name')
  .action((reportName: string, _options: any, cmd: Command) => {
    try {
      const { reportDir } = loadReportContext(cmd, reportName);
      const alarmState = loadAlarmState(reportDir);

      console.log('');
      console.log(`  Alarm History: ${reportName}`);
      console.log('  ' + '\u2500'.repeat(60));
      console.log(formatAlarmHistory(alarmState).split('\n').map(l => `  ${l}`).join('\n'));

      // Show active suppressions
      const suppressions = Object.entries(alarmState.suppression);
      if (suppressions.length > 0) {
        console.log('');
        console.log('  Active suppressions:');
        for (const [name, entry] of suppressions) {
          console.log(`    ${name}: last fired ${entry.last_fired}, ${entry.consecutive_fires} consecutive`);
        }
      }
      console.log('');
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// ---- alarm command group ----

export const alarmCommand = new Command('alarm')
  .description('Test and inspect report alarms');

alarmCommand.addCommand(alarmTestCommand);
alarmCommand.addCommand(alarmHistoryCommand);
