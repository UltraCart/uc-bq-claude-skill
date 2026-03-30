import { AlarmDefinition, AlarmAggregate, AlarmOperator } from './manifest';
import { AlarmState, MetricHistoryEntry, loadAlarmState } from './alarm-state';

export interface AlarmResult {
  alarm: AlarmDefinition;
  triggered: boolean;
  currentValue?: number;
  previousValue?: number;
  pctChange?: number;
  reason: string;
  suppressed: boolean;
}

/**
 * Evaluate all alarms for a report against the current data.json rows.
 */
export function evaluateAlarms(
  alarms: AlarmDefinition[],
  data: Record<string, unknown>[],
  alarmState: AlarmState,
): AlarmResult[] {
  const results: AlarmResult[] = [];

  for (const alarm of alarms) {
    const result = evaluateAlarm(alarm, data, alarmState);
    results.push(result);
  }

  return results;
}

function evaluateAlarm(
  alarm: AlarmDefinition,
  data: Record<string, unknown>[],
  alarmState: AlarmState,
): AlarmResult {
  switch (alarm.type) {
    case 'missing_data':
      return evaluateMissingData(alarm, data, alarmState);
    case 'threshold':
      return evaluateThreshold(alarm, data, alarmState);
    case 'pct_change':
      return evaluatePctChange(alarm, data, alarmState);
    default:
      return { alarm, triggered: false, reason: `Unknown alarm type: ${alarm.type}`, suppressed: false };
  }
}

function evaluateMissingData(
  alarm: AlarmDefinition,
  data: Record<string, unknown>[],
  alarmState: AlarmState,
): AlarmResult {
  const triggered = data.length === 0;
  const suppressed = triggered && isSuppressed(alarm, alarmState);

  return {
    alarm,
    triggered,
    reason: triggered ? 'Query returned zero rows' : `Query returned ${data.length} rows`,
    suppressed,
  };
}

function evaluateThreshold(
  alarm: AlarmDefinition,
  data: Record<string, unknown>[],
  alarmState: AlarmState,
): AlarmResult {
  if (!alarm.metric || alarm.operator === undefined || alarm.value === undefined) {
    return { alarm, triggered: false, reason: 'Alarm missing required fields: metric, operator, value', suppressed: false };
  }

  if (data.length === 0) {
    return { alarm, triggered: false, reason: 'No data to evaluate', suppressed: false };
  }

  const aggregate = alarm.aggregate || 'sum';
  const currentValue = aggregateMetric(data, alarm.metric, aggregate);

  if (currentValue === null) {
    return { alarm, triggered: false, reason: `Metric "${alarm.metric}" not found or not numeric`, suppressed: false };
  }

  const triggered = compareValues(currentValue, alarm.operator, alarm.value);
  const suppressed = triggered && isSuppressed(alarm, alarmState);

  return {
    alarm,
    triggered,
    currentValue,
    reason: triggered
      ? `${alarm.metric} (${aggregate}) = ${currentValue} ${alarm.operator} ${alarm.value}`
      : `${alarm.metric} (${aggregate}) = ${currentValue}, threshold ${alarm.operator} ${alarm.value} not met`,
    suppressed,
  };
}

function evaluatePctChange(
  alarm: AlarmDefinition,
  data: Record<string, unknown>[],
  alarmState: AlarmState,
): AlarmResult {
  if (!alarm.metric || alarm.operator === undefined || alarm.value === undefined) {
    return { alarm, triggered: false, reason: 'Alarm missing required fields: metric, operator, value', suppressed: false };
  }

  if (data.length === 0) {
    return { alarm, triggered: false, reason: 'No data to evaluate', suppressed: false };
  }

  const aggregate = alarm.aggregate || 'sum';
  const currentValue = aggregateMetric(data, alarm.metric, aggregate);

  if (currentValue === null) {
    return { alarm, triggered: false, reason: `Metric "${alarm.metric}" not found or not numeric`, suppressed: false };
  }

  // Find previous run's metric value
  const previousEntry = getPreviousMetricEntry(alarmState, alarm.metric);
  if (!previousEntry) {
    return {
      alarm,
      triggered: false,
      currentValue,
      reason: `No previous run data for "${alarm.metric}" — first run, skipping percent change check`,
      suppressed: false,
    };
  }

  const previousValue = previousEntry.metrics[alarm.metric];
  if (previousValue === 0) {
    // Avoid division by zero
    const triggered = currentValue !== 0;
    const suppressed = triggered && isSuppressed(alarm, alarmState);
    return {
      alarm,
      triggered,
      currentValue,
      previousValue,
      reason: triggered
        ? `Previous ${alarm.metric} was 0, current is ${currentValue} — infinite change`
        : `Both previous and current ${alarm.metric} are 0`,
      suppressed,
    };
  }

  const pctChange = ((currentValue - previousValue) / Math.abs(previousValue)) * 100;
  const triggered = compareValues(pctChange, alarm.operator, alarm.value);
  const suppressed = triggered && isSuppressed(alarm, alarmState);

  return {
    alarm,
    triggered,
    currentValue,
    previousValue,
    pctChange,
    reason: triggered
      ? `${alarm.metric} changed ${pctChange >= 0 ? '+' : ''}${pctChange.toFixed(1)}% (${previousValue} → ${currentValue}), threshold ${alarm.operator} ${alarm.value}%`
      : `${alarm.metric} changed ${pctChange >= 0 ? '+' : ''}${pctChange.toFixed(1)}% (${previousValue} → ${currentValue}), threshold ${alarm.operator} ${alarm.value}% not met`,
    suppressed,
  };
}

