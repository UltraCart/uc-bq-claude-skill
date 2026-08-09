/**
 * Deterministic clock control for date-sensitive tests.
 *
 * Anything that answers "what is today" has to be tested against a fixed
 * instant, otherwise the test either passes vacuously (comparing the code's
 * output to the same expression that produced it) or fails at midnight.
 */

const RealDate = Date;

/**
 * Freeze `new Date()` and `Date.now()` at a fixed instant for the duration of
 * `fn`. Explicit constructor arguments still behave normally, so parsing dates
 * inside the callback works as usual.
 *
 * The `iso` string chooses the semantics, and the choice matters:
 *
 *   '2026-08-09T12:00:00'      — no offset, parsed as *local* time. Use this
 *                                when the assertion is about a calendar date,
 *                                so it holds in every timezone.
 *   '2026-08-09T12:00:00.000Z' — an absolute instant. Use this only when the
 *                                test is specifically about UTC/local skew;
 *                                the local date it maps to varies by host.
 *
 * Returns whatever `fn` returns; always restores the real clock, including
 * when `fn` throws.
 */
export function withFrozenTime<T>(iso: string, fn: () => T): T {
  const frozen = new RealDate(iso);

  // args is any[] rather than ConstructorParameters<typeof Date>: that helper
  // resolves to the last overload only (a 1-tuple), which would make both the
  // arity check and the multi-argument forwarding below fail to typecheck.
  class FrozenDate extends RealDate {
    constructor(...args: any[]) {
      if (args.length === 0) {
        super(frozen.getTime());
      } else {
        super(...(args as [number]));
      }
    }
    static now(): number {
      return frozen.getTime();
    }
  }

  (globalThis as { Date: DateConstructor }).Date = FrozenDate as unknown as DateConstructor;
  try {
    return fn();
  } finally {
    (globalThis as { Date: DateConstructor }).Date = RealDate;
  }
}

/**
 * Run `fn` with process.env.TZ set to `tz`.
 *
 * Node caches the timezone after first use, so changing TZ mid-process does
 * not reliably take effect. Tests that need real cross-timezone coverage
 * re-exec the runner under a different TZ instead (see npm run test:tz);
 * this helper is for assertions that only need TZ visible to application code.
 */
export function withTimeZone<T>(tz: string, fn: () => T): T {
  const previous = process.env.TZ;
  process.env.TZ = tz;
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
}
