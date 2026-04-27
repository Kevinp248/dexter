export interface DateWindow {
  startDate: string;
  endDate: string;
}

export function mean(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function roundFinite(value: number | null, digits = 10): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

export function countBy<T extends string>(values: T[], allowedValues: readonly T[]): Record<T, number> {
  const counts = Object.fromEntries(allowedValues.map((value) => [value, 0])) as Record<T, number>;
  for (const value of values) counts[value] += 1;
  return counts;
}

export function assertPositiveNumber(value: number | undefined, label: string): void {
  if (value === undefined) return;
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid value for ${label}: ${value}. Expected a positive number.`);
  }
}

export function assertPositiveInteger(value: number | undefined, label: string): void {
  if (value === undefined) return;
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid value for ${label}: ${value}. Expected a positive integer.`);
  }
}

export function assertNonNegativeNumber(value: number | undefined, label: string): void {
  if (value === undefined) return;
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid value for ${label}: ${value}. Expected a non-negative number.`);
  }
}

export function assertNonNegativeInteger(value: number | undefined, label: string): void {
  if (value === undefined) return;
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Invalid value for ${label}: ${value}. Expected a non-negative integer.`);
  }
}

export function assertDateString(value: string, label: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Invalid date for ${label}: ${value}. Expected YYYY-MM-DD.`);
  }
}

export function validateDateWindow(window: DateWindow, label: string): void {
  assertDateString(window.startDate, `${label}.startDate`);
  assertDateString(window.endDate, `${label}.endDate`);
  if (window.startDate > window.endDate) {
    throw new Error(`Invalid ${label} window: startDate ${window.startDate} is after endDate ${window.endDate}.`);
  }
}

export function validateNonOverlappingWindows(
  research: DateWindow,
  holdout: DateWindow,
  label = 'holdout split',
): void {
  if (research.endDate >= holdout.startDate) {
    throw new Error(
      `Invalid ${label}: research endDate ${research.endDate} must be before holdout startDate ${holdout.startDate}.`,
    );
  }
}
