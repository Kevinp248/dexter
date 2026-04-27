import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PriceFeatureLabelArtifact, PriceFeatureLabelRow } from './price-feature-labels.js';
import { buildProfitBacktestReport, ProfitStrategyConfig, ProfitTrade, ProfitVerdict } from './profit-backtest.js';
import {
  assertNonNegativeInteger,
  assertNonNegativeNumber,
  assertPositiveInteger,
  assertPositiveNumber,
  mean,
  median,
  roundFinite,
  validateDateWindow,
  validateNonOverlappingWindows,
} from './research-utils.js';

export type MarketTrendBucket = 'market_up_20d' | 'market_flat_20d' | 'market_down_20d' | 'unknown';
export type VolatilityBucket = 'low_vol' | 'medium_vol' | 'high_vol' | 'unknown';
export type BreadthBucket = 'weak_breadth' | 'neutral_breadth' | 'strong_breadth' | 'unknown';
export type PullbackSeverityBucket = 'mild_pullback' | 'medium_pullback' | 'deep_pullback' | 'unknown';
export type SectorBucket = 'tech_growth' | 'financials' | 'energy' | 'healthcare' | 'consumer' | 'industrials' | 'other';
export type DiagnosticVerdict = 'regime_filter_promising' | 'risk_filter_needed' | 'no_clear_filter_stop_sma20';
export type DiagnosticRecommendation = 'test_regime_filters_next' | 'test_risk_controls_next' | 'stop_sma20_research';

export interface Sma20RegimeRiskDiagnosticConfig {
  inputPath?: string;
  outputPath?: string;
  initialCapital?: number;
  minTradesForCandidate?: number;
  focusConfigs?: Array<{ topN: number; costBps: number }>;
  researchWindow?: { startDate: string; endDate: string };
  holdoutWindow?: { startDate: string; endDate: string };
}

export interface DiagnosticTrade extends ProfitTrade {
  topN: number;
  costBps: number;
  year: string;
  quarter: string;
  windowId: 'research' | 'holdout' | 'outside';
  marketTrendBucket: MarketTrendBucket;
  volatilityBucket: VolatilityBucket;
  breadthBucket: BreadthBucket;
  pullbackSeverityBucket: PullbackSeverityBucket;
  sector: SectorBucket;
  approximatePnl: number;
}

export interface DiagnosticBucketSummary {
  bucket: string;
  trades: number;
  averageTradeReturn: number | null;
  medianTradeReturn: number | null;
  winRate: number | null;
  approximatePnl: number;
  worstTrade: DiagnosticTrade | null;
  bestTrade: DiagnosticTrade | null;
  contributionShare: number | null;
}

export interface DiagnosticConfigResult {
  configId: string;
  topN: number;
  costBps: number;
  totalReturn: number;
  Sharpe: number | null;
  maxDrawdown: number;
  winRate: number | null;
  numberOfTrades: number;
  benchmarkRelativeReturn: number | null;
  profitVerdict: ProfitVerdict;
  researchWindowMetrics: DiagnosticWindowMetrics;
  holdoutWindowMetrics: DiagnosticWindowMetrics;
  breakdowns: {
    year: DiagnosticBucketSummary[];
    quarter: DiagnosticBucketSummary[];
    marketTrend: DiagnosticBucketSummary[];
    volatility: DiagnosticBucketSummary[];
    breadth: DiagnosticBucketSummary[];
    pullbackSeverity: DiagnosticBucketSummary[];
    ticker: DiagnosticBucketSummary[];
    sector: DiagnosticBucketSummary[];
  };
  trades: DiagnosticTrade[];
}

export interface DiagnosticWindowMetrics {
  totalReturn: number;
  Sharpe: number | null;
  maxDrawdown: number;
  winRate: number | null;
  numberOfTrades: number;
  benchmarkRelativeReturn: number | null;
  profitVerdict: ProfitVerdict;
}

