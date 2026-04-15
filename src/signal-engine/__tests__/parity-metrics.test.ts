import { describe, expect, test } from '@jest/globals';
import { buildParityMetricsReport } from '../validation/parity-metrics.js';
import { ForwardReturnLabel, ParityValidationReport, ParityValidationRow } from '../validation/parity-models.js';

function label(
  closeToCloseReturnPct: number | null,
  directionalReturnAfterCostsPct: number | null,
  assumption: ForwardReturnLabel['directionalAfterCostsAssumption'],
): ForwardReturnLabel {
  return {
    basis: 'close_to_close',
    closeToCloseReturnPct,
    directionalReturnPct: closeToCloseReturnPct,
    directionalReturnAfterCostsPct,
    directionalAfterCostsAssumption: assumption,
    isLabelAvailable: closeToCloseReturnPct !== null,
    isDirectionalAfterCostsLabelAvailable: directionalReturnAfterCostsPct !== null,
  };
}

function makeRow(
  overrides: Partial<ParityValidationRow> = {},
  labelOverrides?: {
    forward1d?: ForwardReturnLabel;
    forward5d?: ForwardReturnLabel;
    forward10d?: ForwardReturnLabel;
    forward20d?: ForwardReturnLabel;
  },
): ParityValidationRow {
  const baseForward = label(0.01, 0.01, 'buy_round_trip');
  return {
    asOfDate: '2026-01-02',
    ticker: 'AAPL',
    rawAction: 'BUY',
    finalAction: 'BUY',
    confidence: 70,
    aggregateScore: 0.6,
    riskScore: 0.2,
    technicalScore: 0.7,
    fundamentalsScore: 0.5,
    valuationScore: 0.4,
    sentimentScore: 0.3,
    earningsState: 'covered',
    earningsReasonCode: 'EARNINGS_COVERAGE_OK',
    earningsProvenance: {
      status: 'available',
      source: 'historical_provider_asof',
      asOfDateUsed: '2026-01-02',
      warning: null,
    },
    regimeState: 'risk_on',
    regimeReasonCode: 'REGIME_RISK_ON',
    regimeProvenance: {
      status: 'available',
      source: 'historical_provider_asof',
      asOfDateUsed: '2026-01-02',
      warning: null,
    },
    expectedEdgePreCostBps: 45,
    expectedEdgePostCostBps: 30,
    minEdgeThresholdBps: 20,
    roundTripCostBps: 15,
    costChangedAction: false,
    costAssumptionSource: 'default',
    costAssumptionVersion: 'v1',
    costAssumptionSnapshotId: 'snap-v1',
    dataCompletenessScore: 0.95,
    dataCompletenessStatus: 'pass',
    dataCompletenessMissingCritical: [],
    fallbackHadFallback: false,
    fallbackEventCount: 0,
    qualityGuardSuppressed: false,
    qualityGuardReason: null,
    qualityGuardFallbackRatio: 0,
    forward1d: labelOverrides?.forward1d ?? baseForward,
    forward5d: labelOverrides?.forward5d ?? baseForward,
    forward10d: labelOverrides?.forward10d ?? baseForward,
    forward20d: labelOverrides?.forward20d ?? baseForward,
    ...overrides,
  };
}

function makeReport(rows: ParityValidationRow[]): ParityValidationReport {
  return {
    generatedAt: '2026-02-01T00:00:00.000Z',
    config: {
      tickers: ['AAPL'],
      startDate: '2026-01-01',
      endDate: '2026-01-31',
      watchlistSliceSize: 25,
      apiDelayMs: 0,
    },
    summary: {
      rows: rows.length,
      tickers: 1,
      asOfDates: rows.length,
      rowsWithFallback: rows.filter((row) => row.fallbackHadFallback).length,
      rowsSuppressedByQualityGuard: rows.filter((row) => row.qualityGuardSuppressed).length,
      rowsWithUnavailableEarningsProvenance: rows.filter(
        (row) => row.earningsProvenance.status !== 'available',
      ).length,
      rowsWithUnavailableRegimeProvenance: rows.filter(
        (row) => row.regimeProvenance.status !== 'available',
      ).length,
    },
    rows,
    warnings: [],
  };
}

