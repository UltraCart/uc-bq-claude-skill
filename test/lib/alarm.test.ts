import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateAlarms, aggregateMetric, parseCooldown, extractAlarmMetrics } from '../../src/lib/alarm';
import { AlarmDefinition } from '../../src/lib/manifest';
import { AlarmState } from '../../src/lib/alarm-state';
import { withFrozenTime } from '../helpers/clock';

function emptyState(): AlarmState {
  return { metric_history: [], suppression: {} };
}

const ROWS = [
  { day: '2026-01-01', revenue: 100, orders: 5 },
  { day: '2026-01-02', revenue: 250, orders: 9 },
  { day: '2026-01-03', revenue: 50, orders: 2 },
];

describe('aggregateMetric', () => {
  it('computes each supported aggregate', () => {
    assert.equal(aggregateMetric(ROWS, 'revenue', 'sum'), 400);
    assert.equal(aggregateMetric(ROWS, 'revenue', 'avg'), 400 / 3);
    assert.equal(aggregateMetric(ROWS, 'revenue', 'min'), 50);
    assert.equal(aggregateMetric(ROWS, 'revenue', 'max'), 250);
    assert.equal(aggregateMetric(ROWS, 'revenue', 'first'), 100);
    assert.equal(aggregateMetric(ROWS, 'revenue', 'last'), 50);
  });

  it('parses numeric strings, which is how BigQuery returns NUMERIC', () => {
    const rows = [{ revenue: '10.5' }, { revenue: '20.25' }];
    assert.equal(aggregateMetric(rows, 'revenue', 'sum'), 30.75);
  });

  it('skips null and undefined without letting them count toward avg', () => {
    const rows = [{ revenue: 10 }, { revenue: null }, { revenue: undefined }, { revenue: 20 }];
    assert.equal(aggregateMetric(rows, 'revenue', 'sum'), 30);
    assert.equal(aggregateMetric(rows, 'revenue', 'avg'), 15);
  });

  it('skips non-numeric values', () => {
    const rows = [{ revenue: 10 }, { revenue: 'not a number' }, { revenue: 20 }];
    assert.equal(aggregateMetric(rows, 'revenue', 'sum'), 30);
  });

  it('returns null when the column is absent or has no numeric values', () => {
    assert.equal(aggregateMetric(ROWS, 'nonexistent', 'sum'), null);
    assert.equal(aggregateMetric([], 'revenue', 'sum'), null);
    assert.equal(aggregateMetric([{ revenue: 'abc' }], 'revenue', 'sum'), null);
  });

  it('distinguishes an absent column from a legitimate zero', () => {
    // null means "cannot evaluate"; 0 means "evaluated to zero". Conflating
    // them would make a threshold like `revenue < 100` fire on missing data.
    assert.equal(aggregateMetric([{ revenue: 0 }], 'revenue', 'sum'), 0);
    assert.equal(aggregateMetric([{ other: 1 }], 'revenue', 'sum'), null);
  });

  it('handles negative values', () => {
    const rows = [{ v: -10 }, { v: 5 }];
    assert.equal(aggregateMetric(rows, 'v', 'sum'), -5);
    assert.equal(aggregateMetric(rows, 'v', 'min'), -10);
  });
});

describe('parseCooldown', () => {
  it('parses minutes, hours and days', () => {
    assert.equal(parseCooldown('30m'), 30 * 60 * 1000);
    assert.equal(parseCooldown('1h'), 60 * 60 * 1000);
    assert.equal(parseCooldown('24h'), 24 * 60 * 60 * 1000);
    assert.equal(parseCooldown('7d'), 7 * 24 * 60 * 60 * 1000);
  });

  it('falls back to 24h on unparseable input', () => {
    const day = 24 * 60 * 60 * 1000;
    assert.equal(parseCooldown('garbage'), day);
    assert.equal(parseCooldown(''), day);
    assert.equal(parseCooldown('5'), day);
    assert.equal(parseCooldown('-1h'), day);
  });
});