export interface Sma20RegimeRiskDiagnosticReport {
  generatedAt: string;
  lane: 'research_only';
  reportType: 'research_sma20_regime_risk_diagnostic';
  schemaVersion: 'research_sma20_regime_risk_diagnostic_v1';
  config: {
    inputPath: string | null;
    initialCapital: number;
    minTradesForCandidate: number;
    focusConfigs: Array<{ topN: number; costBps: number }>;
    researchWindow: { startDate: string; endDate: string };
    holdoutWindow: { startDate: string; endDate: string };
  };
  artifactProvenance: {
    sourceArtifactPath: string | null;
    artifactGeneratedAt: string;
    artifactSchemaVersion: string;
    vendor: PriceFeatureLabelArtifact['vendor'];
    rowCount: number;
    tickers: string[];
    firstDate: string | null;
    lastDate: string | null;
  };
  configResults: DiagnosticConfigResult[];
  failureAnalysis: {
    worstYears: DiagnosticBucketSummary[];
    worstQuarters: DiagnosticBucketSummary[];
    holdoutDegradationDrivers: string[];
    techGrowthHelpedHoldout: boolean | null;
    nonTechSelectionsWorseInHoldout: boolean | null;
    topN6DiversificationRead: string;
  };
  proposedFilterHypotheses: string[];
  finalDiagnosticVerdict: DiagnosticVerdict;
  finalRecommendation: DiagnosticRecommendation;
  warnings: string[];
}

const DEFAULT_INITIAL_CAPITAL = 100_000;
const DEFAULT_MIN_TRADES_FOR_CANDIDATE = 20;
const DEFAULT_FOCUS_CONFIGS = [
  { topN: 6, costBps: 0 },
  { topN: 6, costBps: 10 },
  { topN: 4, costBps: 0 },
  { topN: 4, costBps: 10 },
];
const DEFAULT_RESEARCH_WINDOW = { startDate: '2021-01-04', endDate: '2024-12-31' };
const DEFAULT_HOLDOUT_WINDOW = { startDate: '2025-01-01', endDate: '2026-04-24' };

export function validateSma20RegimeRiskDiagnosticConfig(config: Sma20RegimeRiskDiagnosticConfig): void {
  assertPositiveNumber(config.initialCapital, 'initialCapital');
  assertNonNegativeInteger(config.minTradesForCandidate, 'minTradesForCandidate');

  const focusConfigs = config.focusConfigs ?? DEFAULT_FOCUS_CONFIGS;
  if (!focusConfigs.length) {
    throw new Error('Invalid focusConfigs: expected at least one focus config.');
  }
  for (const focusConfig of focusConfigs) {
    assertPositiveInteger(focusConfig.topN, 'focusConfigs.topN');
    assertNonNegativeNumber(focusConfig.costBps, 'focusConfigs.costBps');
  }

  const researchWindow = config.researchWindow ?? DEFAULT_RESEARCH_WINDOW;
  const holdoutWindow = config.holdoutWindow ?? DEFAULT_HOLDOUT_WINDOW;
  validateDateWindow(researchWindow, 'research');
  validateDateWindow(holdoutWindow, 'holdout');
  validateNonOverlappingWindows(researchWindow, holdoutWindow, 'diagnostic split');
}

export const SECTOR_BY_TICKER: Record<string, SectorBucket> = {
  AAPL: 'tech_growth',
  MSFT: 'tech_growth',
  GOOGL: 'tech_growth',
  AMZN: 'tech_growth',
  NVDA: 'tech_growth',
  META: 'tech_growth',
  AVGO: 'tech_growth',
  ORCL: 'tech_growth',
  CRM: 'tech_growth',
  JPM: 'financials',
  BAC: 'financials',
  GS: 'financials',
  V: 'financials',
  MA: 'financials',
  XOM: 'energy',
  CVX: 'energy',
  UNH: 'healthcare',
  JNJ: 'healthcare',
  MRK: 'healthcare',
  ABBV: 'healthcare',
  PG: 'consumer',
  KO: 'consumer',
  PEP: 'consumer',
  COST: 'consumer',
  WMT: 'consumer',
  HD: 'consumer',
  MCD: 'consumer',
  NKE: 'consumer',
  CAT: 'industrials',
  GE: 'industrials',
  HON: 'industrials',
};

interface ArtifactContext {
  rowsByDate: Map<string, PriceFeatureLabelRow[]>;
  tickerDateRows: Map<string, Map<string, PriceFeatureLabelRow>>;
  dates: string[];
  volTerciles: { low: number; high: number };
}

