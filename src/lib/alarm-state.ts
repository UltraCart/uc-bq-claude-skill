import * as fs from 'fs';
import * as path from 'path';

const STATE_FILENAME = 'alarm_state.json';
const MAX_HISTORY_ENTRIES = 30;

export interface MetricHistoryEntry {
  run_date: string;
  parameters: Record<string, unknown>;
  metrics: Record<string, number>;
  alarms_triggered: string[];
}

export interface SuppressionEntry {
  last_fired: string;
  consecutive_fires: number;
}

export interface AlarmState {
  metric_history: MetricHistoryEntry[];
  suppression: Record<string, SuppressionEntry>;
}

export function loadAlarmState(reportDir: string): AlarmState {
  const filePath = path.join(reportDir, STATE_FILENAME);
  if (!fs.existsSync(filePath)) {
    return { metric_history: [], suppression: {} };
  }

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(content) as AlarmState;
    return {
      metric_history: parsed.metric_history || [],
      suppression: parsed.suppression || {},
    };
  } catch {
    return { metric_history: [], suppression: {} };
  }
}

export function saveAlarmState(reportDir: string, state: AlarmState): void {
  const filePath = path.join(reportDir, STATE_FILENAME);
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf-8');
}

/**
 * Record a new run's metrics and triggered alarms into state.
 * Prunes history to MAX_HISTORY_ENTRIES.
 */
export function recordAlarmRun(
  state: AlarmState,
  parameters: Record<string, unknown>,
  metrics: Record<string, number>,
  triggeredAlarmNames: string[],
  suppressedAlarmNames: string[],
): void {
  const runDate = new Date().toISOString().split('T')[0];

  // Add metric history entry
  state.metric_history.push({
    run_date: runDate,
    parameters,
    metrics,
    alarms_triggered: triggeredAlarmNames,
  });

  // Prune old entries
  if (state.metric_history.length > MAX_HISTORY_ENTRIES) {
    state.metric_history = state.metric_history.slice(-MAX_HISTORY_ENTRIES);
  }

  // Update suppression for triggered (non-suppressed) alarms
  for (const name of triggeredAlarmNames) {
    if (suppressedAlarmNames.includes(name)) continue;
    const existing = state.suppression[name];
    state.suppression[name] = {
      last_fired: new Date().toISOString(),
      consecutive_fires: existing ? existing.consecutive_fires + 1 : 1,
    };
  }

  // Clear suppression for alarms that didn't trigger (condition cleared)
  for (const name of Object.keys(state.suppression)) {
    if (!triggeredAlarmNames.includes(name)) {
      delete state.suppression[name];
    }
  }
}

/**
 * Get a formatted history of alarm firings for display.
 */
export function formatAlarmHistory(state: AlarmState): string {
  if (state.metric_history.length === 0) {
    return 'No alarm history.';
  }

  const lines: string[] = [];
  for (const entry of state.metric_history) {
    const metricsStr = Object.entries(entry.metrics)
      .map(([k, v]) => `${k}=${typeof v === 'number' ? v.toFixed(2) : v}`)
      .join(', ');
    const alarmsStr = entry.alarms_triggered.length > 0
      ? ` ALARMS: ${entry.alarms_triggered.join(', ')}`
      : '';
    lines.push(`${entry.run_date}  ${metricsStr}${alarmsStr}`);
  }

  return lines.join('\n');
}
