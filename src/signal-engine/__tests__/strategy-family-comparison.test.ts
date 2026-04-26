import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  bestRowByBenchmarkRelativeReturn,
  bestRowBySharpe,
  buildStrategyFamilyComparisonReport,
  expandStrategyFamilyGrid,
  familyVerdictForRows,
  validateStrategyFamilyComparisonConfig,
  type StrategyFamilyComparisonRow,
} from '../research/strategy-family-comparison.js';
import { buildProfitBacktestReport, type ProfitStrategyConfig } from '../research/profit-backtest.js';
import { PriceFeatureLabelArtifact, PriceFeatureLabelRow } from '../research/price-feature-labels.js';

function makeDate(offset: number): string {
  const d = new Date('2026-01-01T00:00:00.000Z');
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

function makeRow(ticker: string, index: number, price: number, feature = index): PriceFeatureLabelRow {
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
    range_pct: feature,
    ret_1d: feature,
    ret_5d: feature,
    ret_20d: feature,
    sma_20_gap: feature,
    sma_50_gap: feature,
    vol_20d: feature,
    drawdown_252d: feature,
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
      included: [
        'ret_1d',
        'ret_5d',
        'ret_20d',
        'sma_20_gap',
        'sma_50_gap',
        'vol_20d',
        'drawdown_252d',
        'range_pct',
      ],
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
        return {
          ticker,
          rowCount: tickerRows.length,
          firstDate: tickerRows[0]?.date ?? null,
          lastDate: tickerRows[tickerRows.length - 1]?.date ?? null,
        };
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

function comparisonRow(overrides: Partial<StrategyFamilyComparisonRow> = {}): StrategyFamilyComparisonRow {
  return {
    familyId: 'family_a',
    feature: 'ret_20d',
    rankDirection: 'descending',
    holdDays: 20,
    topN: 2,
    costBps: 0,
    rebalanceFrequency: 'weekly',
    profitVerdict: 'reject',
    totalReturn: 0,
    CAGR: 0,
    Sharpe: 0,
    maxDrawdown: -0.2,
    Calmar: 0,
    numberOfTrades: 20,
    turnover: 1,
    winRate: 0.5,
    benchmarkRelativeReturn: 0,
    benchmarkRelativeMaxDrawdown: 0,
    ...overrides,
  };
}

describe('research strategy family comparison', () => {
  test('strategy family grid expands expected 54 rows', () => {
    const grid = expandStrategyFamilyGrid();
    expect(grid).toHaveLength(54);
  });

  test('descending rank direction selects higher feature values first', () => {
    const rows: PriceFeatureLabelRow[] = [];
    for (let i = 0; i < 4; i += 1) {
      rows.push(makeRow('HIGH', i, [100, 110, 120, 130][i], 10));
      rows.push(makeRow('LOW', i, [100, 90, 80, 70][i], -10));
    }

    const strategy: ProfitStrategyConfig = {
      id: 'descending_ret_20d_test',
      feature: 'ret_20d',
      rankDirection: 'descending',
      holdDays: 1,
      rebalanceFrequency: 'daily',
      topN: 1,
      maxPositions: 1,
    };
    const report = buildProfitBacktestReport(makeArtifact(rows), {
      initialCapital: 10_000,
      costBps: 0,
      minTradesForCandidate: 1,
      strategies: [strategy],
    });

    expect(report.strategies[0].trades[0].ticker).toBe('HIGH');
  });

  test('unsupported or invalid config rejects clearly', () => {
    expect(() => validateStrategyFamilyComparisonConfig({ topNs: [0] })).toThrow(
      'Invalid value for topNs: 0. Expected a positive integer.',
    );
    expect(() => validateStrategyFamilyComparisonConfig({ costBpsValues: [-1] })).toThrow(
      'Invalid value for costBpsValues: -1. Expected a non-negative number.',
    );
    expect(() =>
      validateStrategyFamilyComparisonConfig({
        families: [
          {
            familyId: 'bad_direction',
            feature: 'ret_20d',
            rankDirection: 'sideways',
            holdDays: 20,
            rebalanceFrequency: 'weekly',
          },
        ] as unknown as NonNullable<Parameters<typeof validateStrategyFamilyComparisonConfig>[0]['families']>,
      }),
    ).toThrow('Invalid rankDirection for bad_direction: sideways.');
  });

  test('family verdict works for candidate, fragile, and reject fixtures', () => {
    expect(
      familyVerdictForRows([
        comparisonRow({ profitVerdict: 'research_candidate', costBps: 0, benchmarkRelativeReturn: 0.1 }),
        comparisonRow({ profitVerdict: 'research_candidate', costBps: 10, benchmarkRelativeReturn: 0.2 }),
      ]),
    ).toBe('family_research_candidate');

    expect(
      familyVerdictForRows([
        comparisonRow({ profitVerdict: 'research_candidate', costBps: 0, benchmarkRelativeReturn: 0.1 }),
        comparisonRow({ profitVerdict: 'reject', costBps: 10, benchmarkRelativeReturn: -0.2 }),
      ]),
    ).toBe('family_fragile');

    expect(
      familyVerdictForRows([
        comparisonRow({ profitVerdict: 'reject', benchmarkRelativeReturn: -0.2 }),
        comparisonRow({ profitVerdict: 'reject', benchmarkRelativeReturn: -0.1 }),
      ]),
    ).toBe('family_reject');
  });

  test('best-row selection is deterministic', () => {
    const rows = [
      comparisonRow({ familyId: 'family_b', Sharpe: 1, benchmarkRelativeReturn: 0.3 }),
      comparisonRow({ familyId: 'family_a', Sharpe: 1, benchmarkRelativeReturn: 0.3 }),
    ];

    expect(bestRowBySharpe(rows)?.familyId).toBe('family_a');
    expect(bestRowByBenchmarkRelativeReturn(rows)?.familyId).toBe('family_a');
  });

  test('builds a 54-row comparison report from a fixture artifact', () => {
    const rows: PriceFeatureLabelRow[] = [];
    for (let i = 0; i < 35; i += 1) {
      rows.push(makeRow('AAPL', i, 100 + i, i));
      rows.push(makeRow('MSFT', i, 100 + i * 0.5, i + 1));
      rows.push(makeRow('NVDA', i, 100 + i * 1.5, i + 2));
      rows.push(makeRow('JPM', i, 100 - i * 0.1, i + 3));
      rows.push(makeRow('XOM', i, 100 + i * 0.2, i + 4));
      rows.push(makeRow('PG', i, 100 + i * 0.3, i + 5));
    }

    const report = buildStrategyFamilyComparisonReport(makeArtifact(rows), {
      minTradesForCandidate: 1,
    });

    expect(report.rows).toHaveLength(54);
    expect(report.summary.totalRows).toBe(54);
    expect(report.summary.familySummary).toHaveLength(6);
    expect(report.summary.countByFamily.sma20_gap_reversion).toBe(9);
  });

  test('production signal entrypoints do not import strategy family comparison module', async () => {
    const indexSource = await readFile(path.join(process.cwd(), 'src', 'signal-engine', 'index.ts'), 'utf8');
    const dailyScanSource = await readFile(
      path.join(process.cwd(), 'src', 'signal-engine', 'daily-scan.ts'),
      'utf8',
    );

    expect(indexSource).not.toContain('signal-engine/research/strategy-family-comparison');
    expect(indexSource).not.toContain('./research/strategy-family-comparison');
    expect(dailyScanSource).not.toContain('signal-engine/research/strategy-family-comparison');
    expect(dailyScanSource).not.toContain('./research/strategy-family-comparison');
  });
});