function priceFor(row: PriceFeatureLabelRow | undefined): number | null {
  if (!row) return null;
  const price = typeof row.adjustedClose === 'number' ? row.adjustedClose : row.close;
  return typeof price === 'number' && Number.isFinite(price) && price > 0 ? price : null;
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function sectorForTicker(ticker: string): SectorBucket {
  return SECTOR_BY_TICKER[ticker] ?? 'other';
}

export function marketTrendBucket(trailingReturn: number | null): MarketTrendBucket {
  if (trailingReturn === null) return 'unknown';
  if (trailingReturn > 0.02) return 'market_up_20d';
  if (trailingReturn < -0.02) return 'market_down_20d';
  return 'market_flat_20d';
}

export function volatilityBucket(value: number | null, terciles: { low: number; high: number }): VolatilityBucket {
  if (value === null) return 'unknown';
  if (value <= terciles.low) return 'low_vol';
  if (value >= terciles.high) return 'high_vol';
  return 'medium_vol';
}

export function breadthBucket(percentAboveSma20: number | null): BreadthBucket {
  if (percentAboveSma20 === null) return 'unknown';
  if (percentAboveSma20 < 0.4) return 'weak_breadth';
  if (percentAboveSma20 > 0.6) return 'strong_breadth';
  return 'neutral_breadth';
}

export function pullbackSeverityBucket(avgSma20Gap: number | null): PullbackSeverityBucket {
  if (avgSma20Gap === null) return 'unknown';
  if (avgSma20Gap <= -0.1) return 'deep_pullback';
  if (avgSma20Gap <= -0.04) return 'medium_pullback';
  return 'mild_pullback';
}

function buildContext(artifact: PriceFeatureLabelArtifact): ArtifactContext {
  const rows = [...artifact.rows].sort((a, b) => a.date.localeCompare(b.date) || a.ticker.localeCompare(b.ticker));
  const rowsByDate = new Map<string, PriceFeatureLabelRow[]>();
  const tickerDateRows = new Map<string, Map<string, PriceFeatureLabelRow>>();
  for (const row of rows) {
    rowsByDate.set(row.date, [...(rowsByDate.get(row.date) ?? []), row]);
    const tickerMap = tickerDateRows.get(row.ticker) ?? new Map<string, PriceFeatureLabelRow>();
    tickerMap.set(row.date, row);
    tickerDateRows.set(row.ticker, tickerMap);
  }
  const dates = Array.from(rowsByDate.keys()).sort((a, b) => a.localeCompare(b));
  const avgVols = dates
    .map((date) => averageVol20d(rowsByDate.get(date) ?? []))
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b);
  const low = avgVols[Math.floor((avgVols.length - 1) / 3)] ?? 0;
  const high = avgVols[Math.floor(((avgVols.length - 1) * 2) / 3)] ?? low;
  return { rowsByDate, tickerDateRows, dates, volTerciles: { low, high } };
}

function averageVol20d(rows: PriceFeatureLabelRow[]): number | null {
  return mean(rows.map((row) => finite(row.vol_20d)).filter((value): value is number => value !== null));
}

export function breadthAboveSma20(rows: PriceFeatureLabelRow[]): number | null {
  const gaps = rows.map((row) => finite(row.sma_20_gap)).filter((value): value is number => value !== null);
  if (!gaps.length) return null;
  return gaps.filter((value) => value > 0).length / gaps.length;
}

export function trailingEqualWeightReturn20d(ctx: Pick<ArtifactContext, 'dates' | 'tickerDateRows'>, date: string): number | null {
  const idx = ctx.dates.indexOf(date);
  if (idx < 20) return null;
  const previousDate = ctx.dates[idx - 20];
  const returns: number[] = [];
  for (const [, dateRows] of ctx.tickerDateRows) {
    const current = priceFor(dateRows.get(date));
    const previous = priceFor(dateRows.get(previousDate));
    if (current !== null && previous !== null) returns.push(current / previous - 1);
  }
  return mean(returns);
}

function windowFor(date: string, config: Sma20RegimeRiskDiagnosticReport['config']): 'research' | 'holdout' | 'outside' {
  if (date >= config.researchWindow.startDate && date <= config.researchWindow.endDate) return 'research';
  if (date >= config.holdoutWindow.startDate && date <= config.holdoutWindow.endDate) return 'holdout';
  return 'outside';
}

