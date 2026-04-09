export interface WalkForwardConfig {
  initialTrainSize: number;
  testSize: number;
  stepSize?: number;
  purgeSize?: number;
  embargoSize?: number;
  maxFolds?: number;
}

export interface WalkForwardFold {
  fold: number;
  trainIndices: number[];
  purgeIndices: number[];
  testIndices: number[];
  embargoIndices: number[];
  trainDates: string[];
  testDates: string[];
}

export interface WalkForwardValidationResult {
  isValid: boolean;
  issues: string[];
}

function buildIndexRange(start: number, end: number): number[] {
  if (end < start) return [];
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

function ensurePositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
}

function ensureNonNegativeInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
}

function validateConfig(config: WalkForwardConfig): Required<WalkForwardConfig> {
  const resolved: Required<WalkForwardConfig> = {
    initialTrainSize: config.initialTrainSize,
    testSize: config.testSize,
    stepSize: config.stepSize ?? config.testSize,
    purgeSize: config.purgeSize ?? 0,
    embargoSize: config.embargoSize ?? 0,
    maxFolds: config.maxFolds ?? Number.MAX_SAFE_INTEGER,
  };

  ensurePositiveInteger(resolved.initialTrainSize, 'initialTrainSize');
  ensurePositiveInteger(resolved.testSize, 'testSize');
  ensurePositiveInteger(resolved.stepSize, 'stepSize');
  ensureNonNegativeInteger(resolved.purgeSize, 'purgeSize');
  ensureNonNegativeInteger(resolved.embargoSize, 'embargoSize');
  ensurePositiveInteger(resolved.maxFolds, 'maxFolds');

  return resolved;
}

export function buildPurgedWalkForwardFolds(
  orderedDates: string[],
  config: WalkForwardConfig,
): WalkForwardFold[] {
  const {
    initialTrainSize,
    testSize,
    stepSize,
    purgeSize,
    embargoSize,
    maxFolds,
  } = validateConfig(config);

  if (orderedDates.length < initialTrainSize + purgeSize + testSize) {
    return [];
  }

  const folds: WalkForwardFold[] = [];
  const lastIndex = orderedDates.length - 1;
  let foldNumber = 1;
  let testStart = initialTrainSize + purgeSize;
  let minimumNextTestStart = testStart;

  while (
    testStart + testSize - 1 <= lastIndex &&
    foldNumber <= maxFolds
  ) {
    if (testStart < minimumNextTestStart) {
      testStart = minimumNextTestStart;
      continue;
    }

    const trainEnd = testStart - purgeSize - 1;
    if (trainEnd < 0) break;

    const testEnd = testStart + testSize - 1;
    const purgeStart = Math.max(0, trainEnd + 1);
    const purgeEnd = testStart - 1;
    const embargoStart = testEnd + 1;
    const embargoEnd = Math.min(lastIndex, testEnd + embargoSize);

    const trainIndices = buildIndexRange(0, trainEnd);
    const testIndices = buildIndexRange(testStart, testEnd);
    const purgeIndices = buildIndexRange(purgeStart, purgeEnd);
    const embargoIndices = buildIndexRange(embargoStart, embargoEnd);

    folds.push({
      fold: foldNumber,
      trainIndices,
      purgeIndices,
      testIndices,
      embargoIndices,
      trainDates: trainIndices.map((index) => orderedDates[index]),
      testDates: testIndices.map((index) => orderedDates[index]),
    });

    foldNumber += 1;
    minimumNextTestStart = testEnd + embargoSize + 1;
    testStart += stepSize;
  }

  return folds;
}

export function validatePurgedWalkForwardFolds(
  folds: WalkForwardFold[],
): WalkForwardValidationResult {
  const issues: string[] = [];
  let previousTestEnd = -1;

  for (const fold of folds) {
    const trainEnd = fold.trainIndices[fold.trainIndices.length - 1] ?? -1;
    const testStart = fold.testIndices[0] ?? -1;
    const testEnd = fold.testIndices[fold.testIndices.length - 1] ?? -1;

    if (trainEnd >= testStart && testStart >= 0) {
      issues.push(`Fold ${fold.fold}: train/test overlap detected`);
    }
    if (fold.purgeIndices.length && fold.purgeIndices[0] <= trainEnd) {
      issues.push(`Fold ${fold.fold}: purge starts before training ends`);
    }
    if (fold.purgeIndices.length && testStart >= 0) {
      const purgeEnd = fold.purgeIndices[fold.purgeIndices.length - 1];
      if (purgeEnd >= testStart) {
        issues.push(`Fold ${fold.fold}: purge overlaps test window`);
      }
    }
    if (previousTestEnd >= testStart && testStart >= 0) {
      issues.push(`Fold ${fold.fold}: test windows overlap previous fold`);
    }
    if (fold.testIndices.length === 0) {
      issues.push(`Fold ${fold.fold}: empty test window`);
    }

    previousTestEnd = testEnd;
  }

  return {
    isValid: issues.length === 0,
    issues,
  };
}
