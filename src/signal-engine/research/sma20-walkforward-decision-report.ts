import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PriceFeatureLabelArtifact, PriceFeatureLabelRow } from './price-feature-labels.js';
import {
  buildProfitBacktestReport,
  computeProfitMetrics,
  ProfitMetrics,
  ProfitVerdict,
  type ProfitStrategyConfig,
} from './profit-backtest.js';
import {
  assertNonNegativeInteger,
  assertNonNegativeNumber,
  assertPositiveInteger,
  assertPositiveNumber,
  countBy,
  mean,
  median,
  roundFinite,
  validateDateWindow,
  validateNonOverlappingWindows,
} from './research-utils.js';
import {
  simulateSma20RiskControlStrategy,
  type RiskControlVariantId,
  type Sma20RiskControlRow,
} from './sma20-risk-control-test.js';

export type DecisionVariantId =
  | 'baseline'
  | 'avoid_deep_pullback'
  | 'sector_cap_one'
  | 'avoid_deep_pullback_plus_sector_cap'
  | 'avoid_deep_pullback_plus_cooldown';
export type SectorCapMode = 'none' | 'one_per_sector';
export type FinalDecisionVerdict = 'continue_sma20_research' | 'pivot_to_new_features' | 'stop_sma20_price_only';
export type FinalDecisionRecommendation =
  | 'continue_with_sma20_risk_control_research'
  | 'pivot_to_feature_engineering_and_new_signals'
  | 'stop_price_only_sma20_research';

export interface Sma20DecisionConfig {
  inputPath?: string;
  outputPath?: string;
  initialCapital?: number;
  topNs?: number[];
  costBpsValues?: number[];
  deepPullbackThresholds?: number[];
  minTradesForCandidate?: number;
  researchWindow?: { startDate: string; endDate: string };
  holdoutWindow?: { startDate: string; endDate: string };
}

export interface DecisionStrategyConfig {
  configId: string;
  variantId: DecisionVariantId;
  riskControlVariantId: RiskControlVariantId;
  topN: number;
  costBps: number;
  deepPullbackThreshold: number | null;
  sectorCap: SectorCapMode;
  cooldownLossThreshold: number | null;
  cooldownDays: number | null;
}

export interface DecisionWindow {
  windowId: string;
  startDate: string;
  endDate: string;
}

export interface WalkForwardWindow {
  windowId: string;
  train: DecisionWindow;
  test: DecisionWindow;
}

export interface DecisionMetrics {
  totalReturn: number;
  CAGR: number;
  Sharpe: number | null;
  maxDrawdown: number;
  Calmar: number | null;
  numberOfTrades: number;
  turnover: number;
  winRate: number | null;
  benchmarkRelativeReturn: number | null;
  benchmarkRelativeMaxDrawdown: number | null;
  profitVerdict: ProfitVerdict;
  averageHoldingsPerRebalance: number | null;
  skippedCandidates: number;
  skippedRebalances: number;
}

export interface WalkForwardResult {
  windowId: string;
  trainWindow: DecisionWindow;
  testWindow: DecisionWindow;
  selectedConfig: DecisionStrategyConfig;
  trainMetrics: DecisionMetrics;
  testMetrics: DecisionMetrics;
  benchmarkMetrics: ProfitMetrics;
  baselineSma20Metrics: DecisionMetrics;
}

export interface Sma20DecisionSummary {
  totalConfigsTested: number;
  walkForwardWindows: number;
  positiveBenchmarkRelativeReturnWindows: number;
  sharpeBeatsBenchmarkWindows: number;
  maxDrawdownBetterThanBenchmarkWindows: number;
  researchCandidateTestWindows: number;
  weakOrBetterTestWindows: number;
  averageTestSharpe: number | null;
  medianTestSharpe: number | null;
  averageTestBenchmarkRelativeReturn: number | null;
  medianTestBenchmarkRelativeReturn: number | null;
  worstTestMaxDrawdown: number;
  costRobustness: {
    selectedCostBpsValues: number[];
    selectedAnyCostBpsAtLeast10: boolean;
    selectedAnyCostBpsAtLeast25: boolean;
    selectedTestResearchCandidateAt10Bps: boolean;
    selectedTestResearchCandidateAt25Bps: boolean;
  };
  parameterStability: {
    selectedTopNCounts: Record<string, number>;
    selectedThresholdCounts: Record<string, number>;
    selectedSectorCapCounts: Record<SectorCapMode, number>;
    selectedCooldownCounts: Record<string, number>;
  };
  degradation: {
    averageTrainSharpeMinusAverageTestSharpe: number | null;
    averageTrainBenchmarkRelativeReturnMinusAverageTestBenchmarkRelativeReturn: number | null;
  };
  finalDecisionVerdict: FinalDecisionVerdict;
  finalRecommendation: FinalDecisionRecommendation;
}