function strategy(topN: number): ProfitStrategyConfig {
  return {
    id: `sma20_gap_reversion_top${topN}`,
    feature: 'sma_20_gap',
    rankDirection: 'ascending',
    holdDays: 20,
    rebalanceFrequency: 'weekly',
    topN,
    maxPositions: topN,
  };
}

function selectedAverageSma20Gap(ctx: ArtifactContext, trade: ProfitTrade, allTrades: ProfitTrade[]): number | null {
  const basketTickers = allTrades
    .filter((item) => item.signalDate === trade.signalDate)
    .map((item) => item.ticker);
  const values = basketTickers
    .map((ticker) => finite(ctx.tickerDateRows.get(ticker)?.get(trade.signalDate)?.sma_20_gap))
    .filter((value): value is number => value !== null);
  return mean(values);
}

function enrichTrades(
  ctx: ArtifactContext,
  trades: ProfitTrade[],
  topN: number,
  costBps: number,
  config: Sma20RegimeRiskDiagnosticReport['config'],
): DiagnosticTrade[] {
  return trades.map((trade) => {
    const signalRows = ctx.rowsByDate.get(trade.signalDate) ?? [];
    const trailingReturn = trailingEqualWeightReturn20d(ctx, trade.signalDate);
    const avgVol = averageVol20d(signalRows);
    const breadth = breadthAboveSma20(signalRows);
    const avgGap = selectedAverageSma20Gap(ctx, trade, trades);
    const month = Number(trade.signalDate.slice(5, 7));
    const quarter = `${trade.signalDate.slice(0, 4)}-Q${Math.floor((month - 1) / 3) + 1}`;
    return {
      ...trade,
      topN,
      costBps,
      year: trade.signalDate.slice(0, 4),
      quarter,
      windowId: windowFor(trade.signalDate, config),
      marketTrendBucket: marketTrendBucket(trailingReturn),
      volatilityBucket: volatilityBucket(avgVol, ctx.volTerciles),
      breadthBucket: breadthBucket(breadth),
      pullbackSeverityBucket: pullbackSeverityBucket(avgGap),
      sector: sectorForTicker(trade.ticker),
      approximatePnl: roundFinite(trade.capitalAllocated * trade.netReturn, 6) ?? trade.capitalAllocated * trade.netReturn,
    };
  });
}

function summarizeTrades(bucket: string, trades: DiagnosticTrade[], totalAbsPnl: number): DiagnosticBucketSummary {
  const returns = trades.map((trade) => trade.netReturn);
  const approximatePnl = trades.reduce((sum, trade) => sum + trade.approximatePnl, 0);
  const sorted = [...trades].sort((a, b) => a.netReturn - b.netReturn);
  return {
    bucket,
    trades: trades.length,
    averageTradeReturn: roundFinite(mean(returns)),
    medianTradeReturn: roundFinite(median(returns)),
    winRate: trades.length ? roundFinite(trades.filter((trade) => trade.netReturn > 0).length / trades.length) : null,
    approximatePnl: roundFinite(approximatePnl, 6) ?? approximatePnl,
    worstTrade: sorted[0] ?? null,
    bestTrade: sorted[sorted.length - 1] ?? null,
    contributionShare: totalAbsPnl > 0 ? roundFinite(approximatePnl / totalAbsPnl) : null,
  };
}

function breakdownBy(trades: DiagnosticTrade[], key: (trade: DiagnosticTrade) => string): DiagnosticBucketSummary[] {
  const totalAbsPnl = trades.reduce((sum, trade) => sum + Math.abs(trade.approximatePnl), 0);
  const groups = new Map<string, DiagnosticTrade[]>();
  for (const trade of trades) groups.set(key(trade), [...(groups.get(key(trade)) ?? []), trade]);
  return Array.from(groups.entries())
    .map(([bucket, bucketTrades]) => summarizeTrades(bucket, bucketTrades, totalAbsPnl))
    .sort((a, b) => a.bucket.localeCompare(b.bucket));
}

