import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PriceFeatureLabelArtifact, PriceFeatureLabelRow } from '../research/price-feature-labels.js';
import {
  buildFeatureEngineeredArtifact,
  buildSignalDiscoveryReport,
  finalSignalDiscoveryDecision,
  selectBestSignalDiscoveryTrainConfig,
  type FamilyWalkForwardResult,
  type SignalDiscoveryMetrics,
  type SignalDiscoveryStrategyConfig,
} from '../research/feature-engineering-signal-discovery.js';

function makeDate(offset: number): string {
  const d = new Date('2021-01-04T00:00:00.000Z');
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

function makeRow(ticker: string, date: string, overrides: Partial<PriceFeatureLabelRow> = {}): PriceFeatureLabelRow {
  const price = overrides.priceUsed ?? overrides.close ?? 100;
  return {
    ticker,
    date,
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
    sma_20_gap: -0.02,
    sma_50_gap: 0.04,
    vol_20d: 0.02,
    drawdown_252d: -0.05,
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
    ...overrides,
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

function config(overrides: Partial<SignalDiscoveryStrategyConfig> = {}): SignalDiscoveryStrategyConfig {
  return {
    configId: 'sector_relative_pullback_top4_hold20_0bps',
    familyId: 'sector_relative_pullback',
    topN: 4,
    holdDays: 20,
    costBps: 0,
    ...overrides,
  };
}

function metrics(overrides: Partial<SignalDiscoveryMetrics> = {}): SignalDiscoveryMetrics {
  return {
    totalReturn: 0,
    CAGR: 0,
    Sharpe: 0,
    maxDrawdown: -0.1,
    Calmar: 0,
    trades: 20,
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

function wf(overrides: Partial<FamilyWalkForwardResult> = {}): FamilyWalkForwardResult {
  return {
    windowId: 'wf',
    familyId: 'sector_relative_pullback',
    trainWindow: { windowId: 'train', startDate: '2021-01-04', endDate: '2022-12-31' },
    testWindow: { windowId: 'test', startDate: '2023-01-01', endDate: '2023-12-31' },
    selectedConfig: config({ costBps: 10 }),
    trainMetrics: metrics(),
    testMetrics: metrics({ profitVerdict: 'weak' }),
    ...overrides,
  };
}

describe('feature engineering signal discovery', () => {
  test('sector-relative features use only same-date sector data', () => {
    const artifact = buildFeatureEngineeredArtifact(makeArtifact([
      makeRow('AAPL', '2026-01-02', { sma_20_gap: -0.06, ret_20d: 0.02 }),
      makeRow('MSFT', '2026-01-02', { sma_20_gap: 0.02, ret_20d: 0.06 }),
      makeRow('JPM', '2026-01-02', { sma_20_gap: 0.10, ret_20d: 0.20 }),
      makeRow('AAPL', '2026-01-03', { sma_20_gap: 0.50, ret_20d: 0.50 }),
      makeRow('MSFT', '2026-01-03', { sma_20_gap: 0.50, ret_20d: 0.50 }),
    ]));
    const aapl = artifact.rows.find((row) => row.ticker === 'AAPL' && row.date === '2026-01-02');
    expect(aapl?.sectorAvgSma20Gap).toBeCloseTo(-0.02);
    expect(aapl?.sectorRelativeSma20Gap).toBeCloseTo(-0.04);
    expect(aapl?.sectorAvgRet20d).toBeCloseTo(0.04);
    expect(aapl?.sectorRelativeRet20d).toBeCloseTo(-0.02);
  });

  test('market-relative features use only same-date universe data', () => {
    const artifact = buildFeatureEngineeredArtifact(makeArtifact([
      makeRow('AAPL', '2026-01-02', { ret_20d: 0.10, ret_5d: 0.03 }),
      makeRow('JPM', '2026-01-02', { ret_20d: -0.02, ret_5d: -0.01 }),
      makeRow('AAPL', '2026-01-03', { ret_20d: 0.90, ret_5d: 0.90 }),
    ]));
    const aapl = artifact.rows.find((row) => row.ticker === 'AAPL' && row.date === '2026-01-02');
    expect(aapl?.marketRet20d).toBeCloseTo(0.04);
    expect(aapl?.relRet20d).toBeCloseTo(0.06);
    expect(aapl?.marketRet5d).toBeCloseTo(0.01);
    expect(aapl?.relRet5d).toBeCloseTo(0.02);
  });

  test('volatility-adjusted features handle null and zero volatility safely', () => {
    const artifact = buildFeatureEngineeredArtifact(makeArtifact([
      makeRow('AAPL', '2026-01-02', { sma_20_gap: -0.04, ret_20d: 0.08, vol_20d: 0 }),
      makeRow('MSFT', '2026-01-02', { sma_20_gap: -0.03, ret_20d: 0.06, vol_20d: null }),
      makeRow('JPM', '2026-01-02', { sma_20_gap: -0.02, ret_20d: 0.04, vol_20d: 0.02 }),
    ]));
    expect(artifact.rows.find((row) => row.ticker === 'AAPL')?.volAdjustedSma20Gap).toBeNull();
    expect(artifact.rows.find((row) => row.ticker === 'MSFT')?.volAdjustedRet20d).toBeNull();
    expect(artifact.rows.find((row) => row.ticker === 'JPM')?.volAdjustedSma20Gap).toBeCloseTo(-1);
  });

  test('breadth features calculate universe and sector percentages', () => {
    const artifact = buildFeatureEngineeredArtifact(makeArtifact([
      makeRow('AAPL', '2026-01-02', { sma_20_gap: 0.01, sma_50_gap: 0.02 }),
      makeRow('MSFT', '2026-01-02', { sma_20_gap: -0.01, sma_50_gap: 0.03 }),
      makeRow('JPM', '2026-01-02', { sma_20_gap: 0.02, sma_50_gap: -0.02 }),
      makeRow('BAC', '2026-01-02', { sma_20_gap: -0.02, sma_50_gap: -0.03 }),
    ]));
    const aapl = artifact.rows.find((row) => row.ticker === 'AAPL');
    expect(aapl?.universeBreadth20).toBeCloseTo(0.5);
    expect(aapl?.universeBreadth50).toBeCloseTo(0.5);
    expect(aapl?.sectorBreadth20).toBeCloseTo(0.5);
    expect(aapl?.sectorBreadth50).toBeCloseTo(1);
  });

  test('composite score ranking is deterministic', () => {
    const rows = [
      makeRow('MSFT', '2026-01-02', { ret_20d: 0.10, sma_20_gap: -0.02 }),
      makeRow('AAPL', '2026-01-02', { ret_20d: 0.10, sma_20_gap: -0.02 }),
      makeRow('JPM', '2026-01-02', { ret_20d: 0.01, sma_20_gap: -0.01 }),
    ];
    const first = buildFeatureEngineeredArtifact(makeArtifact(rows)).rows.map((row) => [row.ticker, row.relativePullbackComposite]);
    const second = buildFeatureEngineeredArtifact(makeArtifact([...rows].reverse())).rows.map((row) => [row.ticker, row.relativePullbackComposite]);
    expect(first).toEqual(second);
  });

  test('train-only selection does not inspect test metrics', () => {
    const selected = selectBestSignalDiscoveryTrainConfig([
      { config: config({ configId: 'train_winner', costBps: 10 }), metrics: metrics({ profitVerdict: 'weak', Sharpe: 1 }) },
      { config: config({ configId: 'test_would_have_won', costBps: 0 }), metrics: metrics({ profitVerdict: 'reject', Sharpe: 10 }) },
    ]);
    expect(selected.config.configId).toBe('train_winner');
  });

  test('selected config is applied unchanged to test window', () => {
    const rows: PriceFeatureLabelRow[] = [];
    for (let i = 0; i < 1920; i += 1) {
      const date = makeDate(i);
      rows.push(makeRow('AAPL', date, { priceUsed: 100 + i * 0.02, close: 100 + i * 0.02, adjustedClose: 100 + i * 0.02, ret_20d: 0.04, sma_20_gap: -0.03, sma_50_gap: 0.05 }));
      rows.push(makeRow('MSFT', date, { priceUsed: 100 + i * 0.03, close: 100 + i * 0.03, adjustedClose: 100 + i * 0.03, ret_20d: 0.05, sma_20_gap: -0.02, sma_50_gap: 0.05 }));
      rows.push(makeRow('JPM', date, { priceUsed: 100 + i * 0.01, close: 100 + i * 0.01, adjustedClose: 100 + i * 0.01, ret_20d: 0.02, sma_20_gap: -0.01, sma_50_gap: 0.03 }));
      rows.push(makeRow('BAC', date, { priceUsed: 100 + i * 0.01, close: 100 + i * 0.01, adjustedClose: 100 + i * 0.01, ret_20d: 0.01, sma_20_gap: -0.01, sma_50_gap: 0.03 }));
    }
    const featureArtifact = buildFeatureEngineeredArtifact(makeArtifact(rows));
    const report = buildSignalDiscoveryReport(featureArtifact, { topNs: [4], costBpsValues: [0], minTradesForCandidate: 1 });
    expect(report.walkForwardSelections).toHaveLength(4);
    for (const result of report.walkForwardSelections) {
      expect(result.testMetrics).toBeTruthy();
      expect(result.selectedConfig).toEqual(expect.objectContaining({
        configId: result.selectedConfig.configId,
        familyId: result.selectedFamilyId,
      }));
    }
  });

  test('final decision rules return continue, refine, and stop', () => {
    expect(finalSignalDiscoveryDecision({
      familySummaries: [{
        familyId: 'sector_relative_pullback',
        selectedWindows: 4,
        researchCandidateTestWindows: 2,
        weakOrBetterTestWindows: 3,
        averageTestSharpe: 1,
        medianTestSharpe: 1,
        averageTestBenchmarkRelativeReturn: 0.01,
        medianTestBenchmarkRelativeReturn: 0.01,
        worstTestMaxDrawdown: -0.2,
      }],
      perFamilyWalkForwardResults: [wf({ testMetrics: metrics({ profitVerdict: 'research_candidate' }), selectedConfig: config({ costBps: 10 }) })],
    })).toBe('continue_new_signal_research');

    expect(finalSignalDiscoveryDecision({
      familySummaries: [{
        familyId: 'sector_relative_pullback',
        selectedWindows: 4,
        researchCandidateTestWindows: 0,
        weakOrBetterTestWindows: 2,
        averageTestSharpe: 0.5,
        medianTestSharpe: 0.5,
        averageTestBenchmarkRelativeReturn: -0.01,
        medianTestBenchmarkRelativeReturn: -0.01,
        worstTestMaxDrawdown: -0.3,
      }],
      perFamilyWalkForwardResults: [wf({ testMetrics: metrics({ profitVerdict: 'weak' }), selectedConfig: config({ costBps: 10 }) })],
    })).toBe('refine_feature_set');

    expect(finalSignalDiscoveryDecision({
      familySummaries: [{
        familyId: 'sector_relative_pullback',
        selectedWindows: 4,
        researchCandidateTestWindows: 0,
        weakOrBetterTestWindows: 0,
        averageTestSharpe: -1,
        medianTestSharpe: -1,
        averageTestBenchmarkRelativeReturn: -0.2,
        medianTestBenchmarkRelativeReturn: -0.2,
        worstTestMaxDrawdown: -0.6,
      }],
      perFamilyWalkForwardResults: [],
    })).toBe('stop_price_only_research');
  });

  test('production entrypoints do not import this research module', async () => {
    const entrypoints = ['src/signal-engine/index.ts', 'src/signal-engine/daily-scan.ts', 'src/signal-engine/daily-operator.ts'];
    for (const entrypoint of entrypoints) {
      const source = await readFile(path.join(process.cwd(), entrypoint), 'utf8');
      expect(source).not.toContain('feature-engineering-signal-discovery');
    }
  });
});
