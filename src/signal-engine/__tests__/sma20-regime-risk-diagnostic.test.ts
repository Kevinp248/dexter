import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  breadthAboveSma20,
  breadthBucket,
  buildSma20RegimeRiskDiagnosticReport,
  marketTrendBucket,
  pullbackSeverityBucket,
  sectorForTicker,
  trailingEqualWeightReturn20d,
  validateSma20RegimeRiskDiagnosticConfig,
  volatilityBucket,
} from '../research/sma20-regime-risk-diagnostic.js';
import { PriceFeatureLabelArtifact, PriceFeatureLabelRow } from '../research/price-feature-labels.js';

function makeDate(offset: number): string {
  const d = new Date('2026-01-01T00:00:00.000Z');
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

function makeRow(ticker: string, index: number, price: number, gap = 0.01): PriceFeatureLabelRow {
  return {
    ticker,
    date: makeDate(index),
    close: price,
    adjustedClose: price,
    priceUsed: price,
    priceSource: 'adjusted_close',
    open: price,
    high: price,
    low: price,
    volume: 1_000_000,
    range_pct: 0,
    ret_1d: 0,
    ret_5d: 0,
    ret_20d: 0,
    sma_20_gap: gap,
    sma_50_gap: gap,
    vol_20d: Math.abs(gap),
    drawdown_252d: gap,
    fwd_ret_1d: null,
    fwd_ret_5d: null,
    fwd_ret_10d: null,
    fwd_ret_20d: null,
    fwd_ret_after_cost_1d: null,
    fwd_ret_after_cost_5d: null,
    fwd_ret_after_cost_10d: null,
    fwd_ret_after_cost_20d: null,
    label_available_1d: false,
    label_available_5d: false,
    label_available_10d: false,
    label_available_20d: false,
  };
}

function makeArtifact(rows: PriceFeatureLabelRow[]): PriceFeatureLabelArtifact {
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date) || a.ticker.localeCompare(b.ticker));
  const tickers = Array.from(new Set(sorted.map((row) => row.ticker))).sort((a, b) => a.localeCompare(b));
  return {
    lane: 'research_only',
    datasetType: 'price_features_and_forward_labels',
    schemaVersion: 'price_feature_label_v1',
    vendor: 'yahoo',
    generatedAt: '2026-04-26T00:00:00.000Z',
    sourceArtifactPath: '/tmp/source.json',
    sourceArtifactProvenance: {
      generatedAt: '2026-04-26T00:00:00.000Z',
      assembledAt: '2026-04-26T00:00:00.000Z',
      sourceFetchedAt: '2026-04-26T00:00:00.000Z',
      sourceFetchedAtMin: '2026-04-26T00:00:00.000Z',
      sourceFetchedAtMax: '2026-04-26T00:00:00.000Z',
    },
    priceBasis: {
      requested: 'adjusted_close_if_available_else_close',
      applied: 'adjusted_close_if_available_else_close',
      notes: ['test fixture'],
    },
    labelBasis: 'selected_price_to_selected_price',
    labelCostAssumption: {
      roundTripCostBps: 10,
      roundTripCostDecimal: 0.001,
      notes: ['test fixture'],
    },
    features: {
      included: ['ret_1d', 'ret_5d', 'ret_20d', 'sma_20_gap', 'sma_50_gap', 'vol_20d', 'drawdown_252d', 'range_pct'],
    },
    labels: {
      included: [
        'fwd_ret_1d',
        'fwd_ret_5d',
        'fwd_ret_10d',
        'fwd_ret_20d',
        'fwd_ret_after_cost_1d',
        'fwd_ret_after_cost_5d',
        'fwd_ret_after_cost_10d',
        'fwd_ret_after_cost_20d',
        'label_available_1d',
        'label_available_5d',
        'label_available_10d',
        'label_available_20d',
      ],
    },
    summary: {
      rowCount: sorted.length,
      firstDate: sorted[0]?.date ?? null,
      lastDate: sorted[sorted.length - 1]?.date ?? null,
      tickers,
      tickerCoverage: tickers.map((ticker) => {
        const tickerRows = sorted.filter((row) => row.ticker === ticker);
        return { ticker, rowCount: tickerRows.length, firstDate: tickerRows[0]?.date ?? null, lastDate: tickerRows[tickerRows.length - 1]?.date ?? null };
      }),
      usableLabelCounts: { '1d': 0, '5d': 0, '10d': 0, '20d': 0 },
      nullFeatureCounts: {
        ret_1d: 0,
        ret_5d: 0,
        ret_20d: 0,
        sma_20_gap: 0,
        sma_50_gap: 0,
        vol_20d: 0,
        drawdown_252d: 0,
        range_pct: 0,
      },
    },
    warnings: [],
    rows: sorted,
  };
}