describe('evaluateAlarms — threshold', () => {
  const alarm: AlarmDefinition = {
    name: 'low_revenue',
    type: 'threshold',
    metric: 'revenue',
    aggregate: 'sum',
    operator: '<',
    value: 500,
    severity: 'high',
  };

  it('triggers when the comparison holds', () => {
    const [result] = evaluateAlarms([alarm], ROWS, emptyState());
    assert.equal(result.triggered, true);
    assert.equal(result.currentValue, 400);
    assert.match(result.reason, /revenue/);
  });

  it('does not trigger when the comparison fails', () => {
    const [result] = evaluateAlarms([{ ...alarm, value: 100 }], ROWS, emptyState());
    assert.equal(result.triggered, false);
    assert.equal(result.currentValue, 400);
  });

  it('defaults to the sum aggregate', () => {
    const { aggregate, ...withoutAggregate } = alarm;
    void aggregate;
    const [result] = evaluateAlarms([withoutAggregate as AlarmDefinition], ROWS, emptyState());
    assert.equal(result.currentValue, 400);
  });

  it('evaluates each operator', () => {
    const cases: Array<[AlarmDefinition['operator'], number, boolean]> = [
      ['<', 500, true], ['<', 400, false],
      ['>', 300, true], ['>', 400, false],
      ['<=', 400, true], ['>=', 400, true],
      ['==', 400, true], ['==', 399, false],
      ['!=', 399, true], ['!=', 400, false],
    ];
    for (const [operator, value, expected] of cases) {
      const [result] = evaluateAlarms([{ ...alarm, operator, value }], ROWS, emptyState());
      assert.equal(result.triggered, expected, `${operator} ${value} should be ${expected}`);
    }
  });

  it('does not trigger when the metric is missing', () => {
    const [result] = evaluateAlarms([{ ...alarm, metric: 'nope' }], ROWS, emptyState());
    assert.equal(result.triggered, false);
    assert.match(result.reason, /not found or not numeric/);
  });

  it('does not trigger on an empty result set', () => {
    // missing_data is the alarm for that; a threshold should stay quiet rather
    // than treating "no rows" as a zero that trips `< 500`.
    const [result] = evaluateAlarms([alarm], [], emptyState());
    assert.equal(result.triggered, false);
    assert.match(result.reason, /No data/);
  });

  it('does not trigger when required fields are absent', () => {
    const incomplete = { name: 'x', type: 'threshold', severity: 'low' } as AlarmDefinition;
    const [result] = evaluateAlarms([incomplete], ROWS, emptyState());
    assert.equal(result.triggered, false);
    assert.match(result.reason, /missing required fields/);
  });
});

describe('evaluateAlarms — missing_data', () => {
  const alarm: AlarmDefinition = { name: 'no_rows', type: 'missing_data', severity: 'critical' };

  it('triggers on an empty result set', () => {
    const [result] = evaluateAlarms([alarm], [], emptyState());
    assert.equal(result.triggered, true);
    assert.match(result.reason, /zero rows/);
  });

  it('does not trigger when rows are present', () => {
    const [result] = evaluateAlarms([alarm], ROWS, emptyState());
    assert.equal(result.triggered, false);
  });
});

describe('evaluateAlarms — pct_change', () => {
  const alarm: AlarmDefinition = {
    name: 'revenue_drop',
    type: 'pct_change',
    metric: 'revenue',
    operator: '<',
    value: -20,
    compare_to: 'previous_run',
    severity: 'high',
  };

  function stateWith(previousRevenue: number): AlarmState {
    return {
      metric_history: [
        { run_date: '2026-01-01', parameters: {}, metrics: { revenue: previousRevenue }, alarms_triggered: [] },
      ],
      suppression: {},
    };
  }

  it('triggers when the drop exceeds the threshold', () => {
    // 400 vs 1000 is -60%, which is below -20.
    const [result] = evaluateAlarms([alarm], ROWS, stateWith(1000));
    assert.equal(result.triggered, true);
    assert.equal(result.previousValue, 1000);
    assert.equal(result.currentValue, 400);
    assert.ok(result.pctChange !== undefined && Math.abs(result.pctChange - -60) < 1e-9);
  });

  it('does not trigger on a small change', () => {
    // 400 vs 420 is about -4.8%.
    const [result] = evaluateAlarms([alarm], ROWS, stateWith(420));
    assert.equal(result.triggered, false);
  });

  it('skips the check on the first run, when no baseline exists', () => {
    const [result] = evaluateAlarms([alarm], ROWS, emptyState());
    assert.equal(result.triggered, false);
    assert.match(result.reason, /first run/);
  });

  it('treats a change from zero as an infinite increase rather than dividing by zero', () => {
    const [result] = evaluateAlarms([{ ...alarm, operator: '>', value: 0 }], ROWS, stateWith(0));
    assert.equal(result.triggered, true);
    assert.match(result.reason, /infinite change/);
    assert.ok(Number.isFinite(result.currentValue ?? NaN));
  });

  it('does not trigger when both runs are zero', () => {
    const zeroRows = [{ revenue: 0 }];
    const [result] = evaluateAlarms([alarm], zeroRows, stateWith(0));
    assert.equal(result.triggered, false);
  });

  it('uses the magnitude of a negative baseline, so direction is not inverted', () => {
    // -100 to 400 is a rise. Dividing by the signed baseline would report the
    // sign backwards and fire a "drop" alarm on a recovery.
    const [result] = evaluateAlarms([{ ...alarm, operator: '>', value: 0 }], ROWS, stateWith(-100));
    assert.equal(result.triggered, true);
    assert.ok((result.pctChange ?? 0) > 0, 'a rise from a negative baseline should be positive');
  });

  it('walks back to the most recent run that recorded the metric', () => {
    const state: AlarmState = {
      metric_history: [
        { run_date: '2026-01-01', parameters: {}, metrics: { revenue: 1000 }, alarms_triggered: [] },
        { run_date: '2026-01-02', parameters: {}, metrics: { other: 1 }, alarms_triggered: [] },
      ],
      suppression: {},
    };
    const [result] = evaluateAlarms([alarm], ROWS, state);
    assert.equal(result.previousValue, 1000);
  });
});

