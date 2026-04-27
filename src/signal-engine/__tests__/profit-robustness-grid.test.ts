import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  buildProfitRobustnessGridReport,
  expandProfitRobustnessGrid,
  robustnessVerdictForRows,
  type ProfitRobustnessGridRow,
} from '../research/profit-robustness-grid.js';
import { PriceFeatureLabelArtifact, PriceFeatureLabelRow } from '../research/price-feature-labels.js';

function makeDate(offset: number): string {
  const d = new Date('2024-01-01T00:00:00.000Z');
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

function makeRow(ticker: string, index: number, price: number, sma20Gap: number): PriceFeatureLabelRow {
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
    sma_20_gap: sma20Gap,
    sma_50_gap: 0,
    vol_20d: 0,
    drawdown_252d: 0,
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

function makeArtifact(): PriceFeatureLabelArtifact {
  const rows: PriceFeatureLabelRow[] = [];
  for (let i = 0; i < 80; i += 1) {
    rows.push(makeRow('AAPL', i, 100 + i * 0.8, i % 11 === 0 ? -0.1 : 0.1));
    rows.push(makeRow('MSFT', i, 100 + i * 0.4, i % 13 === 0 ? -0.2 : 0.2));
  }
  const sorted = rows.sort((a, b) => a.date.localeCompare(b.date) || a.ticker.localeCompare(b.ticker));
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
      firstDate: sorted[0].date,
      lastDate: sorted[sorted.length - 1].date,
      tickers: ['AAPL', 'MSFT'],
      tickerCoverage: [
        { ticker: 'AAPL', rowCount: 80, firstDate: sorted[0].date, lastDate: sorted[sorted.length - 1].date },
        { ticker: 'MSFT', rowCount: 80, firstDate: sorted[0].date, lastDate: sorted[sorted.length - 1].date },
      ],
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

function gridRow(overrides: Partial<ProfitRobustnessGridRow>): ProfitRobustnessGridRow {
  return {
    strategyId: 'sma20_gap_reversion',
    holdDays: 20,
    topN: 2,
    costBps: 10,
    rebalanceFrequency: 'weekly',
    totalReturn: 0.2,
    CAGR: 0.1,
    Sharpe: 1,
    maxDrawdown: -0.1,
    Calmar: 1,
    numberOfTrades: 20,
    turnover: 10,
    winRate: 0.6,
    benchmarkRelativeReturn: 0.1,
    benchmarkRelativeMaxDrawdown: 0,
    profitVerdict: 'research_candidate',
    ...overrides,
  };
}

describe('profit robustness grid', () => {
  test('expands expected parameter combinations deterministically', () => {
    const rows = expandProfitRobustnessGrid({
      holdDays: [5, 10],
      topNs: [1, 2],
      costBps: [0, 10],
      rebalanceFrequencies: ['daily', 'weekly'],
    });

    expect(rows).toHaveLength(16);
    expect(rows[0]).toEqual({ holdDays: 5, topN: 1, costBps: 0, rebalanceFrequency: 'daily' });
    expect(rows[15]).toEqual({ holdDays: 10, topN: 2, costBps: 10, rebalanceFrequency: 'weekly' });
  });

  test('best-row selection is deterministic for the same artifact and config', () => {
    const config = {
      holdDays: [5, 10],
      topNs: [1, 2],
      costBps: [0, 10],
      rebalanceFrequencies: ['weekly' as const],
      minTradesForCandidate: 0,
    };
    const a = buildProfitRobustnessGridReport(makeArtifact(), config);
    const b = buildProfitRobustnessGridReport(makeArtifact(), config);

    expect(a.summary.bestRowBySharpe).toEqual(b.summary.bestRowBySharpe);
    expect(a.summary.bestRowByBenchmarkRelativeReturn).toEqual(b.summary.bestRowByBenchmarkRelativeReturn);
  });

  test('robustness verdict works for robust, fragile, and reject fixtures', () => {
    const robustRows = [
      gridRow({ topN: 2, costBps: 25, Sharpe: 2 }),
      gridRow({ topN: 3, costBps: 50 }),
      gridRow({ topN: 1, profitVerdict: 'reject' }),
      gridRow({ topN: 4, profitVerdict: 'weak' }),
    ];
    const fragileRows = [
      gridRow({ topN: 1, costBps: 10 }),
      gridRow({ topN: 2, profitVerdict: 'reject' }),
      gridRow({ topN: 3, profitVerdict: 'weak' }),
      gridRow({ topN: 4, profitVerdict: 'reject' }),
    ];
    const rejectRows = [gridRow({ profitVerdict: 'reject' }), gridRow({ profitVerdict: 'weak' })];

    expect(robustnessVerdictForRows(robustRows)).toBe('robust_candidate');
    expect(robustnessVerdictForRows(fragileRows)).toBe('fragile_candidate');
    expect(robustnessVerdictForRows(rejectRows)).toBe('reject_candidate');
  });

  test('positive high-cost rows do not satisfy robustness unless they are research candidates', () => {
    const rows = [
      gridRow({ topN: 2, costBps: 0, Sharpe: 2 }),
      gridRow({ topN: 3, costBps: 10 }),
      gridRow({ topN: 2, costBps: 25, totalReturn: 0.4, profitVerdict: 'weak' }),
      gridRow({ topN: 4, costBps: 50, totalReturn: 0.2, profitVerdict: 'weak' }),
    ];

    expect(robustnessVerdictForRows(rows)).toBe('fragile_candidate');
  });

  test('rejects invalid grid config clearly', () => {
    expect(() => expandProfitRobustnessGrid({ holdDays: [0] })).toThrow(
      'Invalid grid config for holdDays: 0. Expected positive integers.',
    );
    expect(() => expandProfitRobustnessGrid({ topNs: [1.5] })).toThrow(
      'Invalid grid config for topNs: 1.5. Expected positive integers.',
    );
    expect(() => expandProfitRobustnessGrid({ costBps: [-1] })).toThrow(
      'Invalid grid config for costBps: -1. Expected non-negative numbers.',
    );
  });

  test('production signal entrypoints do not import robustness grid module', async () => {
    const indexSource = await readFile(path.join(process.cwd(), 'src', 'signal-engine', 'index.ts'), 'utf8');
    const dailyScanSource = await readFile(
      path.join(process.cwd(), 'src', 'signal-engine', 'daily-scan.ts'),
      'utf8',
    );

    expect(indexSource).not.toContain('signal-engine/research/profit-robustness-grid');
    expect(indexSource).not.toContain('./research/profit-robustness-grid');
    expect(dailyScanSource).not.toContain('signal-engine/research/profit-robustness-grid');
    expect(dailyScanSource).not.toContain('./research/profit-robustness-grid');
  });
});