export interface Sma20DecisionReport {
  generatedAt: string;
  lane: 'research_only';
  reportType: 'research_sma20_walkforward_decision_report';
  schemaVersion: 'research_sma20_walkforward_decision_report_v1';
  artifactCoverage: {
    rowCount: number;
    tickerCount: number;
    firstDate: string | null;
    lastDate: string | null;
  };
  configGrid: {
    topNs: number[];
    costBpsValues: number[];
    deepPullbackThresholds: number[];
    sectorCaps: SectorCapMode[];
    cooldownLossThresholds: Array<number | null>;
    totalConfigsTested: number;
    configs: DecisionStrategyConfig[];
  };
  fixedHoldoutSummary: {
    researchWindow: DecisionWindow;
    holdoutWindow: DecisionWindow;
    bestHoldoutConfigBySharpe: DecisionStrategyConfig | null;
    bestHoldoutResultBySharpe: DecisionMetrics | null;
    bestHoldoutConfigByBenchmarkRelativeReturn: DecisionStrategyConfig | null;
    bestHoldoutResultByBenchmarkRelativeReturn: DecisionMetrics | null;
  };
  walkForwardResults: WalkForwardResult[];
  selectedConfigs: DecisionStrategyConfig[];
  benchmarkComparisons: Array<{
    windowId: string;
    testBenchmarkMetrics: ProfitMetrics;
    selectedTestMetrics: DecisionMetrics;
    baselineSma20Metrics: DecisionMetrics;
  }>;
  parameterStability: Sma20DecisionSummary['parameterStability'];
  summary: Sma20DecisionSummary;
  finalDecision: {
    verdict: FinalDecisionVerdict;
    recommendation: FinalDecisionRecommendation;
  };
  warnings: string[];
}

const DEFAULT_INITIAL_CAPITAL = 100_000;
const DEFAULT_TOP_NS = [4, 6, 8];
const DEFAULT_COST_BPS_VALUES = [0, 10, 25];
const DEFAULT_DEEP_PULLBACK_THRESHOLDS = [-0.06, -0.08, -0.1, -0.12, -0.15];
const DEFAULT_MIN_TRADES_FOR_CANDIDATE = 20;
const DEFAULT_RESEARCH_WINDOW = { startDate: '2021-01-04', endDate: '2024-12-31' };
const DEFAULT_HOLDOUT_WINDOW = { startDate: '2025-01-01', endDate: '2026-04-24' };
const SMA20_STRATEGY: ProfitStrategyConfig = {
  id: 'sma20_walkforward_decision',
  feature: 'sma_20_gap',
  rankDirection: 'ascending',
  holdDays: 20,
  rebalanceFrequency: 'weekly',
};

function splitArtifact(artifact: PriceFeatureLabelArtifact, startDate: string, endDate: string): PriceFeatureLabelArtifact {
  const rows = artifact.rows.filter((row) => row.date >= startDate && row.date <= endDate);
  const tickers = Array.from(new Set(rows.map((row) => row.ticker))).sort((a, b) => a.localeCompare(b));
  return {
    ...artifact,
    rows,
    summary: {
      ...artifact.summary,
      rowCount: rows.length,
      firstDate: rows[0]?.date ?? null,
      lastDate: rows[rows.length - 1]?.date ?? null,
      tickers,
      tickerCoverage: tickers.map((ticker) => {
        const tickerRows = rows.filter((row) => row.ticker === ticker);
        return { ticker, rowCount: tickerRows.length, firstDate: tickerRows[0]?.date ?? null, lastDate: tickerRows[tickerRows.length - 1]?.date ?? null };
      }),
    },
  };
}

