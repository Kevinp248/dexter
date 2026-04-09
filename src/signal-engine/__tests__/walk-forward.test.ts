import {
  buildPurgedWalkForwardFolds,
  validatePurgedWalkForwardFolds,
} from '../validation/walk-forward.js';

function makeDates(count: number): string[] {
  return Array.from({ length: count }, (_, i) =>
    `2025-01-${String(i + 1).padStart(2, '0')}`,
  );
}

describe('walk-forward split policy', () => {
  test('builds purged folds with embargo spacing', () => {
    const dates = makeDates(60);
    const folds = buildPurgedWalkForwardFolds(dates, {
      initialTrainSize: 20,
      testSize: 5,
      stepSize: 5,
      purgeSize: 2,
      embargoSize: 3,
    });

    expect(folds.length).toBeGreaterThan(0);
    expect(folds[0].trainIndices[0]).toBe(0);
    expect(folds[0].trainIndices[folds[0].trainIndices.length - 1]).toBe(19);
    expect(folds[0].purgeIndices).toEqual([20, 21]);
    expect(folds[0].testIndices).toEqual([22, 23, 24, 25, 26]);
    expect(folds[0].embargoIndices).toEqual([27, 28, 29]);

    expect(folds[1].testIndices).toEqual([30, 31, 32, 33, 34]);
  });

  test('returns empty folds when not enough data', () => {
    const dates = makeDates(12);
    const folds = buildPurgedWalkForwardFolds(dates, {
      initialTrainSize: 10,
      testSize: 5,
      purgeSize: 2,
    });
    expect(folds).toEqual([]);
  });

  test('respects maxFolds cap', () => {
    const dates = makeDates(120);
    const folds = buildPurgedWalkForwardFolds(dates, {
      initialTrainSize: 30,
      testSize: 10,
      stepSize: 10,
      maxFolds: 2,
    });
    expect(folds).toHaveLength(2);
  });

  test('split validator reports valid folds for sane config', () => {
    const dates = makeDates(80);
    const folds = buildPurgedWalkForwardFolds(dates, {
      initialTrainSize: 25,
      testSize: 10,
      stepSize: 10,
      purgeSize: 2,
      embargoSize: 2,
    });

    const validation = validatePurgedWalkForwardFolds(folds);
    expect(validation.isValid).toBe(true);
    expect(validation.issues).toHaveLength(0);
  });

  test('throws on invalid config', () => {
    expect(() =>
      buildPurgedWalkForwardFolds(makeDates(100), {
        initialTrainSize: 20,
        testSize: 10,
        stepSize: 0,
      }),
    ).toThrow('stepSize must be a positive integer');
  });
});