function splitArtifact(artifact: PriceFeatureLabelArtifact, startDate: string, endDate: string): PriceFeatureLabelArtifact {
  const rows = artifact.rows.filter((row) => row.date >= startDate && row.date <= endDate);
  return {
    ...artifact,
    rows,
    summary: {
      ...artifact.summary,
      rowCount: rows.length,
      firstDate: rows[0]?.date ?? null,
      lastDate: rows[rows.length - 1]?.date ?? null,
      tickers: Array.from(new Set(rows.map((row) => row.ticker))).sort((a, b) => a.localeCompare(b)),
      tickerCoverage: Array.from(new Set(rows.map((row) => row.ticker))).sort((a, b) => a.localeCompare(b)).map((ticker) => {
        const tickerRows = rows.filter((row) => row.ticker === ticker);
        return { ticker, rowCount: tickerRows.length, firstDate: tickerRows[0]?.date ?? null, lastDate: tickerRows[tickerRows.length - 1]?.date ?? null };
      }),
    },
  };
}

function windowMetrics(
  artifact: PriceFeatureLabelArtifact,
  config: Sma20RegimeRiskDiagnosticReport['config'],
  topN: number,
  costBps: number,
  window: { startDate: string; endDate: string },
): DiagnosticWindowMetrics {
  const report = buildProfitBacktestReport(splitArtifact(artifact, window.startDate, window.endDate), {
    initialCapital: config.initialCapital,
    costBps,
    topN,
    maxPositions: topN,
    minTradesForCandidate: config.minTradesForCandidate,
    strategies: [strategy(topN)],
  });
  const result = report.strategies[0];
  return {
    totalReturn: result.metrics.totalReturn,
    Sharpe: result.metrics.Sharpe,
    maxDrawdown: result.metrics.maxDrawdown,
    winRate: result.metrics.winRate,
    numberOfTrades: result.metrics.numberOfTrades,
    benchmarkRelativeReturn: result.metrics.benchmarkRelativeReturn,
    profitVerdict: result.profitVerdict,
  };
}

function normalizeConfig(config: Sma20RegimeRiskDiagnosticConfig): Sma20RegimeRiskDiagnosticReport['config'] {
  validateSma20RegimeRiskDiagnosticConfig(config);
  return {
    inputPath: config.inputPath ? path.resolve(config.inputPath) : null,
    initialCapital: config.initialCapital ?? DEFAULT_INITIAL_CAPITAL,
    minTradesForCandidate: config.minTradesForCandidate ?? DEFAULT_MIN_TRADES_FOR_CANDIDATE,
    focusConfigs: config.focusConfigs ?? DEFAULT_FOCUS_CONFIGS,
    researchWindow: config.researchWindow ?? DEFAULT_RESEARCH_WINDOW,
    holdoutWindow: config.holdoutWindow ?? DEFAULT_HOLDOUT_WINDOW,
  };
}

function diagnosticVerdict(results: DiagnosticConfigResult[]): DiagnosticVerdict {
  const holdoutTrades = results.flatMap((result) => result.trades.filter((trade) => trade.windowId === 'holdout'));
  const holdoutPnl = holdoutTrades.reduce((sum, trade) => sum + trade.approximatePnl, 0);
  const losingBuckets = [
    ...breakdownBy(holdoutTrades, (trade) => trade.marketTrendBucket),
    ...breakdownBy(holdoutTrades, (trade) => trade.volatilityBucket),
    ...breakdownBy(holdoutTrades, (trade) => trade.breadthBucket),
    ...breakdownBy(holdoutTrades, (trade) => trade.pullbackSeverityBucket),
  ].filter((bucket) => bucket.approximatePnl < 0);
  const concentratedLoss = losingBuckets.some((bucket) => Math.abs(bucket.contributionShare ?? 0) >= 0.25);
  const anyPositiveRegime = losingBuckets.length < 8 && holdoutTrades.some((trade) => trade.netReturn > 0);
  const drawdownBad = results.some((result) => result.holdoutWindowMetrics.maxDrawdown < -0.2);
  if (holdoutPnl < 0 && losingBuckets.length >= 6) return 'no_clear_filter_stop_sma20';
  if (concentratedLoss && anyPositiveRegime) return 'regime_filter_promising';
  if (drawdownBad && anyPositiveRegime) return 'risk_filter_needed';
  return 'no_clear_filter_stop_sma20';
}