function benchmarkReport(
  artifact: PriceFeatureLabelArtifact,
  config: RequiredConfig,
  strategyConfig: DecisionStrategyConfig,
) {
  return buildProfitBacktestReport(artifact, {
    inputPath: config.inputPath ?? undefined,
    initialCapital: config.initialCapital,
    costBps: strategyConfig.costBps,
    topN: strategyConfig.topN,
    maxPositions: strategyConfig.topN,
    minTradesForCandidate: config.minTradesForCandidate,
    strategies: [{ ...SMA20_STRATEGY, id: `sma20_baseline_${strategyConfig.configId}`, topN: strategyConfig.topN, maxPositions: strategyConfig.topN }],
  });
}

function profitVerdict(metrics: ProfitMetrics, benchmark: ProfitMetrics, minTrades: number): ProfitVerdict {
  if (metrics.numberOfTrades < minTrades) return 'expand_universe';
  if (metrics.totalReturn <= benchmark.totalReturn && Math.abs(metrics.maxDrawdown) >= Math.abs(benchmark.maxDrawdown)) return 'reject';
  if (
    metrics.totalReturn > benchmark.totalReturn &&
    Math.abs(metrics.maxDrawdown) <= Math.abs(benchmark.maxDrawdown) &&
    (metrics.Sharpe ?? Number.NEGATIVE_INFINITY) > (benchmark.Sharpe ?? Number.NEGATIVE_INFINITY)
  ) {
    return 'research_candidate';
  }
  if (metrics.totalReturn > benchmark.totalReturn) return 'weak';
  return 'reject';
}

function toDecisionMetrics(
  metrics: ProfitMetrics,
  verdict: ProfitVerdict,
  extras: Pick<DecisionMetrics, 'averageHoldingsPerRebalance' | 'skippedCandidates' | 'skippedRebalances'>,
): DecisionMetrics {
  return {
    totalReturn: metrics.totalReturn,
    CAGR: metrics.CAGR,
    Sharpe: metrics.Sharpe,
    maxDrawdown: metrics.maxDrawdown,
    Calmar: metrics.Calmar,
    numberOfTrades: metrics.numberOfTrades,
    turnover: metrics.turnover,
    winRate: metrics.winRate,
    benchmarkRelativeReturn: metrics.benchmarkRelativeReturn,
    benchmarkRelativeMaxDrawdown: metrics.benchmarkRelativeMaxDrawdown,
    profitVerdict: verdict,
    ...extras,
  };
}

function evaluateConfig(
  artifact: PriceFeatureLabelArtifact,
  config: RequiredConfig,
  strategyConfig: DecisionStrategyConfig,
): { metrics: DecisionMetrics; benchmarkMetrics: ProfitMetrics; baselineSma20Metrics: DecisionMetrics } {
  const baseline = benchmarkReport(artifact, config, strategyConfig);
  const benchmarkMetrics = baseline.baselines[0].metrics;
  const baselineResult = baseline.strategies[0];
  const baselineSma20Metrics = toDecisionMetrics(baselineResult.metrics, baselineResult.profitVerdict, {
    averageHoldingsPerRebalance: null,
    skippedCandidates: 0,
    skippedRebalances: 0,
  });

  if (strategyConfig.variantId === 'baseline') {
    return { metrics: baselineSma20Metrics, benchmarkMetrics, baselineSma20Metrics };
  }

  const sim = simulateSma20RiskControlStrategy(
    artifact,
    strategyConfig.riskControlVariantId,
    strategyConfig.topN,
    strategyConfig.costBps,
    config.initialCapital,
    {
      deepPullbackThreshold: strategyConfig.deepPullbackThreshold ?? undefined,
      cooldownLossThreshold: strategyConfig.cooldownLossThreshold ?? undefined,
      cooldownTradingDays: strategyConfig.cooldownDays ?? undefined,
    },
  );
  const metrics = computeProfitMetrics(sim.equityCurve, sim.trades, config.initialCapital, benchmarkMetrics, sim.turnoverNotional);
  return {
    metrics: toDecisionMetrics(metrics, profitVerdict(metrics, benchmarkMetrics, config.minTradesForCandidate), {
      averageHoldingsPerRebalance: sim.averageHoldingsPerRebalance,
      skippedCandidates: sim.skippedCandidates,
      skippedRebalances: sim.skippedRebalances,
    }),
    benchmarkMetrics,
    baselineSma20Metrics,
  };
}

