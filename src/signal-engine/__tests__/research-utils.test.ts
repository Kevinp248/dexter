import {
  assertDateString,
  assertNonNegativeInteger,
  assertNonNegativeNumber,
  assertPositiveInteger,
  assertPositiveNumber,
  countBy,
  mean,
  median,
  roundFinite,
  validateDateWindow,
  validateNonOverlappingWindows,
} from '../research/research-utils.js';

describe('research shared utilities', () => {
  test('mean, median, and roundFinite handle basic numeric inputs', () => {
    expect(mean([1, 2, 3])).toBe(2);
    expect(mean([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNull();
    expect(roundFinite(1 / 3, 4)).toBe(0.3333);
    expect(roundFinite(Number.NaN)).toBeNull();
    expect(roundFinite(null)).toBeNull();
  });

  test('countBy returns deterministic counts for allowed values', () => {
    expect(countBy(['weak', 'reject', 'weak'], ['reject', 'weak', 'research_candidate'] as const)).toEqual({
      reject: 1,
      weak: 2,
      research_candidate: 0,
    });
  });

  test('positive and non-negative validators reject invalid values clearly', () => {
    expect(() => assertPositiveNumber(0, 'initialCapital')).toThrow(
      'Invalid value for initialCapital: 0. Expected a positive number.',
    );
    expect(() => assertPositiveInteger(1.5, 'topN')).toThrow(
      'Invalid value for topN: 1.5. Expected a positive integer.',
    );
    expect(() => assertNonNegativeNumber(-1, 'costBps')).toThrow(
      'Invalid value for costBps: -1. Expected a non-negative number.',
    );
    expect(() => assertNonNegativeInteger(-1, 'minTradesForCandidate')).toThrow(
      'Invalid value for minTradesForCandidate: -1. Expected a non-negative integer.',
    );
    expect(() => assertPositiveNumber(undefined, 'initialCapital')).not.toThrow();
    expect(() => assertNonNegativeInteger(undefined, 'minTradesForCandidate')).not.toThrow();
  });

  test('date string validation rejects non-YYYY-MM-DD values', () => {
    expect(() => assertDateString('2026/04/24', 'holdout.endDate')).toThrow(
      'Invalid date for holdout.endDate: 2026/04/24. Expected YYYY-MM-DD.',
    );
    expect(() => assertDateString('2026-04-24', 'holdout.endDate')).not.toThrow();
  });

  test('date window validation rejects start dates after end dates', () => {
    expect(() => validateDateWindow({ startDate: '2025-01-01', endDate: '2024-12-31' }, 'research')).toThrow(
      'Invalid research window: startDate 2025-01-01 is after endDate 2024-12-31.',
    );
    expect(() => validateDateWindow({ startDate: '2024-12-31', endDate: '2024-12-31' }, 'research')).not.toThrow();
  });

  test('non-overlapping window validation rejects contaminated holdouts', () => {
    expect(() =>
      validateNonOverlappingWindows(
        { startDate: '2021-01-04', endDate: '2025-06-30' },
        { startDate: '2025-01-01', endDate: '2026-04-24' },
        'diagnostic split',
      ),
    ).toThrow('Invalid diagnostic split: research endDate 2025-06-30 must be before holdout startDate 2025-01-01.');

    expect(() =>
      validateNonOverlappingWindows(
        { startDate: '2021-01-04', endDate: '2024-12-31' },
        { startDate: '2025-01-01', endDate: '2026-04-24' },
      ),
    ).not.toThrow();
  });
});