describe('parity metrics', () => {
  test('BUY directional metrics use close return minus costs', () => {
    const row = makeRow({
      finalAction: 'BUY',
      roundTripCostBps: 20,
    }, {
      forward1d: {
        ...label(0.02, 0.018, 'buy_round_trip'),
        directionalReturnPct: 0.02,
      },
    });
    const report = buildParityMetricsReport(makeReport([row]), {
      smallSampleWarningThreshold: 1,
    });
    const buy1d = report.returnsByActionAndHorizon.find(
      (item) => item.horizon === '1d' && item.finalAction === 'BUY',
    );
    expect(buy1d).toBeDefined();
    expect(buy1d!.directionalAfterCosts.count).toBe(1);
    expect(buy1d!.directionalAfterCosts.mean).toBeCloseTo(0.018, 8);
  });

  test('SELL directional metrics use inverted forward semantics with no fake shorting cost subtraction', () => {
    const row = makeRow(
      { finalAction: 'SELL', rawAction: 'SELL', confidence: 55, aggregateScore: -0.7 },
      {
        forward1d: {
          basis: 'close_to_close',
          closeToCloseReturnPct: -0.015,
          directionalReturnPct: 0.015,
          directionalReturnAfterCostsPct: 0.015,
          directionalAfterCostsAssumption: 'sell_zero_cost_avoidance',
          isLabelAvailable: true,
          isDirectionalAfterCostsLabelAvailable: true,
        },
      },
    );
    const report = buildParityMetricsReport(makeReport([row]), {
      smallSampleWarningThreshold: 1,
    });
    const sell1d = report.returnsByActionAndHorizon.find(
      (item) => item.horizon === '1d' && item.finalAction === 'SELL',
    );
    expect(sell1d).toBeDefined();
    expect(sell1d!.directionalAfterCosts.mean).toBeCloseTo(0.015, 8);
    expect(sell1d!.directionalAfterCosts.positiveHitRate).toBe(1);
  });

  test('HOLD rows are excluded from directional after-cost action-quality metrics', () => {
    const hold = makeRow(
      { finalAction: 'HOLD', rawAction: 'HOLD', confidence: 40, aggregateScore: 0.0 },
      {
        forward1d: {
          basis: 'close_to_close',
          closeToCloseReturnPct: 0.01,
          directionalReturnPct: null,
          directionalReturnAfterCostsPct: null,
          directionalAfterCostsAssumption: 'none',
          isLabelAvailable: true,
          isDirectionalAfterCostsLabelAvailable: false,
        },
      },
    );
    const report = buildParityMetricsReport(makeReport([hold]), {
      smallSampleWarningThreshold: 1,
    });
    const hold1d = report.returnsByActionAndHorizon.find(
      (item) => item.horizon === '1d' && item.finalAction === 'HOLD',
    );
    expect(hold1d).toBeDefined();
    expect(hold1d!.directionalAfterCosts.count).toBe(0);
    expect(hold1d!.directionalAfterCosts.mean).toBeNull();
    expect(hold1d!.directionalAfterCosts.positiveHitRate).toBeNull();
  });

  test('confidence buckets aggregate deterministically', () => {
    const rows = [
      makeRow({ confidence: 10 }),
      makeRow({ confidence: 35 }),
      makeRow({ confidence: 65 }),
      makeRow({ confidence: 90 }),
    ];
    const report = buildParityMetricsReport(makeReport(rows), {
      confidenceBuckets: [25, 50, 75],
      smallSampleWarningThreshold: 1,
    });
    expect(report.confidenceBucketCalibration.map((row) => row.bucket)).toEqual([
      '(-inf,25]',
      '(25,50]',
      '(50,75]',
      '(75,inf)',
    ]);
    expect(report.confidenceBucketCalibration.map((row) => row.rowCount)).toEqual([1, 1, 1, 1]);
  });

  test('unavailable labels are excluded correctly from directional availability', () => {
    const available = makeRow();
    const unavailable = makeRow(
      { finalAction: 'HOLD', rawAction: 'HOLD' },
      {
        forward1d: {
          basis: 'close_to_close',
          closeToCloseReturnPct: 0.02,
          directionalReturnPct: null,
          directionalReturnAfterCostsPct: null,
          directionalAfterCostsAssumption: 'none',
          isLabelAvailable: true,
          isDirectionalAfterCostsLabelAvailable: false,
        },
      },
    );
    const report = buildParityMetricsReport(makeReport([available, unavailable]), {
      smallSampleWarningThreshold: 1,
    });
    const availability = report.labelAvailabilityByHorizon.find((row) => row.horizon === '1d');
    expect(availability).toBeDefined();
    expect(availability!.totalRows).toBe(2);
    expect(availability!.directionalAfterCostsLabelCount).toBe(1);
    expect(availability!.directionalAfterCostsExcludedCount).toBe(1);
  });

  test('regime and data-quality attribution counts are included', () => {
    const rows = [
      makeRow({
        regimeState: 'risk_on',
        qualityGuardSuppressed: false,
        fallbackHadFallback: true,
        fallbackEventCount: 2,
      }),
      makeRow({
        ticker: 'MSFT',
        regimeState: 'regime_unknown',
        qualityGuardSuppressed: true,
        qualityGuardReason: 'NO_SIGNAL_DATA_GAP',
        dataCompletenessStatus: 'fail',
        dataCompletenessMissingCritical: ['technical.price_history'],
      }),
    ];
    const report = buildParityMetricsReport(makeReport(rows), {
      smallSampleWarningThreshold: 1,
    });
    const regimeUnknown1d = report.regimeAttribution.find(
      (row) => row.horizon === '1d' && row.regimeState === 'regime_unknown',
    );
    expect(regimeUnknown1d).toBeDefined();
    expect(regimeUnknown1d!.rowCount).toBe(1);
    expect(report.qualityAttribution.qualityGuardSuppressedCount).toBe(1);
    expect(report.qualityAttribution.rowsWithFallbackCount).toBe(1);
    expect(report.qualityAttribution.fallbackEventCountTotal).toBe(2);
    expect(report.qualityAttribution.dataCompletenessStatusCounts).toEqual(
      expect.arrayContaining([{ status: 'fail', count: 1 }]),
    );
  });

  test('empty and small datasets produce warnings without crashes', () => {
    const emptyReport = buildParityMetricsReport(makeReport([]), {
      smallSampleWarningThreshold: 5,
    });
    expect(emptyReport.warnings.some((warning) => warning.includes('No validation rows available'))).toBe(
      true,
    );

    const oneRowReport = buildParityMetricsReport(makeReport([makeRow()]), {
      smallSampleWarningThreshold: 5,
    });
    expect(oneRowReport.warnings.some((warning) => warning.includes('Small sample warning'))).toBe(true);
  });
});