export function expandDecisionConfigGrid(config: RequiredConfig): DecisionStrategyConfig[] {
  const configs: DecisionStrategyConfig[] = [];
  const add = (base: Omit<DecisionStrategyConfig, 'configId'>): void => {
    const threshold = base.deepPullbackThreshold === null ? 'none' : String(base.deepPullbackThreshold);
    const cooldown = base.cooldownLossThreshold === null ? 'none' : `${base.cooldownLossThreshold}_${base.cooldownDays}`;
    configs.push({
      ...base,
      configId: `${base.variantId}_top${base.topN}_${base.costBps}bps_dd${threshold}_sector${base.sectorCap}_cooldown${cooldown}`,
    });
  };

  for (const topN of config.topNs) {
    for (const costBps of config.costBpsValues) {
      add({ variantId: 'baseline', riskControlVariantId: 'baseline', topN, costBps, deepPullbackThreshold: null, sectorCap: 'none', cooldownLossThreshold: null, cooldownDays: null });
      add({ variantId: 'sector_cap_one', riskControlVariantId: 'sector_cap_one', topN, costBps, deepPullbackThreshold: null, sectorCap: 'one_per_sector', cooldownLossThreshold: null, cooldownDays: null });
      for (const threshold of config.deepPullbackThresholds) {
        add({ variantId: 'avoid_deep_pullback', riskControlVariantId: 'avoid_deep_pullback', topN, costBps, deepPullbackThreshold: threshold, sectorCap: 'none', cooldownLossThreshold: null, cooldownDays: null });
        add({ variantId: 'avoid_deep_pullback_plus_sector_cap', riskControlVariantId: 'avoid_deep_pullback_plus_sector_cap', topN, costBps, deepPullbackThreshold: threshold, sectorCap: 'one_per_sector', cooldownLossThreshold: null, cooldownDays: null });
        add({ variantId: 'avoid_deep_pullback_plus_cooldown', riskControlVariantId: 'avoid_deep_pullback_plus_cooldown', topN, costBps, deepPullbackThreshold: threshold, sectorCap: 'none', cooldownLossThreshold: -0.08, cooldownDays: 20 });
      }
    }
  }
  return configs;
}

const VERDICT_SCORE: Record<ProfitVerdict, number> = {
  research_candidate: 3,
  weak: 2,
  reject: 1,
  expand_universe: 0,
};

function compareForSelection(a: { config: DecisionStrategyConfig; metrics: DecisionMetrics }, b: { config: DecisionStrategyConfig; metrics: DecisionMetrics }): number {
  return (
    VERDICT_SCORE[b.metrics.profitVerdict] - VERDICT_SCORE[a.metrics.profitVerdict] ||
    (b.metrics.Sharpe ?? Number.NEGATIVE_INFINITY) - (a.metrics.Sharpe ?? Number.NEGATIVE_INFINITY) ||
    Math.abs(a.metrics.maxDrawdown) - Math.abs(b.metrics.maxDrawdown) ||
    (b.metrics.benchmarkRelativeReturn ?? Number.NEGATIVE_INFINITY) - (a.metrics.benchmarkRelativeReturn ?? Number.NEGATIVE_INFINITY) ||
    b.config.costBps - a.config.costBps ||
    b.config.topN - a.config.topN ||
    a.config.configId.localeCompare(b.config.configId)
  );
}

