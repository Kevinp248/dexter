import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PriceFeatureLabelArtifact, PriceFeatureLabelRow } from '../research/price-feature-labels.js';
import {
  buildSma20DecisionReport,
  finalDecisionVerdict,
  selectBestTrainConfig,
  summarizeParameterStability,
  validateSma20DecisionConfig,
  type DecisionMetrics,
  type DecisionStrategyConfig,
  type WalkForwardResult,
} from '../research/sma20-walkforward-decision-report.js';

function makeDate(offset: number): string {
  const d = new Date('2021-01-04T00:00:00.000Z');
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

function makeRow(ticker: string, index: number, price: number, gap = -0.04): PriceFeatureLabelRow {
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

function config(overrides: Partial<DecisionStrategyConfig> = {}): DecisionStrategyConfig {
  return {
    configId: 'baseline_top4_0bps_ddnone_sectornone_cooldownnone',
    variantId: 'baseline',
    riskControlVariantId: 'baseline',
    topN: 4,
    costBps: 0,
    deepPullbackThreshold: null,
    sectorCap: 'none',
    cooldownLossThreshold: null,
    cooldownDays: null,
    ...overrides,
  };
}

function metrics(overrides: Partial<DecisionMetrics> = {}): DecisionMetrics {
  return {
    totalReturn: 0,
    CAGR: 0,
    Sharpe: 0,
    maxDrawdown: -0.1,
    Calmar: 0,
    numberOfTrades: 20,
    turnover: 1,
    winRate: 0.5,
    benchmarkRelativeReturn: 0,
    benchmarkRelativeMaxDrawdown: 0,
    profitVerdict: 'reject',
    averageHoldingsPerRebalance: 4,
    skippedCandidates: 0,
    skippedRebalances: 0,
    ...overrides,
  };
}

function wf(overrides: Partial<WalkForwardResult> = {}): WalkForwardResult {
  const selectedConfig = config();
  return {
    windowId: 'wf',
    trainWindow: { windowId: 'train', startDate: '2021-01-04', endDate: '2022-12-31' },
    testWindow: { windowId: 'test', startDate: '2023-01-01', endDate: '2023-12-31' },
    selectedConfig,
    trainMetrics: metrics(),
    testMetrics: metrics(),
    benchmarkMetrics: {
      totalReturn: 0,
      CAGR: 0,
      annualizedVolatility: 0,
      Sharpe: 0,
      maxDrawdown: -0.1,
      Calmar: 0,
      winRate: null,
      averageTradeReturn: null,
      medianTradeReturn: null,
      numberOfTrades: 1,
      turnover: 1,
      averageExposure: 1,
      bestMonth: null,
      worstMonth: null,
      benchmarkRelativeReturn: 0,
      benchmarkRelativeMaxDrawdown: 0,
    },
    baselineSma20Metrics: metrics(),
    ...overrides,
  };
}

describe('research SMA20 walk-forward decision report', () => {
  test('grid expansion count is deterministic', () => {
    const rows: PriceFeatureLabelRow[] = [];
    for (let i = 0; i < 20; i += 1) {
      rows.push(makeRow('AAPL', i, 100 + i));
      rows.push(makeRow('MSFT', i, 100 + i));
    }
    const report = buildSma20DecisionReport(makeArtifact(rows), {
      topNs: [4],
      costBpsValues: [0],
      deepPullbackThresholds: [-0.1],
      minTradesForCandidate: 1,
    });
    expect(report.configGrid.totalConfigsTested).toBe(5);
  });

  test('train-only selection does not inspect test metrics', () => {
    const selected = selectBestTrainConfig([
      { config: config({ configId: 'train_winner', costBps: 10 }), metrics: metrics({ profitVerdict: 'weak', Sharpe: 1 }) },
      { config: config({ configId: 'test_would_have_won', costBps: 0 }), metrics: metrics({ profitVerdict: 'reject', Sharpe: 10 }) },
    ]);
    expect(selected.config.configId).toBe('train_winner');
  });

  test('selected config is applied to test window unchanged', () => {
    const rows: PriceFeatureLabelRow[] = [];
    for (let i = 0; i < 1900; i += 1) {
      rows.push(makeRow('AAPL', i, 100 + i * 0.01));
      rows.push(makeRow('MSFT', i, 100 + i * 0.02));
      rows.push(makeRow('JPM', i, 100 + i * 0.01));
      rows.push(makeRow('XOM', i, 100 + i * 0.01));
    }
    const report = buildSma20DecisionReport(makeArtifact(rows), {
      topNs: [4],
      costBpsValues: [0],
      deepPullbackThresholds: [-0.1],
      minTradesForCandidate: 1,
    });
    expect(report.walkForwardResults).toHaveLength(4);
    for (const result of report.walkForwardResults) {
      expect(report.selectedConfigs).toContainEqual(result.selectedConfig);
      expect(result.testMetrics).toBeTruthy();
    }
  });

  test('decision verdict rules keep strict continue case working', () => {
    const costRobustness = {
      selectedCostBpsValues: [10],
      selectedAnyCostBpsAtLeast10: true,
      selectedAnyCostBpsAtLeast25: false,
      selectedTestResearchCandidateAt10Bps: true,
      selectedTestResearchCandidateAt25Bps: false,
    };
    expect(
      finalDecisionVerdict({
        researchCandidateTestWindows: 2,
        weakOrBetterTestWindows: 3,
        averageTestBenchmarkRelativeReturn: 0.01,
        maxDrawdownBetterThanBenchmarkWindows: 4,
        walkForwardWindows: 4,
        costRobustness,
      }),
    ).toBe('continue_sma20_research');
  });

  test('decision verdict pivots only when drawdown improves in at least one test window', () => {
    const costRobustness = {
      selectedCostBpsValues: [0],
      selectedAnyCostBpsAtLeast10: false,
      selectedAnyCostBpsAtLeast25: false,
      selectedTestResearchCandidateAt10Bps: false,
      selectedTestResearchCandidateAt25Bps: false,
    };
    expect(
      finalDecisionVerdict({
        researchCandidateTestWindows: 1,
        weakOrBetterTestWindows: 2,
        averageTestBenchmarkRelativeReturn: 0.01,
        maxDrawdownBetterThanBenchmarkWindows: 0,
        walkForwardWindows: 4,
        costRobustness,
      }),
    ).toBe('stop_sma20_price_only');
    expect(
      finalDecisionVerdict({
        researchCandidateTestWindows: 1,
        weakOrBetterTestWindows: 2,
        averageTestBenchmarkRelativeReturn: 0.01,
        maxDrawdownBetterThanBenchmarkWindows: 2,
        walkForwardWindows: 4,
        costRobustness,
      }),
    ).toBe('pivot_to_new_features');
  });

  test('decision verdict stops for weak, negative, and zero-drawdown-improvement cases', () => {
    const costRobustness = {
      selectedCostBpsValues: [10],
      selectedAnyCostBpsAtLeast10: true,
      selectedAnyCostBpsAtLeast25: false,
      selectedTestResearchCandidateAt10Bps: true,
      selectedTestResearchCandidateAt25Bps: false,
    };
    expect(
      finalDecisionVerdict({
        researchCandidateTestWindows: 1,
        weakOrBetterTestWindows: 1,
        averageTestBenchmarkRelativeReturn: 0.01,
        maxDrawdownBetterThanBenchmarkWindows: 1,
        walkForwardWindows: 4,
        costRobustness,
      }),
    ).toBe('stop_sma20_price_only');
    expect(
      finalDecisionVerdict({
        researchCandidateTestWindows: 1,
        weakOrBetterTestWindows: 2,
        averageTestBenchmarkRelativeReturn: -0.01,
        maxDrawdownBetterThanBenchmarkWindows: 2,
        walkForwardWindows: 4,
        costRobustness,
      }),
    ).toBe('stop_sma20_price_only');
    expect(
      finalDecisionVerdict({
        researchCandidateTestWindows: 1,
        weakOrBetterTestWindows: 2,
        averageTestBenchmarkRelativeReturn: 0.01,
        maxDrawdownBetterThanBenchmarkWindows: 0,
        walkForwardWindows: 4,
        costRobustness,
      }),
    ).toBe('stop_sma20_price_only');
  });

  test('parameter stability summary counts selected parameters', () => {
    const stability = summarizeParameterStability([
      wf({ selectedConfig: config({ topN: 6, deepPullbackThreshold: -0.1, sectorCap: 'one_per_sector', cooldownLossThreshold: null }) }),
      wf({ selectedConfig: config({ topN: 6, deepPullbackThreshold: -0.1, sectorCap: 'one_per_sector', cooldownLossThreshold: -0.08 }) }),
      wf({ selectedConfig: config({ topN: 4, deepPullbackThreshold: null, sectorCap: 'none', cooldownLossThreshold: null }) }),
    ]);
    expect(stability.selectedTopNCounts).toEqual({ '4': 1, '6': 2 });
    expect(stability.selectedThresholdCounts).toEqual({ '-0.1': 2, none: 1 });
    expect(stability.selectedSectorCapCounts).toEqual({ none: 1, one_per_sector: 2 });
    expect(stability.selectedCooldownCounts).toEqual({ '-0.08': 1, none: 2 });
  });

  test('cost robustness summary records selected costs', () => {
    const rows: PriceFeatureLabelRow[] = [];
    for (let i = 0; i < 1900; i += 1) {
      rows.push(makeRow('AAPL', i, 100 + i * 0.01));
      rows.push(makeRow('MSFT', i, 100 + i * 0.02));
      rows.push(makeRow('JPM', i, 100 + i * 0.01));
      rows.push(makeRow('XOM', i, 100 + i * 0.01));
    }
    const report = buildSma20DecisionReport(makeArtifact(rows), {
      topNs: [4],
      costBpsValues: [0, 10],
      deepPullbackThresholds: [-0.1],
      minTradesForCandidate: 1,
    });
    expect(report.summary.costRobustness.selectedCostBpsValues.length).toBeGreaterThan(0);
    expect(typeof report.summary.costRobustness.selectedAnyCostBpsAtLeast10).toBe('boolean');
  });

  test('invalid threshold/config values reject clearly', () => {
    expect(() => validateSma20DecisionConfig({ deepPullbackThresholds: [0.1] })).toThrow(
      'Invalid value for deepPullbackThresholds: 0.1. Expected a negative number.',
    );
    expect(() =>
      validateSma20DecisionConfig({
        researchWindow: { startDate: '2021-01-04', endDate: '2025-01-01' },
        holdoutWindow: { startDate: '2025-01-01', endDate: '2026-04-24' },
      }),
    ).toThrow('Invalid decision split: research endDate 2025-01-01 must be before holdout startDate 2025-01-01.');
  });

  test('production entrypoints do not import decision report module', async () => {
    const indexSource = await readFile(path.join(process.cwd(), 'src', 'signal-engine', 'index.ts'), 'utf8');
    const dailyScanSource = await readFile(path.join(process.cwd(), 'src', 'signal-engine', 'daily-scan.ts'), 'utf8');
    expect(indexSource).not.toContain('signal-engine/research/sma20-walkforward-decision-report');
    expect(indexSource).not.toContain('./research/sma20-walkforward-decision-report');
    expect(dailyScanSource).not.toContain('signal-engine/research/sma20-walkforward-decision-report');
    expect(dailyScanSource).not.toContain('./research/sma20-walkforward-decision-report');
  });
});
