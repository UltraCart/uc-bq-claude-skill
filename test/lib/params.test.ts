import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveRelativeDate,
  isRelativeDateExpression,
  resolveParameters,
  ReportParameter,
} from '../../src/lib/params';
import { withFrozenTime } from '../helpers/clock';

/**
 * 2026-08-09 12:00 *local*.
 *
 * The missing "Z" is deliberate: an ISO string without an offset is parsed as
 * local time, so this is midday in whatever timezone the suite runs under, and
 * every expected date below holds in all of them. Writing "...Z" here would
 * pin an instant instead, which is already 2026-08-10 in UTC+12 and would make
 * these assertions fail in New Zealand for reasons unrelated to the code.
 */
const MIDDAY = '2026-08-09T12:00:00';

describe('resolveRelativeDate', () => {
  describe('day offsets', () => {
    it('resolves today', () => {
      withFrozenTime(MIDDAY, () => {
        assert.equal(resolveRelativeDate('today'), '2026-08-09');
      });
    });

    it('resolves yesterday', () => {
      withFrozenTime(MIDDAY, () => {
        assert.equal(resolveRelativeDate('yesterday'), '2026-08-08');
      });
    });

    it('resolves -Nd', () => {
      withFrozenTime(MIDDAY, () => {
        assert.equal(resolveRelativeDate('-1d'), '2026-08-08');
        assert.equal(resolveRelativeDate('-7d'), '2026-08-02');
        assert.equal(resolveRelativeDate('-90d'), '2026-05-11');
      });
    });

    it('crosses a month boundary going backwards', () => {
      withFrozenTime('2026-03-02T12:00:00', () => {
        assert.equal(resolveRelativeDate('-5d'), '2026-02-25');
      });
    });

    it('crosses a year boundary going backwards', () => {
      withFrozenTime('2026-01-03T12:00:00', () => {
        assert.equal(resolveRelativeDate('-10d'), '2025-12-24');
      });
    });
  });

  describe('week, month, year offsets', () => {
    it('resolves -Nw', () => {
      withFrozenTime(MIDDAY, () => {
        assert.equal(resolveRelativeDate('-1w'), '2026-08-02');
        assert.equal(resolveRelativeDate('-4w'), '2026-07-12');
      });
    });

    it('resolves -Nm', () => {
      withFrozenTime(MIDDAY, () => {
        assert.equal(resolveRelativeDate('-1m'), '2026-07-09');
        assert.equal(resolveRelativeDate('-12m'), '2025-08-09');
      });
    });

    it('resolves -Ny', () => {
      withFrozenTime(MIDDAY, () => {
        assert.equal(resolveRelativeDate('-1y'), '2025-08-09');
      });
    });
  });

  describe('calendar anchors', () => {
    // These were the timezone bug. Building `new Date(y, m, 1)` produces local
    // midnight, which is still the previous day in UTC — so serializing with
    // toISOString() returned the last day of the *prior* period anywhere east
    // of UTC. Asserting the exact calendar date catches any regression.
    it('resolves start_of_month to the first of the month', () => {
      withFrozenTime(MIDDAY, () => {
        assert.equal(resolveRelativeDate('start_of_month'), '2026-08-01');
      });
    });

    it('resolves start_of_year to January 1st', () => {
      withFrozenTime(MIDDAY, () => {
        assert.equal(resolveRelativeDate('start_of_year'), '2026-01-01');
      });
    });

    it('resolves start_of_quarter to the first day of the quarter', () => {
      withFrozenTime(MIDDAY, () => {
        assert.equal(resolveRelativeDate('start_of_quarter'), '2026-07-01');
      });
      withFrozenTime('2026-02-14T12:00:00', () => {
        assert.equal(resolveRelativeDate('start_of_quarter'), '2026-01-01');
      });
      withFrozenTime('2026-11-20T12:00:00', () => {
        assert.equal(resolveRelativeDate('start_of_quarter'), '2026-10-01');
      });
    });

    it('resolves start_of_week to Sunday', () => {
      // 2026-08-09 is itself a Sunday.
      withFrozenTime(MIDDAY, () => {
        assert.equal(resolveRelativeDate('start_of_week'), '2026-08-09');
      });
      // 2026-08-12 is a Wednesday; its week starts Sunday the 9th.
      withFrozenTime('2026-08-12T12:00:00', () => {
        assert.equal(resolveRelativeDate('start_of_week'), '2026-08-09');
      });
    });

    it('resolves end_of_last_month to the final day of the prior month', () => {
      withFrozenTime(MIDDAY, () => {
        assert.equal(resolveRelativeDate('end_of_last_month'), '2026-07-31');
      });
      // March, so the prior month is February in a non-leap year.
      withFrozenTime('2026-03-15T12:00:00', () => {
        assert.equal(resolveRelativeDate('end_of_last_month'), '2026-02-28');
      });
      // Leap year.
      withFrozenTime('2028-03-15T12:00:00', () => {
        assert.equal(resolveRelativeDate('end_of_last_month'), '2028-02-29');
      });
    });

    it('resolves end_of_last_quarter', () => {
      withFrozenTime(MIDDAY, () => {
        assert.equal(resolveRelativeDate('end_of_last_quarter'), '2026-06-30');
      });
    });

    it('resolves end_of_last_year to December 31st', () => {
      withFrozenTime(MIDDAY, () => {
        assert.equal(resolveRelativeDate('end_of_last_year'), '2025-12-31');
      });
    });

    it('resolves start_of_last_month', () => {
      withFrozenTime(MIDDAY, () => {
        assert.equal(resolveRelativeDate('start_of_last_month'), '2026-07-01');
      });
      // January, so the prior month is in the previous year.
      withFrozenTime('2026-01-15T12:00:00', () => {
        assert.equal(resolveRelativeDate('start_of_last_month'), '2025-12-01');
      });
    });

    it('resolves start_of_last_quarter', () => {
      withFrozenTime(MIDDAY, () => {
        assert.equal(resolveRelativeDate('start_of_last_quarter'), '2026-04-01');
      });
    });

    it('resolves start_of_last_year', () => {
      withFrozenTime(MIDDAY, () => {
        assert.equal(resolveRelativeDate('start_of_last_year'), '2025-01-01');
      });
    });
  });

  describe('non-relative input', () => {
    it('passes through an explicit ISO date unchanged', () => {
      withFrozenTime(MIDDAY, () => {
        assert.equal(resolveRelativeDate('2025-06-15'), '2025-06-15');
      });
    });

    it('passes through unrecognized expressions unchanged', () => {
      withFrozenTime(MIDDAY, () => {
        assert.equal(resolveRelativeDate('not-a-date'), 'not-a-date');
        assert.equal(resolveRelativeDate(''), '');
        // Malformed offsets are not silently reinterpreted.
        assert.equal(resolveRelativeDate('-5x'), '-5x');
        assert.equal(resolveRelativeDate('+5d'), '+5d');
      });
    });
  });

  it('never returns a date outside the current day for "today"', () => {
    // Property-style guard across every hour of a day, in whatever timezone
    // the suite runs under. Catches UTC/local drift at any offset.
    for (let hour = 0; hour < 24; hour++) {
      const iso = `2026-08-09T${String(hour).padStart(2, '0')}:00:00.000Z`;
      withFrozenTime(iso, () => {
        const now = new Date();
        const expected = [
          now.getFullYear(),
          String(now.getMonth() + 1).padStart(2, '0'),
          String(now.getDate()).padStart(2, '0'),
        ].join('-');
        assert.equal(
          resolveRelativeDate('today'),
          expected,
          `"today" drifted from the local calendar date at ${iso}`,
        );
      });
    }
  });
});

