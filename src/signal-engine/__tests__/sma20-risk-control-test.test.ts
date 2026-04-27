import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { buildProfitBacktestReport } from '../research/profit-backtest.js';
import { PriceFeatureLabelArtifact, PriceFeatureLabelRow } from '../research/price-feature-labels.js';
import {
  bestRiskControlRowBySharpe,
  buildSma20RiskControlContext,
  buildSma20RiskControlReport,
  finalRiskControlVerdict,
  selectSma20RiskControlCandidates,
  simulateSma20RiskControlStrategy,
  validateSma20RiskControlConfig,
  type Sma20RiskControlRow,
} from '../research/sma20-risk-control-test.js';

function makeDate(offset: number): string {
  const d = new Date('2026-01-01T00:00:00.000Z');
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

function makeRow(ticker: string, index: number, price: number, gap: number, vol = 0.1): PriceFeatureLabelRow {
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
    vol_20d: vol,
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

function row(overrides: Partial<Sma20RiskControlRow> = {}): Sma20RiskControlRow {
  return {
    variantId: 'avoid_deep_pullback',
    topN: 6,
    costBps: 10,
    windowId: 'holdout',
    startDate: '2025-01-01',
    endDate: '2026-04-24',
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
    profitVerdict: 'reject',
    averageHoldingsPerRebalance: 6,
    skippedCandidates: 0,
    skippedRebalances: 0,
    cashDragEstimate: 0,
    notes: [],
    warnings: [],
    ...overrides,
  };
}

describe('research SMA20 risk-control test', () => {
  test('avoid_deep_pullback excludes sma_20_gap <= -0.10 and fills with next eligible candidate', () => {
    const rows = [
      makeRow('AAPL', 0, 100, -0.2),
      makeRow('MSFT', 0, 100, -0.05),
      makeRow('JPM', 0, 100, -0.04),
    ];
    const artifact = makeArtifact(rows);
    const ctx = buildSma20RiskControlContext(artifact);

    const selection = selectSma20RiskControlCandidates(rows, ctx, makeDate(0), 'avoid_deep_pullback', 2, new Map());

    expect(selection.selected.map((item) => item.ticker)).toEqual(['MSFT', 'JPM']);
    expect(selection.diagnostics.skippedCandidates).toBe(1);
  });

  test('sector_cap_one allows only one ticker per sector per rebalance', () => {
    const rows = [
      makeRow('AAPL', 0, 100, -0.09),
      makeRow('MSFT', 0, 100, -0.08),
      makeRow('JPM', 0, 100, -0.07),
    ];
    const artifact = makeArtifact(rows);
    const ctx = buildSma20RiskControlContext(artifact);

    const selection = selectSma20RiskControlCandidates(rows, ctx, makeDate(0), 'sector_cap_one', 2, new Map());

    expect(selection.selected.map((item) => item.ticker)).toEqual(['AAPL', 'JPM']);
    expect(selection.diagnostics.skippedCandidates).toBe(1);
  });

  test('ticker cooldown excludes ticker after a large loss', () => {
    const rows: PriceFeatureLabelRow[] = [];
    for (let i = 0; i < 50; i += 1) {
      const aaplPrice = i < 21 ? 100 : 85;
      rows.push(makeRow('AAPL', i, aaplPrice, -0.09));
      rows.push(makeRow('MSFT', i, 100 + i * 0.2, -0.05));
    }

    const sim = simulateSma20RiskControlStrategy(makeArtifact(rows), 'ticker_cooldown_after_loss', 1, 0, 100_000);

    expect(sim.trades[0]).toMatchObject({ ticker: 'AAPL', signalDate: makeDate(0) });
    expect(sim.trades[1]).toMatchObject({ ticker: 'MSFT', signalDate: makeDate(21) });
  });

  test('default baseline result remains unchanged versus current profit backtest for same config', () => {
    const rows: PriceFeatureLabelRow[] = [];
    for (let i = 0; i < 45; i += 1) {
      rows.push(makeRow('AAPL', i, 100 + i, -0.04));
      rows.push(makeRow('MSFT', i, 100 + i * 0.5, -0.03));
      rows.push(makeRow('JPM', i, 100 - i * 0.1, -0.02));
    }
    const artifact = makeArtifact(rows);
    const report = buildSma20RiskControlReport(artifact, {
      topNs: [2],
      costBpsValues: [10],
      variantIds: ['baseline'],
      researchWindow: { startDate: makeDate(0), endDate: makeDate(20) },
      holdoutWindow: { startDate: makeDate(21), endDate: makeDate(44) },
      minTradesForCandidate: 1,
    });
    const baselineRow = report.rows.find((item) => item.variantId === 'baseline' && item.windowId === 'full');
    const backtest = buildProfitBacktestReport(artifact, {
      initialCapital: 100_000,
      costBps: 10,
      topN: 2,
      maxPositions: 2,
      minTradesForCandidate: 1,
      strategies: [{ id: 'sma20_baseline_top2_10bps', feature: 'sma_20_gap', rankDirection: 'ascending', holdDays: 20, rebalanceFrequency: 'weekly', topN: 2, maxPositions: 2 }],
    });

    expect(baselineRow?.totalReturn).toBe(backtest.strategies[0].metrics.totalReturn);
    expect(baselineRow?.Sharpe).toBe(backtest.strategies[0].metrics.Sharpe);
    expect(baselineRow?.profitVerdict).toBe(backtest.strategies[0].profitVerdict);
  });

  test('holdout/research split rejects overlapping windows and accepts adjacent windows', () => {
    expect(() =>
      validateSma20RiskControlConfig({
        researchWindow: { startDate: '2021-01-04', endDate: '2025-06-30' },
        holdoutWindow: { startDate: '2025-01-01', endDate: '2026-04-24' },
      }),
    ).toThrow('Invalid risk-control split: research endDate 2025-06-30 must be before holdout startDate 2025-01-01.');

    expect(() =>
      validateSma20RiskControlConfig({
        researchWindow: { startDate: '2021-01-04', endDate: '2024-12-31' },
        holdoutWindow: { startDate: '2025-01-01', endDate: '2026-04-24' },
      }),
    ).not.toThrow();
  });

  test('risk-control pass requires one candidate row to satisfy all pass criteria', () => {
    const splitRows = [
      row({ variantId: 'baseline', costBps: 10, topN: 6, Sharpe: 0.5, maxDrawdown: -0.2, benchmarkRelativeReturn: -0.1 }),
      row({ variantId: 'avoid_deep_pullback', costBps: 10, topN: 6, Sharpe: 0.4, maxDrawdown: -0.3, benchmarkRelativeReturn: -0.2, profitVerdict: 'research_candidate' }),
      row({ variantId: 'sector_cap_one', costBps: 0, topN: 6, Sharpe: 0.7, maxDrawdown: -0.1, benchmarkRelativeReturn: 0.1, profitVerdict: 'research_candidate' }),
    ];
    expect(finalRiskControlVerdict(splitRows)).toBe('risk_control_fragile');

    const passRows = [
      row({ variantId: 'baseline', costBps: 10, topN: 6, Sharpe: 0.5, maxDrawdown: -0.2, benchmarkRelativeReturn: -0.1 }),
      row({ variantId: 'avoid_deep_pullback', costBps: 10, topN: 6, Sharpe: 0.7, maxDrawdown: -0.1, benchmarkRelativeReturn: 0.1, profitVerdict: 'research_candidate' }),
    ];
    expect(finalRiskControlVerdict(passRows)).toBe('risk_control_pass');
  });

  test('risk-control fragile requires one weak or candidate row to improve at least two metrics', () => {
    const splitRows = [
      row({ variantId: 'baseline', costBps: 10, topN: 6, Sharpe: 0.5, maxDrawdown: -0.2, benchmarkRelativeReturn: -0.1 }),
      row({ variantId: 'sector_cap_one', Sharpe: 0.4, maxDrawdown: -0.3, benchmarkRelativeReturn: -0.2, profitVerdict: 'weak' }),
      row({ variantId: 'avoid_deep_pullback', Sharpe: 0.7, maxDrawdown: -0.1, benchmarkRelativeReturn: -0.05, profitVerdict: 'reject' }),
    ];
    expect(finalRiskControlVerdict(splitRows)).toBe('risk_control_fail');

    const fragileRows = [
      row({ variantId: 'baseline', costBps: 10, topN: 6, Sharpe: 0.5, maxDrawdown: -0.2, benchmarkRelativeReturn: -0.1 }),
      row({ variantId: 'sector_cap_one', Sharpe: 0.7, maxDrawdown: -0.1, benchmarkRelativeReturn: -0.05, profitVerdict: 'weak' }),
    ];
    expect(finalRiskControlVerdict(fragileRows)).toBe('risk_control_fragile');
  });

  test('final risk-control verdict returns fail when controlled rows do not improve enough', () => {
    const failRows = [
      row({ variantId: 'baseline', costBps: 10, topN: 6, Sharpe: 0.5, maxDrawdown: -0.2, benchmarkRelativeReturn: -0.1 }),
      row({ variantId: 'sector_cap_one', Sharpe: 0.4, maxDrawdown: -0.3, benchmarkRelativeReturn: -0.2, profitVerdict: 'reject' }),
    ];
    expect(finalRiskControlVerdict(failRows)).toBe('risk_control_fail');
  });

  test('best holdout row selection is deterministic', () => {
    const best = bestRiskControlRowBySharpe([
      row({ variantId: 'sector_cap_one', topN: 6, costBps: 10, Sharpe: 1 }),
      row({ variantId: 'avoid_deep_pullback', topN: 4, costBps: 0, Sharpe: 1 }),
    ]);
    expect(best?.variantId).toBe('avoid_deep_pullback');
  });

  test('production signal entrypoints do not import risk-control module', async () => {
    const indexSource = await readFile(path.join(process.cwd(), 'src', 'signal-engine', 'index.ts'), 'utf8');
    const dailyScanSource = await readFile(path.join(process.cwd(), 'src', 'signal-engine', 'daily-scan.ts'), 'utf8');

    expect(indexSource).not.toContain('signal-engine/research/sma20-risk-control-test');
    expect(indexSource).not.toContain('./research/sma20-risk-control-test');
    expect(dailyScanSource).not.toContain('signal-engine/research/sma20-risk-control-test');
    expect(dailyScanSource).not.toContain('./research/sma20-risk-control-test');
  });
});