describe('research SMA20 regime/risk diagnostic', () => {
  test('regime bucket assignment works', () => {
    expect(marketTrendBucket(0.03)).toBe('market_up_20d');
    expect(marketTrendBucket(0)).toBe('market_flat_20d');
    expect(marketTrendBucket(-0.03)).toBe('market_down_20d');
    expect(volatilityBucket(0.1, { low: 0.2, high: 0.5 })).toBe('low_vol');
    expect(volatilityBucket(0.7, { low: 0.2, high: 0.5 })).toBe('high_vol');
    expect(pullbackSeverityBucket(-0.12)).toBe('deep_pullback');
  });

  test('breadth calculation works', () => {
    const rows = [makeRow('AAPL', 0, 100, 0.1), makeRow('MSFT', 0, 100, -0.1), makeRow('JPM', 0, 100, 0.2)];
    expect(breadthAboveSma20(rows)).toBe(2 / 3);
    expect(breadthBucket(0.2)).toBe('weak_breadth');
    expect(breadthBucket(0.5)).toBe('neutral_breadth');
    expect(breadthBucket(0.8)).toBe('strong_breadth');
  });

  test('trailing market return proxy works', () => {
    const dates = Array.from({ length: 21 }, (_, index) => makeDate(index));
    const tickerDateRows = new Map<string, Map<string, PriceFeatureLabelRow>>();
    const aapl = new Map<string, PriceFeatureLabelRow>();
    const msft = new Map<string, PriceFeatureLabelRow>();
    for (let i = 0; i < 21; i += 1) {
      aapl.set(dates[i], makeRow('AAPL', i, i === 0 ? 100 : 110));
      msft.set(dates[i], makeRow('MSFT', i, i === 0 ? 200 : 220));
    }
    tickerDateRows.set('AAPL', aapl);
    tickerDateRows.set('MSFT', msft);
    expect(trailingEqualWeightReturn20d({ dates, tickerDateRows }, dates[20])).toBeCloseTo(0.1);
  });

  test('ticker/sector mapping works', () => {
    expect(sectorForTicker('NVDA')).toBe('tech_growth');
    expect(sectorForTicker('JPM')).toBe('financials');
    expect(sectorForTicker('ZZZ')).toBe('other');
  });

  test('diagnostic report builds and returns verdict/recommendation', () => {
    const rows: PriceFeatureLabelRow[] = [];
    for (let i = 0; i < 70; i += 1) {
      rows.push(makeRow('AAPL', i, 100 + i, -0.05));
      rows.push(makeRow('MSFT', i, 100 + i * 0.5, -0.04));
      rows.push(makeRow('JPM', i, 100 - i * 0.1, 0.02));
      rows.push(makeRow('XOM', i, 100 + i * 0.2, 0.01));
    }
    const report = buildSma20RegimeRiskDiagnosticReport(makeArtifact(rows), {
      focusConfigs: [{ topN: 2, costBps: 0 }],
      researchWindow: { startDate: makeDate(0), endDate: makeDate(40) },
      holdoutWindow: { startDate: makeDate(41), endDate: makeDate(69) },
      minTradesForCandidate: 1,
    });
    expect(report.configResults).toHaveLength(1);
    expect(['regime_filter_promising', 'risk_filter_needed', 'no_clear_filter_stop_sma20']).toContain(report.finalDiagnosticVerdict);
  });

  test('invalid topN is rejected', () => {
    expect(() => validateSma20RegimeRiskDiagnosticConfig({ focusConfigs: [{ topN: 0, costBps: 0 }] })).toThrow(
      'Invalid value for focusConfigs.topN: 0. Expected a positive integer.',
    );
  });

  test('invalid negative costBps is rejected', () => {
    expect(() => validateSma20RegimeRiskDiagnosticConfig({ focusConfigs: [{ topN: 2, costBps: -1 }] })).toThrow(
      'Invalid value for focusConfigs.costBps: -1. Expected a non-negative number.',
    );
  });

  test('empty focusConfigs is rejected', () => {
    expect(() => validateSma20RegimeRiskDiagnosticConfig({ focusConfigs: [] })).toThrow(
      'Invalid focusConfigs: expected at least one focus config.',
    );
  });

  test('invalid and overlapping research and holdout windows are rejected', () => {
    expect(() =>
      validateSma20RegimeRiskDiagnosticConfig({
        researchWindow: { startDate: '2025-01-01', endDate: '2024-12-31' },
      }),
    ).toThrow('Invalid research window: startDate 2025-01-01 is after endDate 2024-12-31.');

    expect(() =>
      validateSma20RegimeRiskDiagnosticConfig({
        researchWindow: { startDate: '2021-01-04', endDate: '2025-06-30' },
        holdoutWindow: { startDate: '2025-01-01', endDate: '2026-04-24' },
      }),
    ).toThrow('Invalid diagnostic split: research endDate 2025-06-30 must be before holdout startDate 2025-01-01.');
  });

  test('default config remains valid', () => {
    expect(() => validateSma20RegimeRiskDiagnosticConfig({})).not.toThrow();
  });

  test('valid custom config remains valid', () => {
    expect(() =>
      validateSma20RegimeRiskDiagnosticConfig({
        initialCapital: 50_000,
        minTradesForCandidate: 0,
        focusConfigs: [{ topN: 3, costBps: 5 }],
        researchWindow: { startDate: '2021-01-04', endDate: '2024-12-31' },
        holdoutWindow: { startDate: '2025-01-01', endDate: '2026-04-24' },
      }),
    ).not.toThrow();
  });

  test('production signal entrypoints do not import diagnostic module', async () => {
    const indexSource = await readFile(path.join(process.cwd(), 'src', 'signal-engine', 'index.ts'), 'utf8');
    const dailyScanSource = await readFile(path.join(process.cwd(), 'src', 'signal-engine', 'daily-scan.ts'), 'utf8');

    expect(indexSource).not.toContain('signal-engine/research/sma20-regime-risk-diagnostic');
    expect(indexSource).not.toContain('./research/sma20-regime-risk-diagnostic');
    expect(dailyScanSource).not.toContain('signal-engine/research/sma20-regime-risk-diagnostic');
    expect(dailyScanSource).not.toContain('./research/sma20-regime-risk-diagnostic');
  });
});