export function selectBestTrainConfig(evaluated: Array<{ config: DecisionStrategyConfig; metrics: DecisionMetrics }>): { config: DecisionStrategyConfig; metrics: DecisionMetrics } {
  if (!evaluated.length) throw new Error('Cannot select train config from an empty evaluation set.');
  return [...evaluated].sort(compareForSelection)[0];
}

function windowArtifact(artifact: PriceFeatureLabelArtifact, window: DecisionWindow): PriceFeatureLabelArtifact {
  return splitArtifact(artifact, window.startDate, window.endDate);
}

function walkForwardWindows(): WalkForwardWindow[] {
  return [
    { windowId: 'wf_2023', train: { windowId: 'train_2021_2022', startDate: '2021-01-04', endDate: '2022-12-31' }, test: { windowId: 'test_2023', startDate: '2023-01-01', endDate: '2023-12-31' } },
    { windowId: 'wf_2024', train: { windowId: 'train_2021_2023', startDate: '2021-01-04', endDate: '2023-12-31' }, test: { windowId: 'test_2024', startDate: '2024-01-01', endDate: '2024-12-31' } },
    { windowId: 'wf_2025', train: { windowId: 'train_2021_2024', startDate: '2021-01-04', endDate: '2024-12-31' }, test: { windowId: 'test_2025', startDate: '2025-01-01', endDate: '2025-12-31' } },
    { windowId: 'wf_2026_ytd', train: { windowId: 'train_2021_2025', startDate: '2021-01-04', endDate: '2025-12-31' }, test: { windowId: 'test_2026_ytd', startDate: '2026-01-01', endDate: '2026-04-24' } },
  ];
}

function fixedHoldoutSummary(
  artifact: PriceFeatureLabelArtifact,
  config: RequiredConfig,
  configs: DecisionStrategyConfig[],
): Sma20DecisionReport['fixedHoldoutSummary'] {
  const holdout = windowArtifact(artifact, { windowId: 'holdout', ...config.holdoutWindow });
  const evaluated = configs.map((strategyConfig) => ({ config: strategyConfig, ...evaluateConfig(holdout, config, strategyConfig) }));
  const bySharpe = [...evaluated].sort((a, b) => (b.metrics.Sharpe ?? Number.NEGATIVE_INFINITY) - (a.metrics.Sharpe ?? Number.NEGATIVE_INFINITY) || a.config.configId.localeCompare(b.config.configId))[0] ?? null;
  const byRelative = [...evaluated].sort((a, b) => (b.metrics.benchmarkRelativeReturn ?? Number.NEGATIVE_INFINITY) - (a.metrics.benchmarkRelativeReturn ?? Number.NEGATIVE_INFINITY) || a.config.configId.localeCompare(b.config.configId))[0] ?? null;
  return {
    researchWindow: { windowId: 'research', ...config.researchWindow },
    holdoutWindow: { windowId: 'holdout', ...config.holdoutWindow },
    bestHoldoutConfigBySharpe: bySharpe?.config ?? null,
    bestHoldoutResultBySharpe: bySharpe?.metrics ?? null,
    bestHoldoutConfigByBenchmarkRelativeReturn: byRelative?.config ?? null,
    bestHoldoutResultByBenchmarkRelativeReturn: byRelative?.metrics ?? null,
  };
}

function buildWalkForwardResults(
  artifact: PriceFeatureLabelArtifact,
  config: RequiredConfig,
  configs: DecisionStrategyConfig[],
): WalkForwardResult[] {
  return walkForwardWindows().map((window) => {
    const trainArtifact = windowArtifact(artifact, window.train);
    const testArtifact = windowArtifact(artifact, window.test);
    const trainEvaluated = configs.map((strategyConfig) => ({
      config: strategyConfig,
      metrics: evaluateConfig(trainArtifact, config, strategyConfig).metrics,
    }));
    const selected = selectBestTrainConfig(trainEvaluated);
    const test = evaluateConfig(testArtifact, config, selected.config);
    return {
      windowId: window.windowId,
      trainWindow: window.train,
      testWindow: window.test,
      selectedConfig: selected.config,
      trainMetrics: selected.metrics,
      testMetrics: test.metrics,
      benchmarkMetrics: test.benchmarkMetrics,
      baselineSma20Metrics: test.baselineSma20Metrics,
    };
  });
}

