import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadAlarmState,
  saveAlarmState,
  recordAlarmRun,
  formatAlarmHistory,
  AlarmState,
} from '../../src/lib/alarm-state';
import { withTempDir, writeFile } from '../helpers/tmp';
import { withFrozenTime } from '../helpers/clock';

function emptyState(): AlarmState {
  return { metric_history: [], suppression: {} };
}

describe('loadAlarmState', () => {
  it('returns empty state when the file does not exist', () => {
    withTempDir((dir) => {
      assert.deepEqual(loadAlarmState(dir), emptyState());
    });
  });

  it('round-trips through saveAlarmState', () => {
    withTempDir((dir) => {
      const state: AlarmState = {
        metric_history: [{ run_date: '2026-01-01', parameters: { a: 1 }, metrics: { revenue: 100 }, alarms_triggered: ['x'] }],
        suppression: { x: { last_fired: '2026-01-01T00:00:00.000Z', consecutive_fires: 2 } },
      };
      saveAlarmState(dir, state);
      assert.deepEqual(loadAlarmState(dir), state);
    });
  });

  it('falls back to empty state on malformed JSON rather than throwing', () => {
    // A corrupt state file should not take down a scheduled report run.
    withTempDir((dir) => {
      writeFile(dir, 'alarm_state.json', '{ not valid json');
      assert.deepEqual(loadAlarmState(dir), emptyState());
    });
  });

  it('fills in missing top-level keys', () => {
    withTempDir((dir) => {
      writeFile(dir, 'alarm_state.json', JSON.stringify({ metric_history: [] }));
      const state = loadAlarmState(dir);
      assert.deepEqual(state.suppression, {});
    });
  });
});

describe('recordAlarmRun', () => {
  const FROZEN = '2026-03-15T10:00:00';

  it('appends a history entry stamped with the local date', () => {
    const state = emptyState();
    withFrozenTime(FROZEN, () => {
      recordAlarmRun(state, { start: '2026-03-01' }, { revenue: 500 }, [], []);
    });

    assert.equal(state.metric_history.length, 1);
    assert.equal(state.metric_history[0].run_date, '2026-03-15');
    assert.deepEqual(state.metric_history[0].metrics, { revenue: 500 });
    assert.deepEqual(state.metric_history[0].parameters, { start: '2026-03-01' });
  });

  it('records a suppression entry for a triggered alarm', () => {
    const state = emptyState();
    withFrozenTime(FROZEN, () => {
      recordAlarmRun(state, {}, { revenue: 1 }, ['low_rev'], []);
    });

    assert.ok(state.suppression.low_rev);
    assert.equal(state.suppression.low_rev.consecutive_fires, 1);
  });

  it('increments consecutive_fires across runs', () => {
    const state = emptyState();
    withFrozenTime(FROZEN, () => {
      recordAlarmRun(state, {}, {}, ['low_rev'], []);
      recordAlarmRun(state, {}, {}, ['low_rev'], []);
      recordAlarmRun(state, {}, {}, ['low_rev'], []);
    });
    assert.equal(state.suppression.low_rev.consecutive_fires, 3);
  });

  it('does not record suppression for an alarm that was itself suppressed', () => {
    const state = emptyState();
    withFrozenTime(FROZEN, () => {
      recordAlarmRun(state, {}, {}, ['low_rev'], ['low_rev']);
    });
    assert.equal(state.suppression.low_rev, undefined);
  });

  it('clears suppression once the condition stops triggering', () => {
    const state = emptyState();
    withFrozenTime(FROZEN, () => {
      recordAlarmRun(state, {}, {}, ['low_rev'], []);
      assert.ok(state.suppression.low_rev);
      recordAlarmRun(state, {}, {}, [], []);
    });
    assert.equal(state.suppression.low_rev, undefined);
  });

  it('prunes history to the most recent 30 entries', () => {
    const state = emptyState();
    withFrozenTime(FROZEN, () => {
      for (let i = 0; i < 35; i++) {
        recordAlarmRun(state, { i }, { revenue: i }, [], []);
      }
    });

    assert.equal(state.metric_history.length, 30);
    // The oldest five are the ones dropped.
    assert.equal(state.metric_history[0].metrics.revenue, 5);
    assert.equal(state.metric_history[29].metrics.revenue, 34);
  });

  it('records last_fired as a full UTC timestamp', () => {
    // This one stays UTC deliberately: it is an instant compared against
    // Date.now() for cooldown, not a calendar date shown to anyone.
    const state = emptyState();
    withFrozenTime(FROZEN, () => recordAlarmRun(state, {}, {}, ['a'], []));
    assert.match(state.suppression.a.last_fired, /^\d{4}-\d{2}-\d{2}T.*Z$/);
  });
});

describe('formatAlarmHistory', () => {
  it('reports when there is no history', () => {
    assert.match(formatAlarmHistory(emptyState()), /No alarm history/);
  });

  it('renders one line per run with metrics to two decimals', () => {
    const state: AlarmState = {
      metric_history: [
        { run_date: '2026-01-01', parameters: {}, metrics: { revenue: 100.456 }, alarms_triggered: [] },
        { run_date: '2026-01-02', parameters: {}, metrics: { revenue: 50 }, alarms_triggered: ['low_rev'] },
      ],
      suppression: {},
    };
    const output = formatAlarmHistory(state);
    const lines = output.split('\n');

    assert.equal(lines.length, 2);
    assert.match(lines[0], /2026-01-01/);
    assert.match(lines[0], /revenue=100\.46/);
    assert.doesNotMatch(lines[0], /ALARMS/);
    assert.match(lines[1], /ALARMS: low_rev/);
  });
});
