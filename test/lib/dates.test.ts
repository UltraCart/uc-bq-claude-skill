import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatLocalDate, todayLocal } from '../../src/lib/dates';
import { withFrozenTime } from '../helpers/clock';

describe('formatLocalDate', () => {
  it('formats using local calendar fields, not UTC', () => {
    // 2026-08-09T23:30 local. If this were serialized via toISOString() in any
    // timezone west of UTC, the UTC date would already have rolled over.
    const d = new Date(2026, 7, 9, 23, 30, 0);
    assert.equal(formatLocalDate(d), '2026-08-09');
  });

  it('zero-pads single-digit months and days', () => {
    assert.equal(formatLocalDate(new Date(2026, 0, 5)), '2026-01-05');
    assert.equal(formatLocalDate(new Date(2026, 8, 1)), '2026-09-01');
  });

  it('handles the first and last instant of a day', () => {
    assert.equal(formatLocalDate(new Date(2026, 2, 14, 0, 0, 0, 0)), '2026-03-14');
    assert.equal(formatLocalDate(new Date(2026, 2, 14, 23, 59, 59, 999)), '2026-03-14');
  });

  it('handles leap day', () => {
    assert.equal(formatLocalDate(new Date(2028, 1, 29)), '2028-02-29');
  });
});

describe('todayLocal', () => {
  it('returns the local calendar date, not the UTC one', () => {
    // Regression guard for the original defect. 01:30 UTC on Aug 10 is 21:30
    // on Aug 9 in New York, so the old toISOString() implementation returned
    // 2026-08-10 — every report generated during US evening hours was stamped
    // with tomorrow's date.
    const instant = '2026-08-10T01:30:00.000Z';
    const result = withFrozenTime(instant, () => todayLocal());

    // Expected value is derived from the Date's own local fields rather than
    // from formatLocalDate, so this asserts against the platform rather than
    // against the function under test.
    const d = new Date(instant);
    const expected =
      `${d.getFullYear()}-` +
      `${String(d.getMonth() + 1).padStart(2, '0')}-` +
      `${String(d.getDate()).padStart(2, '0')}`;
    assert.equal(result, expected);

    // And the concrete case, when the suite is pinned to US Eastern.
    if (process.env.TZ === 'America/New_York') {
      assert.equal(result, '2026-08-09');
    }
  });

  it('tracks the local date across every hour of a UTC day', () => {
    // Sweeps all 24 hours so the UTC/local boundary is crossed regardless of
    // the host offset. A UTC-based implementation fails this at some hour in
    // every timezone except UTC itself.
    for (let hour = 0; hour < 24; hour++) {
      const instant = `2026-08-09T${String(hour).padStart(2, '0')}:00:00.000Z`;
      const d = new Date(instant);
      const expected =
        `${d.getFullYear()}-` +
        `${String(d.getMonth() + 1).padStart(2, '0')}-` +
        `${String(d.getDate()).padStart(2, '0')}`;
      assert.equal(
        withFrozenTime(instant, () => todayLocal()),
        expected,
        `todayLocal drifted from the local calendar date at ${instant}`,
      );
    }
  });
});