function stringifyKey(value: number | string | null): string {
  return value === null ? 'none' : String(value);
}

function countString(values: string[]): Record<string, number> {
  const keys = Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
  return Object.fromEntries(keys.map((key) => [key, values.filter((value) => value === key).length]));
}

export function summarizeParameterStability(results: WalkForwardResult[]): Sma20DecisionSummary['parameterStability'] {
  return {
    selectedTopNCounts: countString(results.map((result) => String(result.selectedConfig.topN))),
    selectedThresholdCounts: countString(results.map((result) => stringifyKey(result.selectedConfig.deepPullbackThreshold))),
    selectedSectorCapCounts: countBy(results.map((result) => result.selectedConfig.sectorCap), ['none', 'one_per_sector']),
    selectedCooldownCounts: countString(results.map((result) => stringifyKey(result.selectedConfig.cooldownLossThreshold))),
  };
}

function summaryFor(configs: DecisionStrategyConfig[], results: WalkForwardResult[]): Sma20DecisionSummary {
  const testSharpes = results.map((result) => result.testMetrics.Sharpe).filter((value): value is number => value !== null);
  const trainSharpes = results.map((result) => result.trainMetrics.Sharpe).filter((value): value is number => value !== null);
  const testRelative = results.map((result) => result.testMetrics.benchmarkRelativeReturn).filter((value): value is number => value !== null);
  const trainRelative = results.map((result) => result.trainMetrics.benchmarkRelativeReturn).filter((value): value is number => value !== null);
  const parameterStability = summarizeParameterStability(results);
  const costValues = Array.from(new Set(results.map((result) => result.selectedConfig.costBps))).sort((a, b) => a - b);
  const summaryBase = {
    totalConfigsTested: configs.length,
    walkForwardWindows: results.length,
    positiveBenchmarkRelativeReturnWindows: results.filter((result) => (result.testMetrics.benchmarkRelativeReturn ?? 0) > 0).length,
    sharpeBeatsBenchmarkWindows: results.filter((result) => (result.testMetrics.Sharpe ?? Number.NEGATIVE_INFINITY) > (result.benchmarkMetrics.Sharpe ?? Number.NEGATIVE_INFINITY)).length,
    maxDrawdownBetterThanBenchmarkWindows: results.filter((result) => Math.abs(result.testMetrics.maxDrawdown) <= Math.abs(result.benchmarkMetrics.maxDrawdown)).length,
    researchCandidateTestWindows: results.filter((result) => result.testMetrics.profitVerdict === 'research_candidate').length,
    weakOrBetterTestWindows: results.filter((result) => result.testMetrics.profitVerdict === 'weak' || result.testMetrics.profitVerdict === 'research_candidate').length,
    averageTestSharpe: roundFinite(mean(testSharpes)),
    medianTestSharpe: roundFinite(median(testSharpes)),
    averageTestBenchmarkRelativeReturn: roundFinite(mean(testRelative)),
    medianTestBenchmarkRelativeReturn: roundFinite(median(testRelative)),
    worstTestMaxDrawdown: roundFinite(Math.min(...results.map((result) => result.testMetrics.maxDrawdown))) ?? 0,
    costRobustness: {
      selectedCostBpsValues: costValues,
      selectedAnyCostBpsAtLeast10: costValues.some((value) => value >= 10),
      selectedAnyCostBpsAtLeast25: costValues.some((value) => value >= 25),
      selectedTestResearchCandidateAt10Bps: results.some((result) => result.selectedConfig.costBps >= 10 && result.testMetrics.profitVerdict === 'research_candidate'),
      selectedTestResearchCandidateAt25Bps: results.some((result) => result.selectedConfig.costBps >= 25 && result.testMetrics.profitVerdict === 'research_candidate'),
    },
    parameterStability,
    degradation: {
      averageTrainSharpeMinusAverageTestSharpe: roundFinite((mean(trainSharpes) ?? 0) - (mean(testSharpes) ?? 0)),
      averageTrainBenchmarkRelativeReturnMinusAverageTestBenchmarkRelativeReturn: roundFinite((mean(trainRelative) ?? 0) - (mean(testRelative) ?? 0)),
    },
  };
  const verdict = finalDecisionVerdict(summaryBase);
  return {
    ...summaryBase,
    finalDecisionVerdict: verdict,
    finalRecommendation: recommendationFor(verdict),
  };
}

