import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  buildProfitBacktestReport,
  computeProfitMetrics,
  maxDrawdownFromEquity,
  type ProfitStrategyConfig,
} from '../research/profit-backtest.js';
import { parseProfitBacktestCliArgs } from '../research/profit-backtest.cli.js';
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

function singleRetStrategy(holdDays = 1): ProfitStrategyConfig {
  return {
    id: 'ret_1d_reversal_5d',
    feature: 'ret_1d',
    rankDirection: 'ascending',
    holdDays,
    rebalanceFrequency: 'daily',
    topN: 1,
    maxPositions: 1,
  };
}

describe('research profit backtest', () => {
  test('uses next available trading day for entry instead of signal day', () => {
    const rows: PriceFeatureLabelRow[] = [];
    for (let i = 0; i < 4; i += 1) {
      rows.push(makeRow('AAPL', i, [100, 110, 121, 130][i], i === 0 ? -10 : 10));
      rows.push(makeRow('MSFT', i, [50, 50, 50, 50][i], 20));
    }

    const report = buildProfitBacktestReport(makeArtifact(rows), {
      initialCapital: 10_000,
      costBps: 0,
      strategies: [singleRetStrategy(1)],
      minTradesForCandidate: 1,
    });

    const trade = report.strategies[0].trades[0];
    expect(trade.signalDate).toBe(makeDate(0));
    expect(trade.entryDate).toBe(makeDate(1));
    expect(trade.entryPrice).toBe(110);
  });

  test('cost bps reduces trade and total returns', () => {
    const rows: PriceFeatureLabelRow[] = [];
    for (let i = 0; i < 4; i += 1) {
      rows.push(makeRow('AAPL', i, [100, 100, 110, 110][i], i === 0 ? -1 : 1));
    }
    const artifact = makeArtifact(rows);

    const noCost = buildProfitBacktestReport(artifact, {
      initialCapital: 10_000,
      costBps: 0,
      strategies: [singleRetStrategy(1)],
      minTradesForCandidate: 1,
    });
    const withCost = buildProfitBacktestReport(artifact, {
      initialCapital: 10_000,
      costBps: 50,
      strategies: [singleRetStrategy(1)],
      minTradesForCandidate: 1,
    });

    expect(withCost.strategies[0].trades[0].netReturn).toBeLessThan(noCost.strategies[0].trades[0].netReturn);
    expect(withCost.strategies[0].metrics.totalReturn).toBeLessThan(noCost.strategies[0].metrics.totalReturn);
  });

  test('equal-weight buy-and-hold benchmark computes deterministically', () => {
    const rows: PriceFeatureLabelRow[] = [];
    for (let i = 0; i < 3; i += 1) {
      rows.push(makeRow('AAPL', i, [100, 105, 110][i]));
      rows.push(makeRow('MSFT', i, [200, 210, 220][i]));
    }

    const report = buildProfitBacktestReport(makeArtifact(rows), {
      initialCapital: 100_000,
      costBps: 0,
      strategies: [],
    });

    const benchmark = report.baselines.find((item) => item.id === 'equal_weight_buy_hold');
    expect(benchmark?.metrics.totalReturn).toBe(0.1);
    expect(benchmark?.metrics.numberOfTrades).toBe(2);
  });

  test('max drawdown math uses peak-to-trough equity loss', () => {
    expect(maxDrawdownFromEquity([100, 120, 90, 150])).toBe(-0.25);
  });

  test('CAGR and Sharpe have sane signs for a rising equity curve', () => {
    const metrics = computeProfitMetrics(
      [
        { date: '2026-01-01', equity: 100, exposure: 1 },
        { date: '2026-01-02', equity: 101, exposure: 1 },
        { date: '2026-01-03', equity: 102, exposure: 1 },
        { date: '2026-01-04', equity: 103, exposure: 1 },
      ],
      [],
      100,
    );

    expect(metrics.totalReturn).toBeGreaterThan(0);
    expect(metrics.CAGR).toBeGreaterThan(0);
    expect(metrics.Sharpe ?? 0).toBeGreaterThan(0);
  });

  test('skips trades without complete entry or exit prices', () => {
    const rows: PriceFeatureLabelRow[] = [];
    for (let i = 0; i < 4; i += 1) {
      const row = makeRow('AAPL', i, [100, 100, 0, 110][i], i === 0 ? -1 : 1);
      if (i === 2) row.adjustedClose = null;
      rows.push(row);
    }

    const report = buildProfitBacktestReport(makeArtifact(rows), {
      initialCapital: 10_000,
      costBps: 0,
      strategies: [singleRetStrategy(1)],
    });

    expect(report.strategies[0].trades).toHaveLength(0);
  });

  test.each([
    [{ initialCapital: 0 }, 'Invalid value for initialCapital: 0. Expected a positive number.'],
    [{ costBps: -10 }, 'Invalid value for costBps: -10. Expected a non-negative number.'],
    [{ topN: 0 }, 'Invalid value for topN: 0. Expected a positive integer.'],
    [{ topN: 1.5 }, 'Invalid value for topN: 1.5. Expected a positive integer.'],
    [{ maxPositions: 0 }, 'Invalid value for maxPositions: 0. Expected a positive integer.'],
    [{ minTradesForCandidate: -1 }, 'Invalid value for minTradesForCandidate: -1. Expected a non-negative integer.'],
    [{ minTradesForCandidate: 1.5 }, 'Invalid value for minTradesForCandidate: 1.5. Expected a non-negative integer.'],
  ])('rejects invalid direct config values: %j', (config, message) => {
    expect(() => buildProfitBacktestReport(makeArtifact([makeRow('AAPL', 0, 100)]), config)).toThrow(message);
  });

  test.each([
    ['--initial-capital', '0', 'Invalid value for --initial-capital: 0. Expected a positive number.'],
    ['--cost-bps', '-10', 'Invalid value for --cost-bps: -10. Expected a non-negative number.'],
    ['--top-n', '0', 'Invalid value for --top-n: 0. Expected a positive integer.'],
    ['--top-n', '1.5', 'Invalid value for --top-n: 1.5. Expected a positive integer.'],
    ['--max-positions', '0', 'Invalid value for --max-positions: 0. Expected a positive integer.'],
    ['--min-trades', '-1', 'Invalid value for --min-trades: -1. Expected a non-negative integer.'],
    ['--min-trades', '1.5', 'Invalid value for --min-trades: 1.5. Expected a non-negative integer.'],
  ])('CLI parser rejects invalid value %s %s', (flag, value, message) => {
    expect(() => parseProfitBacktestCliArgs(['--in', '/tmp/input.json', flag, value])).toThrow(message);
  });

  test('valid config values still work through parser and build path', () => {
    const args = parseProfitBacktestCliArgs([
      '--in',
      '/tmp/input.json',
      '--initial-capital',
      '1000',
      '--cost-bps',
      '0',
      '--top-n',
      '1',
      '--max-positions',
      '1',
      '--min-trades',
      '0',
    ]);

    const rows = [makeRow('AAPL', 0, 100), makeRow('AAPL', 1, 101), makeRow('AAPL', 2, 102)];
    const report = buildProfitBacktestReport(makeArtifact(rows), {
      initialCapital: args.initialCapital,
      costBps: args.costBps,
      topN: args.topN,
      maxPositions: args.maxPositions,
      minTradesForCandidate: args.minTradesForCandidate,
      strategies: [singleRetStrategy(1)],
    });

    expect(report.config.initialCapital).toBe(1000);
    expect(report.config.costBps).toBe(0);
    expect(report.config.topN).toBe(1);
    expect(report.config.maxPositions).toBe(1);
    expect(report.config.minTradesForCandidate).toBe(0);
  });

  test('production signal entrypoints do not import profit backtest module', async () => {
    const indexSource = await readFile(path.join(process.cwd(), 'src', 'signal-engine', 'index.ts'), 'utf8');
    const dailyScanSource = await readFile(
      path.join(process.cwd(), 'src', 'signal-engine', 'daily-scan.ts'),
      'utf8',
    );

    expect(indexSource).not.toContain('signal-engine/research/profit-backtest');
    expect(indexSource).not.toContain('./research/profit-backtest');
    expect(dailyScanSource).not.toContain('signal-engine/research/profit-backtest');
    expect(dailyScanSource).not.toContain('./research/profit-backtest');
  });
});
