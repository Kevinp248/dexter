import { describe, expect, test, jest } from '@jest/globals';
import {
  DEFAULT_MANIFEST_PATH,
  loadUniverseManifest,
  runParityWalkForwardValidation,
} from '../validation/parity-walk-forward.js';
import { parseArgs } from '../validation/parity-walk-forward.cli.js';
import { ParityMetricsReport } from '../validation/parity-metrics.js';
import { ParityValidationReport } from '../validation/parity-models.js';

function makeDates(start: string, days: number): string[] {
  const out: string[] = [];
  const cursor = new Date(`${start}T00:00:00.000Z`);
  for (let i = 0; i < days; i += 1) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

function mockValidationReport(
  startDate: string,
  endDate: string,
  rows: number,
  warnings: string[] = [],
): ParityValidationReport {
  return {
    generatedAt: '2026-04-01T00:00:00.000Z',
    config: {
      tickers: ['AAPL', 'MSFT'],
      startDate,
      endDate,
      watchlistSliceSize: 25,
      apiDelayMs: 0,
    },
    summary: {
      rows,
      tickers: 2,
      asOfDates: rows,
      rowsWithFallback: 0,
      rowsSuppressedByQualityGuard: 0,
      rowsWithUnavailableEarningsProvenance: 0,
      rowsWithUnavailableRegimeProvenance: 0,
    },
    rows: [],
    warnings,
  };
}

function mockMetricsReport(sourceRows: number, warnings: string[] = []): ParityMetricsReport {
  return {
    generatedAt: '2026-04-01T00:00:00.000Z',
    sourceGeneratedAt: '2026-04-01T00:00:00.000Z',
    sourceRows,
    sourceWarningsCount: 0,
    notes: [],
    config: {
      smallSampleWarningThreshold: 20,
      confidenceBuckets: [20, 40, 60, 80],
      aggregateScoreBuckets: [-0.6, -0.2, 0.2, 0.6],
    },
    rowCountsByFinalAction: [],
    labelAvailabilityByHorizon: [],
    returnsByActionAndHorizon: [],
    confidenceBucketCalibration: [],
    aggregateScoreBucketCalibration: [],
    regimeAttribution: [],
    sectorAttribution: {
      available: false,
      deferredReason: 'Sector attribution deferred',
      rowsBySector: [],
    },
    qualityAttribution: {
      qualityGuardSuppressedCount: 0,
      qualityGuardReasonCounts: [],
      rowsWithFallbackCount: 0,
      fallbackEventCountTotal: 0,
      dataCompletenessStatusCounts: [],
      missingCriticalFieldCounts: [],
    },
    warnings,
  };
}

describe('parity walk-forward orchestration', () => {
  test('fixed universe manifest loads and validates', async () => {
    const manifest = await loadUniverseManifest(DEFAULT_MANIFEST_PATH);
    expect(manifest.name).toBe('liquid-us-ca-sample');
    expect(manifest.tickers.length).toBeGreaterThanOrEqual(20);
    expect(manifest.tickers.length).toBeLessThanOrEqual(40);
    expect(new Set(manifest.tickers.map((item) => item.ticker)).size).toBe(manifest.tickers.length);
  });

  test('folds do not overlap and respect purge/embargo boundaries', async () => {
    const orderedDates = makeDates('2026-01-01', 20);
    const report = await runParityWalkForwardValidation(
      {
        startDate: orderedDates[0],
        endDate: orderedDates[orderedDates.length - 1],
        walkForward: {
          initialTrainSize: 6,
          testSize: 3,
          stepSize: 3,
          purgeSize: 1,
          embargoSize: 1,
        },
      },
      {
        loadManifestFn: async () => ({
          name: 'test',
          tickers: [{ ticker: 'AAPL' }, { ticker: 'MSFT' }],
        }),
        orderedDatesFn: () => orderedDates,
        buildParityValidationReportFn: async (cfg) =>
          mockValidationReport(cfg?.startDate ?? orderedDates[0], cfg?.endDate ?? orderedDates[0], 2),
        buildParityMetricsReportFn: () => mockMetricsReport(2),
      },
    );

    expect(report.walkForward.folds.length).toBeGreaterThan(0);
    expect(report.universe.effectiveTickers).toEqual(['AAPL', 'MSFT']);
    expect(report.universe.effectiveTickerCount).toBe(2);
    for (let i = 0; i < report.walkForward.folds.length; i += 1) {
      const fold = report.walkForward.folds[i];
      expect(fold.trainEndDate < fold.testStartDate).toBe(true);
      if (fold.purgeDates.length) {
        expect(fold.purgeDates[fold.purgeDates.length - 1] < fold.testStartDate).toBe(true);
      }
      if (i > 0) {
        const prev = report.walkForward.folds[i - 1];
        expect(prev.testEndDate < fold.testStartDate).toBe(true);
      }
    }
  });

  test('CLI parses ticker override and config uses subset tickers', async () => {
    const parsed = parseArgs([
      '--tickers',
      'aapl,MSFT,aapl,Nvda',
      '--start',
      '2026-01-01',
      '--end',
      '2026-01-20',
      '--initial-train-size',
      '6',
      '--test-size',
      '3',
    ]);
    expect(parsed.tickers).toEqual(['AAPL', 'MSFT', 'AAPL', 'NVDA']);

    const orderedDates = makeDates('2026-01-01', 20);
    const validationTickers: string[][] = [];
    await runParityWalkForwardValidation(
      {
        startDate: '2026-01-01',
        endDate: '2026-01-20',
        tickers: ['aapl', 'MSFT', 'AAPL'],
        walkForward: {
          initialTrainSize: 6,
          testSize: 3,
          stepSize: 3,
          purgeSize: 1,
          embargoSize: 1,
        },
      },
      {
        loadManifestFn: async () => ({
          name: 'test',
          tickers: [{ ticker: 'AAPL' }, { ticker: 'MSFT' }, { ticker: 'NVDA' }],
        }),
        orderedDatesFn: () => orderedDates,
        buildParityValidationReportFn: async (cfg) => {
          validationTickers.push([...(cfg?.tickers ?? [])]);
          return mockValidationReport(cfg?.startDate ?? '2026-01-01', cfg?.endDate ?? '2026-01-01', 1);
        },
        buildParityMetricsReportFn: () => mockMetricsReport(1),
      },
    );

    expect(validationTickers.length).toBeGreaterThan(0);
    expect(validationTickers.every((tickers) => tickers.join(',') === 'AAPL,MSFT')).toBe(true);
  });

  test('unknown ticker outside manifest throws clear error', async () => {
    await expect(
      runParityWalkForwardValidation(
        {
          startDate: '2026-01-01',
          endDate: '2026-01-20',
          tickers: ['AAPL', 'TSLA'],
          walkForward: {
            initialTrainSize: 6,
            testSize: 3,
            stepSize: 3,
            purgeSize: 1,
            embargoSize: 1,
          },
        },
        {
          loadManifestFn: async () => ({
            name: 'test',
            tickers: [{ ticker: 'AAPL' }, { ticker: 'MSFT' }],
          }),
        },
      ),
    ).rejects.toThrow('Ticker override includes tickers not present in manifest: TSLA.');
  });

  test('holdout rows are separate from walk-forward fold evaluations', async () => {
    const validationCalls: Array<{ startDate: string; endDate: string }> = [];
    const metricsCalls: number[] = [];
    const orderedDates = makeDates('2026-01-01', 25);

    const report = await runParityWalkForwardValidation(
      {
        startDate: '2026-01-01',
        endDate: '2026-01-25',
        holdoutStartDate: '2026-02-01',
        holdoutEndDate: '2026-02-10',
        walkForward: {
          initialTrainSize: 8,
          testSize: 4,
          stepSize: 4,
          purgeSize: 1,
          embargoSize: 1,
        },
      },
      {
        loadManifestFn: async () => ({
          name: 'test',
          tickers: [{ ticker: 'AAPL' }],
        }),
        orderedDatesFn: () => orderedDates,
        buildParityValidationReportFn: async (cfg) => {
          const startDate = cfg?.startDate ?? '2026-01-01';
          const endDate = cfg?.endDate ?? startDate;
          validationCalls.push({ startDate, endDate });
          return mockValidationReport(startDate, endDate, 3);
        },
        buildParityMetricsReportFn: (validation) => {
          metricsCalls.push(validation.summary.rows);
          return mockMetricsReport(validation.summary.rows);
        },
      },
    );

    expect(report.holdout).not.toBeNull();
    expect(report.holdout?.startDate).toBe('2026-02-01');
    expect(report.holdout?.endDate).toBe('2026-02-10');
    expect(report.walkForward.foldEvaluations.length).toBe(report.walkForward.folds.length);
    expect(validationCalls.length).toBe(report.walkForward.folds.length + 1);
    expect(metricsCalls.length).toBe(report.walkForward.folds.length + 1);
  });

  test('holdout behavior remains unchanged with ticker override', async () => {
    const orderedDates = makeDates('2026-01-01', 25);
    const validationCalls: Array<{ startDate: string; endDate: string; tickers: string[] }> = [];
    const report = await runParityWalkForwardValidation(
      {
        startDate: '2026-01-01',
        endDate: '2026-01-25',
        holdoutStartDate: '2026-02-01',
        holdoutEndDate: '2026-02-10',
        tickers: ['msft'],
        walkForward: {
          initialTrainSize: 8,
          testSize: 4,
          stepSize: 4,
          purgeSize: 1,
          embargoSize: 1,
        },
      },
      {
        loadManifestFn: async () => ({
          name: 'test',
          tickers: [{ ticker: 'AAPL' }, { ticker: 'MSFT' }],
        }),
        orderedDatesFn: () => orderedDates,
        buildParityValidationReportFn: async (cfg) => {
          validationCalls.push({
            startDate: cfg?.startDate ?? '',
            endDate: cfg?.endDate ?? '',
            tickers: [...(cfg?.tickers ?? [])],
          });
          return mockValidationReport(cfg?.startDate ?? '2026-01-01', cfg?.endDate ?? '2026-01-01', 1);
        },
        buildParityMetricsReportFn: () => mockMetricsReport(1),
      },
    );

    expect(report.holdout).not.toBeNull();
    expect(validationCalls.length).toBe(report.walkForward.folds.length + 1);
    expect(validationCalls.every((call) => call.tickers.join(',') === 'MSFT')).toBe(true);
  });

  test('valid holdout window after walk-forward range is accepted', async () => {
    const orderedDates = makeDates('2026-01-01', 20);
    const report = await runParityWalkForwardValidation(
      {
        startDate: '2026-01-01',
        endDate: '2026-01-20',
        holdoutStartDate: '2026-01-21',
        holdoutEndDate: '2026-01-25',
        walkForward: {
          initialTrainSize: 6,
          testSize: 3,
          stepSize: 3,
          purgeSize: 1,
          embargoSize: 1,
        },
      },
      {
        loadManifestFn: async () => ({ name: 'test', tickers: [{ ticker: 'AAPL' }] }),
        orderedDatesFn: () => orderedDates,
        buildParityValidationReportFn: async (cfg) =>
          mockValidationReport(cfg?.startDate ?? '2026-01-01', cfg?.endDate ?? '2026-01-01', 1),
        buildParityMetricsReportFn: () => mockMetricsReport(1),
      },
    );

    expect(report.holdout).not.toBeNull();
    expect(report.holdout?.startDate).toBe('2026-01-21');
    expect(report.holdout?.endDate).toBe('2026-01-25');
  });

  test('missing one side of holdout dates throws validation error', async () => {
    await expect(
      runParityWalkForwardValidation(
        {
          startDate: '2026-01-01',
          endDate: '2026-01-20',
          holdoutStartDate: '2026-01-21',
          walkForward: {
            initialTrainSize: 6,
            testSize: 3,
            stepSize: 3,
            purgeSize: 1,
            embargoSize: 1,
          },
        },
        {
          loadManifestFn: async () => ({ name: 'test', tickers: [{ ticker: 'AAPL' }] }),
          orderedDatesFn: () => makeDates('2026-01-01', 20),
        },
      ),
    ).rejects.toThrow('Holdout window requires both holdoutStartDate and holdoutEndDate.');
  });

  test('holdout overlapping walk-forward window throws validation error', async () => {
    await expect(
      runParityWalkForwardValidation(
        {
          startDate: '2026-01-01',
          endDate: '2026-01-20',
          holdoutStartDate: '2026-01-20',
          holdoutEndDate: '2026-01-25',
          walkForward: {
            initialTrainSize: 6,
            testSize: 3,
            stepSize: 3,
            purgeSize: 1,
            embargoSize: 1,
          },
        },
        {
          loadManifestFn: async () => ({ name: 'test', tickers: [{ ticker: 'AAPL' }] }),
          orderedDatesFn: () => makeDates('2026-01-01', 20),
        },
      ),
    ).rejects.toThrow('must be after walk-forward endDate');
  });

  test('holdout start after holdout end throws validation error', async () => {
    await expect(
      runParityWalkForwardValidation(
        {
          startDate: '2026-01-01',
          endDate: '2026-01-20',
          holdoutStartDate: '2026-02-01',
          holdoutEndDate: '2026-01-25',
          walkForward: {
            initialTrainSize: 6,
            testSize: 3,
            stepSize: 3,
            purgeSize: 1,
            embargoSize: 1,
          },
        },
        {
          loadManifestFn: async () => ({ name: 'test', tickers: [{ ticker: 'AAPL' }] }),
          orderedDatesFn: () => makeDates('2026-01-01', 20),
        },
      ),
    ).rejects.toThrow('must be <= holdoutEndDate');
  });

  test('metrics are called per fold and no production scan path is invoked directly by orchestrator', async () => {
    const orderedDates = makeDates('2026-01-01', 16);
    const buildParityValidationReportFn = jest.fn(async (cfg?: { startDate?: string; endDate?: string }) =>
      mockValidationReport(cfg?.startDate ?? '2026-01-01', cfg?.endDate ?? '2026-01-01', 1),
    );
    const buildParityMetricsReportFn = jest.fn(() => mockMetricsReport(1));

    const report = await runParityWalkForwardValidation(
      {
        startDate: '2026-01-01',
        endDate: '2026-01-16',
        walkForward: {
          initialTrainSize: 5,
          testSize: 3,
          stepSize: 3,
          purgeSize: 1,
          embargoSize: 1,
        },
      },
      {
        loadManifestFn: async () => ({ name: 'test', tickers: [{ ticker: 'AAPL' }] }),
        orderedDatesFn: () => orderedDates,
        buildParityValidationReportFn: buildParityValidationReportFn as any,
        buildParityMetricsReportFn: buildParityMetricsReportFn as any,
      },
    );

    expect(report.walkForward.folds.length).toBeGreaterThan(0);
    expect(buildParityValidationReportFn).toHaveBeenCalledTimes(report.walkForward.folds.length);
    expect(buildParityMetricsReportFn).toHaveBeenCalledTimes(report.walkForward.folds.length);
  });

  test('empty and small datasets emit warnings and do not crash', async () => {
    const orderedDates = makeDates('2026-01-01', 12);
    const report = await runParityWalkForwardValidation(
      {
        startDate: '2026-01-01',
        endDate: '2026-01-12',
        walkForward: {
          initialTrainSize: 4,
          testSize: 3,
          stepSize: 3,
          purgeSize: 1,
          embargoSize: 1,
        },
      },
      {
        loadManifestFn: async () => ({ name: 'test', tickers: [{ ticker: 'AAPL' }] }),
        orderedDatesFn: () => orderedDates,
        buildParityValidationReportFn: async (cfg) =>
          mockValidationReport(
            cfg?.startDate ?? '2026-01-01',
            cfg?.endDate ?? '2026-01-01',
            0,
            ['validation empty'],
          ),
        buildParityMetricsReportFn: () => mockMetricsReport(0, ['metrics empty']),
      },
    );

    expect(report.walkForward.foldEvaluations.length).toBeGreaterThan(0);
    expect(report.warnings.some((warning) => warning.includes('survivorship'))).toBe(true);
    expect(report.warnings.some((warning) => warning.includes('validation empty'))).toBe(true);
    expect(report.warnings.some((warning) => warning.includes('metrics empty'))).toBe(true);
  });
});