describe('evaluateAlarms — suppression', () => {
  const alarm: AlarmDefinition = {
    name: 'low_revenue',
    type: 'threshold',
    metric: 'revenue',
    operator: '<',
    value: 500,
    severity: 'high',
    cooldown: '24h',
  };

  function stateFiredAt(iso: string): AlarmState {
    return { metric_history: [], suppression: { low_revenue: { last_fired: iso, consecutive_fires: 1 } } };
  }

  it('suppresses a repeat firing inside the cooldown window', () => {
    const result = withFrozenTime('2026-01-10T12:00:00.000Z', () =>
      evaluateAlarms([alarm], ROWS, stateFiredAt('2026-01-10T06:00:00.000Z'))[0],
    );
    assert.equal(result.triggered, true, 'the condition still holds');
    assert.equal(result.suppressed, true, 'but notification is suppressed');
  });

  it('allows the firing once the cooldown has elapsed', () => {
    const result = withFrozenTime('2026-01-12T12:00:00.000Z', () =>
      evaluateAlarms([alarm], ROWS, stateFiredAt('2026-01-10T06:00:00.000Z'))[0],
    );
    assert.equal(result.triggered, true);
    assert.equal(result.suppressed, false);
  });

  it('never suppresses when cooldown is "0"', () => {
    const result = withFrozenTime('2026-01-10T07:00:00.000Z', () =>
      evaluateAlarms([{ ...alarm, cooldown: '0' }], ROWS, stateFiredAt('2026-01-10T06:00:00.000Z'))[0],
    );
    assert.equal(result.suppressed, false);
  });

  it('does not mark an untriggered alarm as suppressed', () => {
    const result = withFrozenTime('2026-01-10T07:00:00.000Z', () =>
      evaluateAlarms([{ ...alarm, value: 1 }], ROWS, stateFiredAt('2026-01-10T06:00:00.000Z'))[0],
    );
    assert.equal(result.triggered, false);
    assert.equal(result.suppressed, false);
  });
});

describe('evaluateAlarms — general', () => {
  it('returns one result per alarm, in order', () => {
    const alarms: AlarmDefinition[] = [
      { name: 'a', type: 'missing_data', severity: 'low' },
      { name: 'b', type: 'threshold', metric: 'revenue', operator: '<', value: 500, severity: 'high' },
    ];
    const results = evaluateAlarms(alarms, ROWS, emptyState());
    assert.equal(results.length, 2);
    assert.deepEqual(results.map((r) => r.alarm.name), ['a', 'b']);
  });

  it('returns an empty array when there are no alarms', () => {
    assert.deepEqual(evaluateAlarms([], ROWS, emptyState()), []);
  });

  it('reports an unknown alarm type without throwing', () => {
    const bogus = { name: 'x', type: 'wat', severity: 'low' } as unknown as AlarmDefinition;
    const [result] = evaluateAlarms([bogus], ROWS, emptyState());
    assert.equal(result.triggered, false);
    assert.match(result.reason, /Unknown alarm type/);
  });
});

describe('extractAlarmMetrics', () => {
  it('collects the aggregated value for each metric-bearing alarm', () => {
    const alarms: AlarmDefinition[] = [
      { name: 'a', type: 'threshold', metric: 'revenue', operator: '<', value: 1, severity: 'low' },
      { name: 'b', type: 'threshold', metric: 'orders', aggregate: 'max', operator: '<', value: 1, severity: 'low' },
    ];
    assert.deepEqual(extractAlarmMetrics(alarms, ROWS), { revenue: 400, orders: 9 });
  });

  it('ignores missing_data alarms, which have no metric', () => {
    const alarms: AlarmDefinition[] = [{ name: 'a', type: 'missing_data', severity: 'low' }];
    assert.deepEqual(extractAlarmMetrics(alarms, ROWS), {});
  });

  it('omits metrics that cannot be computed', () => {
    const alarms: AlarmDefinition[] = [
      { name: 'a', type: 'threshold', metric: 'nonexistent', operator: '<', value: 1, severity: 'low' },
    ];
    assert.deepEqual(extractAlarmMetrics(alarms, ROWS), {});
  });
});