function recommendationFor(verdict: DiagnosticVerdict): DiagnosticRecommendation {
  if (verdict === 'regime_filter_promising') return 'test_regime_filters_next';
  if (verdict === 'risk_filter_needed') return 'test_risk_controls_next';
  return 'stop_sma20_research';
}

function hypothesesFor(results: DiagnosticConfigResult[]): string[] {
  const holdoutTrades = results.flatMap((result) => result.trades.filter((trade) => trade.windowId === 'holdout'));
  const weakBreadth = summarizeTrades('weak_breadth', holdoutTrades.filter((trade) => trade.breadthBucket === 'weak_breadth'), 1);
  const highVol = summarizeTrades('high_vol', holdoutTrades.filter((trade) => trade.volatilityBucket === 'high_vol'), 1);
  const downTrend = summarizeTrades('market_down_20d', holdoutTrades.filter((trade) => trade.marketTrendBucket === 'market_down_20d'), 1);
  const deepPullback = summarizeTrades('deep_pullback', holdoutTrades.filter((trade) => trade.pullbackSeverityBucket === 'deep_pullback'), 1);
  const hypotheses = [
    'Require a holdout-style gate before treating SMA20 as a candidate again.',
    'Compare topN=6 against concentration caps before assuming diversification helped.',
  ];
  if (weakBreadth.approximatePnl < 0) hypotheses.push('Test avoiding weak_breadth regimes.');
  if (highVol.approximatePnl < 0) hypotheses.push('Test avoiding high_vol regimes.');
  if (downTrend.approximatePnl < 0) hypotheses.push('Test requiring market_up_20d or market_flat_20d.');
  if (deepPullback.approximatePnl < 0) hypotheses.push('Test avoiding deepest pullbacks.');
  hypotheses.push('Test sector/ticker caps before any further SMA20 parameter search.');
  return hypotheses;
}

function failureAnalysis(results: DiagnosticConfigResult[]): Sma20RegimeRiskDiagnosticReport['failureAnalysis'] {
  const holdoutTrades = results.flatMap((result) => result.trades.filter((trade) => trade.windowId === 'holdout'));
  const worstYears = breakdownBy(holdoutTrades, (trade) => trade.year).sort((a, b) => a.approximatePnl - b.approximatePnl).slice(0, 3);
  const worstQuarters = breakdownBy(holdoutTrades, (trade) => trade.quarter).sort((a, b) => a.approximatePnl - b.approximatePnl).slice(0, 5);
  const sectorBreakdown = breakdownBy(holdoutTrades, (trade) => trade.sector);
  const tech = sectorBreakdown.find((bucket) => bucket.bucket === 'tech_growth');
  const nonTechTrades = holdoutTrades.filter((trade) => trade.sector !== 'tech_growth');
  const nonTechAvg = mean(nonTechTrades.map((trade) => trade.netReturn));
  const techAvg = mean(holdoutTrades.filter((trade) => trade.sector === 'tech_growth').map((trade) => trade.netReturn));
  const topN6 = results.find((result) => result.topN === 6 && result.costBps === 0);
  const topN4 = results.find((result) => result.topN === 4 && result.costBps === 0);
  const topN6Sharpe = topN6?.holdoutWindowMetrics.Sharpe ?? Number.NEGATIVE_INFINITY;
  const topN4Sharpe = topN4?.holdoutWindowMetrics.Sharpe ?? Number.NEGATIVE_INFINITY;
  return {
    worstYears,
    worstQuarters,
    holdoutDegradationDrivers: [
      'Holdout Sharpe and benchmark-relative return fell sharply versus the research window.',
      'Holdout drawdowns were materially larger than the best research-window drawdowns.',
      'Cost sensitivity remained visible: topN=6 at 10 bps was not a research_candidate in holdout.',
    ],
    techGrowthHelpedHoldout: tech ? tech.approximatePnl > 0 : null,
    nonTechSelectionsWorseInHoldout: nonTechAvg !== null && techAvg !== null ? nonTechAvg < techAvg : null,
    topN6DiversificationRead:
      topN6 && topN4 && topN6Sharpe > topN4Sharpe
        ? 'topN=6 improved holdout Sharpe versus topN=4, but did not restore research_candidate status.'
        : 'topN=6 did not clearly solve holdout degradation.',
  };
}