export function finalDecisionVerdict(summary: Pick<Sma20DecisionSummary,
  'researchCandidateTestWindows' | 'weakOrBetterTestWindows' | 'averageTestBenchmarkRelativeReturn' | 'maxDrawdownBetterThanBenchmarkWindows' | 'walkForwardWindows' | 'costRobustness'
>): FinalDecisionVerdict {
  if (
    summary.researchCandidateTestWindows >= 2 &&
    summary.weakOrBetterTestWindows >= 3 &&
    (summary.averageTestBenchmarkRelativeReturn ?? 0) > 0 &&
    summary.maxDrawdownBetterThanBenchmarkWindows === summary.walkForwardWindows &&
    summary.costRobustness.selectedAnyCostBpsAtLeast10
  ) {
    return 'continue_sma20_research';
  }
  if (
    summary.weakOrBetterTestWindows < 2 ||
    (summary.averageTestBenchmarkRelativeReturn ?? 0) <= 0 ||
    summary.maxDrawdownBetterThanBenchmarkWindows === 0
  ) {
    return 'stop_sma20_price_only';
  }
  if (
    summary.researchCandidateTestWindows < 2 &&
    summary.weakOrBetterTestWindows >= 2 &&
    (summary.averageTestBenchmarkRelativeReturn ?? 0) > 0 &&
    summary.maxDrawdownBetterThanBenchmarkWindows > 0
  ) {
    return 'pivot_to_new_features';
  }
  return 'stop_sma20_price_only';
}

function recommendationFor(verdict: FinalDecisionVerdict): FinalDecisionRecommendation {
  if (verdict === 'continue_sma20_research') return 'continue_with_sma20_risk_control_research';
  if (verdict === 'pivot_to_new_features') return 'pivot_to_feature_engineering_and_new_signals';
  return 'stop_price_only_sma20_research';
}

interface RequiredConfig {
  inputPath: string | null;
  initialCapital: number;
  topNs: number[];
  costBpsValues: number[];
  deepPullbackThresholds: number[];
  minTradesForCandidate: number;
  researchWindow: { startDate: string; endDate: string };
  holdoutWindow: { startDate: string; endDate: string };
}

function normalizeConfig(config: Sma20DecisionConfig): RequiredConfig {
  validateSma20DecisionConfig(config);
  return {
    inputPath: config.inputPath ? path.resolve(config.inputPath) : null,
    initialCapital: config.initialCapital ?? DEFAULT_INITIAL_CAPITAL,
    topNs: [...(config.topNs ?? DEFAULT_TOP_NS)],
    costBpsValues: [...(config.costBpsValues ?? DEFAULT_COST_BPS_VALUES)],
    deepPullbackThresholds: [...(config.deepPullbackThresholds ?? DEFAULT_DEEP_PULLBACK_THRESHOLDS)],
    minTradesForCandidate: config.minTradesForCandidate ?? DEFAULT_MIN_TRADES_FOR_CANDIDATE,
    researchWindow: config.researchWindow ?? DEFAULT_RESEARCH_WINDOW,
    holdoutWindow: config.holdoutWindow ?? DEFAULT_HOLDOUT_WINDOW,
  };
}