/**
 * Aggregate a numeric column from the data rows.
 */
export function aggregateMetric(
  data: Record<string, unknown>[],
  metric: string,
  aggregate: AlarmAggregate,
): number | null {
  const values: number[] = [];

  for (const row of data) {
    const raw = row[metric];
    if (raw === null || raw === undefined) continue;
    const num = typeof raw === 'number' ? raw : parseFloat(String(raw));
    if (!isNaN(num)) values.push(num);
  }

  if (values.length === 0) return null;

  switch (aggregate) {
    case 'sum':
      return values.reduce((a, b) => a + b, 0);
    case 'avg':
      return values.reduce((a, b) => a + b, 0) / values.length;
    case 'min':
      return Math.min(...values);
    case 'max':
      return Math.max(...values);
    case 'first':
      return values[0];
    case 'last':
      return values[values.length - 1];
    default:
      return null;
  }
}

function compareValues(actual: number, operator: AlarmOperator, threshold: number): boolean {
  switch (operator) {
    case '<': return actual < threshold;
    case '>': return actual > threshold;
    case '<=': return actual <= threshold;
    case '>=': return actual >= threshold;
    case '==': return actual === threshold;
    case '!=': return actual !== threshold;
    default: return false;
  }
}

function getPreviousMetricEntry(
  alarmState: AlarmState,
  metric: string,
): MetricHistoryEntry | null {
  if (!alarmState.metric_history || alarmState.metric_history.length === 0) return null;

  // Walk backwards to find the most recent entry that has this metric
  for (let i = alarmState.metric_history.length - 1; i >= 0; i--) {
    const entry = alarmState.metric_history[i];
    if (entry.metrics[metric] !== undefined) return entry;
  }

  return null;
}

/**
 * Parse a cooldown duration string like "24h", "7d", "1h" into milliseconds.
 */
export function parseCooldown(cooldown: string): number {
  const match = cooldown.match(/^(\d+)(h|d|m)$/);
  if (!match) return 24 * 60 * 60 * 1000; // default 24h

  const amount = parseInt(match[1], 10);
  switch (match[2]) {
    case 'h': return amount * 60 * 60 * 1000;
    case 'd': return amount * 24 * 60 * 60 * 1000;
    case 'm': return amount * 60 * 1000;
    default: return 24 * 60 * 60 * 1000;
  }
}

function isSuppressed(alarm: AlarmDefinition, alarmState: AlarmState): boolean {
  const cooldown = alarm.cooldown || '24h';
  if (cooldown === '0') return false;

  const suppression = alarmState.suppression?.[alarm.name];
  if (!suppression) return false;

  const lastFired = new Date(suppression.last_fired).getTime();
  const now = Date.now();
  const cooldownMs = parseCooldown(cooldown);

  return (now - lastFired) < cooldownMs;
}

/**
 * Extract the metrics referenced by alarms from the current data.
 */
export function extractAlarmMetrics(
  alarms: AlarmDefinition[],
  data: Record<string, unknown>[],
): Record<string, number> {
  const metrics: Record<string, number> = {};

  for (const alarm of alarms) {
    if (alarm.metric && alarm.type !== 'missing_data') {
      const aggregate = alarm.aggregate || 'sum';
      const value = aggregateMetric(data, alarm.metric, aggregate);
      if (value !== null) {
        metrics[alarm.metric] = value;
      }
    }
  }

  return metrics;
}