describe('isRelativeDateExpression', () => {
  it('recognizes relative expressions', () => {
    for (const expr of [
      'today', 'yesterday', '-1d', '-90d', '-2w', '-3m', '-1y',
      'start_of_week', 'start_of_month', 'start_of_quarter', 'start_of_year',
      'end_of_last_month', 'end_of_last_quarter', 'end_of_last_year',
    ]) {
      assert.equal(isRelativeDateExpression(expr), true, `${expr} should be relative`);
    }
  });

  it('rejects static dates and junk', () => {
    for (const expr of ['2025-06-15', '', 'tomorrow', '5d', '-5x', 'monthly']) {
      assert.equal(isRelativeDateExpression(expr), false, `${expr} should not be relative`);
    }
  });

  it('tolerates surrounding whitespace', () => {
    assert.equal(isRelativeDateExpression('  today  '), true);
  });

  it('does not throw on non-string input', () => {
    assert.equal(isRelativeDateExpression(undefined as unknown as string), false);
    assert.equal(isRelativeDateExpression(null as unknown as string), false);
    assert.equal(isRelativeDateExpression(42 as unknown as string), false);
  });
});

describe('resolveParameters', () => {
  const dateParam: ReportParameter = {
    name: 'start_date',
    type: 'date',
    label: 'Start date',
    description: 'Beginning of range',
    required: true,
    default: '-30d',
  };

  const stringParam: ReportParameter = {
    name: 'channel',
    type: 'string',
    label: 'Channel',
    description: 'Sales channel',
    required: false,
    default: 'web',
  };

  it('prefers CLI overrides over manifest defaults and param defaults', async () => {
    const result = await withFrozenTime(MIDDAY, () =>
      resolveParameters([stringParam], { channel: 'retail' }, { channel: 'wholesale' }),
    );
    assert.equal(result.channel, 'retail');
  });

  it('prefers manifest defaults over param defaults', async () => {
    const result = await withFrozenTime(MIDDAY, () =>
      resolveParameters([stringParam], {}, { channel: 'wholesale' }),
    );
    assert.equal(result.channel, 'wholesale');
  });

  it('falls back to the param default', async () => {
    const result = await withFrozenTime(MIDDAY, () => resolveParameters([stringParam], {}, {}));
    assert.equal(result.channel, 'web');
  });

  it('resolves relative dates for date-typed params', async () => {
    const result = await withFrozenTime(MIDDAY, () => resolveParameters([dateParam], {}, {}));
    assert.equal(result.start_date, '2026-07-10');
  });

  it('resolves relative dates supplied via CLI override', async () => {
    const result = await withFrozenTime(MIDDAY, () =>
      resolveParameters([dateParam], { start_date: 'start_of_year' }, {}),
    );
    assert.equal(result.start_date, '2026-01-01');
  });

  it('leaves non-date params untouched even if they look relative', async () => {
    const looksRelative: ReportParameter = { ...stringParam, default: 'today' };
    const result = await withFrozenTime(MIDDAY, () => resolveParameters([looksRelative], {}, {}));
    assert.equal(result.channel, 'today');
  });

  it('omits optional params with no value rather than emitting undefined', async () => {
    const optional: ReportParameter = {
      name: 'segment',
      type: 'string',
      label: 'Segment',
      description: 'Optional segment',
      required: false,
    };
    const result = await withFrozenTime(MIDDAY, () => resolveParameters([optional], {}, {}));
    assert.ok(!('segment' in result), 'optional param with no value should be absent');
  });

  it('coerces non-string defaults to strings', async () => {
    const numeric: ReportParameter = {
      name: 'limit',
      type: 'number',
      label: 'Limit',
      description: 'Row limit',
      required: false,
      default: 100,
    };
    const result = await withFrozenTime(MIDDAY, () => resolveParameters([numeric], {}, {}));
    assert.equal(result.limit, '100');
    assert.equal(typeof result.limit, 'string');
  });
});