export function validateSma20DecisionConfig(config: Sma20DecisionConfig): void {
  assertPositiveNumber(config.initialCapital, 'initialCapital');
  assertNonNegativeInteger(config.minTradesForCandidate, 'minTradesForCandidate');
  for (const topN of config.topNs ?? DEFAULT_TOP_NS) assertPositiveInteger(topN, 'topNs');
  for (const costBps of config.costBpsValues ?? DEFAULT_COST_BPS_VALUES) assertNonNegativeNumber(costBps, 'costBpsValues');
  const thresholds = config.deepPullbackThresholds ?? DEFAULT_DEEP_PULLBACK_THRESHOLDS;
  if (!thresholds.length) throw new Error('Invalid deepPullbackThresholds: expected at least one threshold.');
  for (const threshold of thresholds) {
    if (!Number.isFinite(threshold) || threshold >= 0) {
      throw new Error(`Invalid value for deepPullbackThresholds: ${threshold}. Expected a negative number.`);
    }
  }
  const researchWindow = config.researchWindow ?? DEFAULT_RESEARCH_WINDOW;
  const holdoutWindow = config.holdoutWindow ?? DEFAULT_HOLDOUT_WINDOW;
  validateDateWindow(researchWindow, 'research');
  validateDateWindow(holdoutWindow, 'holdout');
  validateNonOverlappingWindows(researchWindow, holdoutWindow, 'decision split');
}

export function buildSma20DecisionReport(
  artifact: PriceFeatureLabelArtifact,
  config: Sma20DecisionConfig = {},
): Sma20DecisionReport {
  const normalized = normalizeConfig(config);
  const configs = expandDecisionConfigGrid(normalized);
  const fixedHoldout = fixedHoldoutSummary(artifact, normalized, configs);
  const walkForwardResults = buildWalkForwardResults(artifact, normalized, configs);
  const summary = summaryFor(configs, walkForwardResults);
  return {
    generatedAt: new Date().toISOString(),
    lane: 'research_only',
    reportType: 'research_sma20_walkforward_decision_report',
    schemaVersion: 'research_sma20_walkforward_decision_report_v1',
    artifactCoverage: {
      rowCount: artifact.summary.rowCount,
      tickerCount: artifact.summary.tickers.length,
      firstDate: artifact.summary.firstDate,
      lastDate: artifact.summary.lastDate,
    },
    configGrid: {
      topNs: normalized.topNs,
      costBpsValues: normalized.costBpsValues,
      deepPullbackThresholds: normalized.deepPullbackThresholds,
      sectorCaps: ['none', 'one_per_sector'],
      cooldownLossThresholds: [null, -0.08],
      totalConfigsTested: configs.length,
      configs,
    },
    fixedHoldoutSummary: fixedHoldout,
    walkForwardResults,
    selectedConfigs: walkForwardResults.map((result) => result.selectedConfig),
    benchmarkComparisons: walkForwardResults.map((result) => ({
      windowId: result.windowId,
      testBenchmarkMetrics: result.benchmarkMetrics,
      selectedTestMetrics: result.testMetrics,
      baselineSma20Metrics: result.baselineSma20Metrics,
    })),
    parameterStability: summary.parameterStability,
    summary,
    finalDecision: {
      verdict: summary.finalDecisionVerdict,
      recommendation: summary.finalRecommendation,
    },
    warnings: [
      'Research-only historical simulation. Not production evidence and not trading advice.',
      'No live trading, model training, production policy tuning, auto-trading, or runDailyScan behavior changes are performed.',
      'Uses the same 31-ticker expanded universe and Yahoo-derived local price-feature artifact only.',
      'The 2026 walk-forward test window is a short partial-year period.',
      'No survivorship-bias control is applied beyond the chosen liquid universe.',
      'Transaction costs are simplified fixed-bps assumptions.',
      'Equal-weight buy-and-hold and baseline SMA20 are implemented; equal-weight weekly rebalance and topN=6 buy-hold basket are not implemented in v1.',
    ],
  };
}

export async function loadPriceFeatureArtifactForSma20Decision(inputPath: string): Promise<PriceFeatureLabelArtifact> {
  return JSON.parse(await readFile(path.resolve(inputPath), 'utf8')) as PriceFeatureLabelArtifact;
}

function defaultOutputPath(now = new Date()): string {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  return path.join(process.cwd(), '.dexter', 'signal-engine', 'research', 'analysis', `sma20-walkforward-decision-report-${stamp}.json`);
}

export async function persistSma20DecisionReport(report: Sma20DecisionReport, outputPath?: string): Promise<string> {
  const target = path.resolve(outputPath ?? defaultOutputPath());
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return target;
}