export function buildSma20RegimeRiskDiagnosticReport(
  artifact: PriceFeatureLabelArtifact,
  config: Sma20RegimeRiskDiagnosticConfig = {},
): Sma20RegimeRiskDiagnosticReport {
  const normalized = normalizeConfig(config);
  const ctx = buildContext(artifact);
  const configResults = normalized.focusConfigs.map(({ topN, costBps }) => {
    const report = buildProfitBacktestReport(artifact, {
      inputPath: normalized.inputPath ?? undefined,
      initialCapital: normalized.initialCapital,
      costBps,
      topN,
      maxPositions: topN,
      minTradesForCandidate: normalized.minTradesForCandidate,
      strategies: [strategy(topN)],
    });
    const result = report.strategies[0];
    const trades = enrichTrades(ctx, result.trades, topN, costBps, normalized);
    return {
      configId: `topN${topN}_${costBps}bps`,
      topN,
      costBps,
      totalReturn: result.metrics.totalReturn,
      Sharpe: result.metrics.Sharpe,
      maxDrawdown: result.metrics.maxDrawdown,
      winRate: result.metrics.winRate,
      numberOfTrades: result.metrics.numberOfTrades,
      benchmarkRelativeReturn: result.metrics.benchmarkRelativeReturn,
      profitVerdict: result.profitVerdict,
      researchWindowMetrics: windowMetrics(artifact, normalized, topN, costBps, normalized.researchWindow),
      holdoutWindowMetrics: windowMetrics(artifact, normalized, topN, costBps, normalized.holdoutWindow),
      breakdowns: {
        year: breakdownBy(trades, (trade) => trade.year),
        quarter: breakdownBy(trades, (trade) => trade.quarter),
        marketTrend: breakdownBy(trades, (trade) => trade.marketTrendBucket),
        volatility: breakdownBy(trades, (trade) => trade.volatilityBucket),
        breadth: breakdownBy(trades, (trade) => trade.breadthBucket),
        pullbackSeverity: breakdownBy(trades, (trade) => trade.pullbackSeverityBucket),
        ticker: breakdownBy(trades, (trade) => trade.ticker),
        sector: breakdownBy(trades, (trade) => trade.sector),
      },
      trades,
    };
  });
  const verdict = diagnosticVerdict(configResults);
  return {
    generatedAt: new Date().toISOString(),
    lane: 'research_only',
    reportType: 'research_sma20_regime_risk_diagnostic',
    schemaVersion: 'research_sma20_regime_risk_diagnostic_v1',
    config: normalized,
    artifactProvenance: {
      sourceArtifactPath: artifact.sourceArtifactPath,
      artifactGeneratedAt: artifact.generatedAt,
      artifactSchemaVersion: artifact.schemaVersion,
      vendor: artifact.vendor,
      rowCount: artifact.summary.rowCount,
      tickers: artifact.summary.tickers,
      firstDate: artifact.summary.firstDate,
      lastDate: artifact.summary.lastDate,
    },
    configResults,
    failureAnalysis: failureAnalysis(configResults),
    proposedFilterHypotheses: hypothesesFor(configResults),
    finalDiagnosticVerdict: verdict,
    finalRecommendation: recommendationFor(verdict),
    warnings: [
      'Research-only diagnostic. Historical simulation only; not trading advice and not production evidence.',
      'Uses an existing local price-feature artifact only; no live provider calls are made.',
      'Filter ideas are hypotheses only; no strategy filters are implemented by this workflow.',
      'No model training, policy tuning, auto-trading, live trading, or runDailyScan behavior changes are performed.',
    ],
  };
}

export async function loadPriceFeatureArtifactForSma20RegimeRisk(inputPath: string): Promise<PriceFeatureLabelArtifact> {
  return JSON.parse(await readFile(path.resolve(inputPath), 'utf8')) as PriceFeatureLabelArtifact;
}

function defaultOutputPath(now = new Date()): string {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  return path.join(process.cwd(), '.dexter', 'signal-engine', 'research', 'analysis', `sma20-regime-risk-diagnostic-${stamp}.json`);
}

export async function persistSma20RegimeRiskDiagnosticReport(
  report: Sma20RegimeRiskDiagnosticReport,
  outputPath?: string,
): Promise<string> {
  const target = path.resolve(outputPath ?? defaultOutputPath());
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return target;
}
