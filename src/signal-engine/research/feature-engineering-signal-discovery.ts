import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PriceFeatureLabelArtifact, PriceFeatureLabelRow } from './price-feature-labels.js';
import { computeProfitMetrics, type ProfitMetrics, type ProfitTrade, type ProfitVerdict } from './profit-backtest.js';
import { sectorForTicker, type SectorBucket } from './sma20-regime-risk-diagnostic.js';
import { countBy, mean, median, roundFinite } from './research-utils.js';

export type SignalDiscoveryFamilyId =
  | 'sector_relative_pullback'
  | 'relative_strength_pullback'
  | 'vol_adjusted_pullback'
  | 'breadth_filtered_pullback'
  | 'relative_pullback_composite';
export type SignalDiscoveryDecision = 'continue_new_signal_research' | 'refine_feature_set' | 'stop_price_only_research';
export type SignalDiscoveryRecommendation =
  | 'continue_with_best_new_signal_family'
  | 'refine_relative_features_and_filters'
  | 'stop_price_only_and_add_non_price_data';

export interface FeatureEngineeredRow extends PriceFeatureLabelRow {
  sector: SectorBucket;
  marketRet20d: number | null;
  relRet20d: number | null;
  marketRet5d: number | null;
  relRet5d: number | null;
  sectorAvgSma20Gap: number | null;
  sectorRelativeSma20Gap: number | null;
  sectorAvgRet20d: number | null;
  sectorRelativeRet20d: number | null;
  volAdjustedSma20Gap: number | null;
  volAdjustedRet20d: number | null;
  trendUp20: boolean | null;
  trendUp50: boolean | null;
  pullbackInUptrend: boolean;
  deepPullbackInUptrend: boolean;
  universeBreadth20: number | null;
  universeBreadth50: number | null;
  sectorBreadth20: number | null;
  sectorBreadth50: number | null;
  relStrengthRank: number | null;
  pullbackRank: number | null;
  volAdjustedPullbackRank: number | null;
  trendQualifiedPullbackScore: number | null;
  relativePullbackComposite: number | null;
}

export interface FeatureEngineeredArtifact {
  generatedAt: string;
  lane: 'research_only';
  datasetType: 'feature_engineered_signal_discovery';
  schemaVersion: 'feature_engineered_signal_discovery_v1';
  sourceArtifactPath: string | null;
  sourceArtifactSchemaVersion: string;
  rowCount: number;
  tickerCount: number;
  dateRange: { firstDate: string | null; lastDate: string | null };
  featureDefinitions: Record<string, string>;
  nullCounts: Record<string, number>;
  warnings: string[];
  rows: FeatureEngineeredRow[];
}

export interface SignalDiscoveryConfig {
  inputPath?: string;
  featuresOutputPath?: string;
  outputPath?: string;
  initialCapital?: number;
  topNs?: number[];
  costBpsValues?: number[];
  holdDays?: number;
  minTradesForCandidate?: number;
}

export interface SignalDiscoveryStrategyConfig {
  configId: string;
  familyId: SignalDiscoveryFamilyId;
  topN: number;
  holdDays: number;
  costBps: number;
}

export interface SignalDiscoveryWindow {
  windowId: string;
  startDate: string;
  endDate: string;
}

export interface SignalDiscoveryWalkForwardWindow {
  windowId: string;
  train: SignalDiscoveryWindow;
  test: SignalDiscoveryWindow;
}

export interface SignalDiscoveryMetrics {
  totalReturn: number;
  CAGR: number;
  Sharpe: number | null;
  maxDrawdown: number;
  Calmar: number | null;
  trades: number;
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

export interface SignalDiscoveryEvaluation {
  config: SignalDiscoveryStrategyConfig;
  metrics: SignalDiscoveryMetrics;
  benchmarkMetrics: ProfitMetrics;
}

export interface FamilyWalkForwardResult {
  windowId: string;
  familyId: SignalDiscoveryFamilyId;
  trainWindow: SignalDiscoveryWindow;
  testWindow: SignalDiscoveryWindow;
  selectedConfig: SignalDiscoveryStrategyConfig;
  trainMetrics: SignalDiscoveryMetrics;
  testMetrics: SignalDiscoveryMetrics;
}

export interface OverallWalkForwardResult {
  windowId: string;
  trainWindow: SignalDiscoveryWindow;
  testWindow: SignalDiscoveryWindow;
  selectedConfig: SignalDiscoveryStrategyConfig;
  selectedFamilyId: SignalDiscoveryFamilyId;
  trainMetrics: SignalDiscoveryMetrics;
  testMetrics: SignalDiscoveryMetrics;
}

export interface SignalDiscoveryReport {
  generatedAt: string;
  lane: 'research_only';
  reportType: 'research_feature_engineering_signal_discovery';
  schemaVersion: 'research_feature_engineering_signal_discovery_v1';
  featureArtifactHealth: {
    sourceArtifactPath: string | null;
    featureArtifactPath: string | null;
    rowCount: number;
    tickerCount: number;
    dateRange: { firstDate: string | null; lastDate: string | null };
    nullCounts: Record<string, number>;
    warnings: string[];
  };
  configGrid: {
    families: SignalDiscoveryFamilyId[];
    topNs: number[];
    holdDays: number[];
    costBpsValues: number[];
    totalConfigsTested: number;
    configs: SignalDiscoveryStrategyConfig[];
  };
  familySummaries: Array<{
    familyId: SignalDiscoveryFamilyId;
    selectedWindows: number;
    researchCandidateTestWindows: number;
    weakOrBetterTestWindows: number;
    averageTestSharpe: number | null;
    medianTestSharpe: number | null;
    averageTestBenchmarkRelativeReturn: number | null;
    medianTestBenchmarkRelativeReturn: number | null;
    worstTestMaxDrawdown: number;
  }>;
  walkForwardSelections: OverallWalkForwardResult[];
  perFamilyWalkForwardResults: FamilyWalkForwardResult[];
  bestOverallTrainSelectedTestResults: OverallWalkForwardResult[];
  summary: {
    totalConfigsTested: number;
    walkForwardWindows: number;
    countOfTestWindowsByProfitVerdict: Record<ProfitVerdict, number>;
    averageTestSharpe: number | null;
    medianTestSharpe: number | null;
    averageTestBenchmarkRelativeReturn: number | null;
    medianTestBenchmarkRelativeReturn: number | null;
    worstTestMaxDrawdown: number;
    costRobustness: {
      selectedCostBpsValues: number[];
      selectedConfigsUsed10BpsOr25Bps: boolean;
      selectedTestResearchCandidateAt10Bps: boolean;
      selectedTestResearchCandidateAt25Bps: boolean;
    };
    familyStability: {
      selectedFamilyCounts: Record<string, number>;
      selectedFamilyMostOften: string | null;
      selectedTopNCounts: Record<string, number>;
      selectedCostBpsCounts: Record<string, number>;
    };
    stoppedSma20BaselineComparison: {
      sma20ResearchCandidateTestWindows: 0;
      sma20WeakOrBetterTestWindows: 1;
      sma20AverageTestBenchmarkRelativeReturn: -0.0495;
      bestNewFamilyWeakOrBetterTestWindows: number;
      bestNewFamilyAverageBenchmarkRelativeReturn: number | null;
      bestNewFamilyWorstMaxDrawdown: number | null;
      meaningfullyBeatsBaseline: boolean;
    };
    finalDecision: SignalDiscoveryDecision;
    finalRecommendation: SignalDiscoveryRecommendation;
  };
  warnings: string[];
}

const DEFAULT_INITIAL_CAPITAL = 100_000;
const DEFAULT_TOP_NS = [4, 6, 8];
const DEFAULT_COST_BPS_VALUES = [0, 10, 25];
const DEFAULT_HOLD_DAYS = 20;
const DEFAULT_MIN_TRADES_FOR_CANDIDATE = 20;
const FAMILIES: SignalDiscoveryFamilyId[] = [
  'sector_relative_pullback',
  'relative_strength_pullback',
  'vol_adjusted_pullback',
  'breadth_filtered_pullback',
  'relative_pullback_composite',
];
const FEATURE_NAMES = [
  'marketRet20d',
  'relRet20d',
  'marketRet5d',
  'relRet5d',
  'sectorAvgSma20Gap',
  'sectorRelativeSma20Gap',
  'sectorAvgRet20d',
  'sectorRelativeRet20d',
  'volAdjustedSma20Gap',
  'volAdjustedRet20d',
  'trendUp20',
  'trendUp50',
  'pullbackInUptrend',
  'deepPullbackInUptrend',
  'universeBreadth20',
  'universeBreadth50',
  'sectorBreadth20',
  'sectorBreadth50',
  'relStrengthRank',
  'pullbackRank',
  'volAdjustedPullbackRank',
  'trendQualifiedPullbackScore',
  'relativePullbackComposite',
] as const;

const VERDICT_SCORE: Record<ProfitVerdict, number> = {
  research_candidate: 3,
  weak: 2,
  reject: 1,
  expand_universe: 0,
};

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function priceFor(row: PriceFeatureLabelRow | FeatureEngineeredRow | undefined): number | null {
  if (!row) return null;
  const price = finite(row.adjustedClose) ?? finite(row.close);
  return price !== null && price > 0 ? price : null;
}

function avg(values: Array<number | null>): number | null {
  const finiteValues = values.filter((value): value is number => value !== null && Number.isFinite(value));
  return finiteValues.length ? finiteValues.reduce((sum, value) => sum + value, 0) / finiteValues.length : null;
}

function safeDivide(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null || denominator === 0) return null;
  return numerator / denominator;
}

function percentTrue(values: Array<boolean | null>): number | null {
  const known = values.filter((value): value is boolean => value !== null);
  return known.length ? known.filter(Boolean).length / known.length : null;
}

function rowsByDate<T extends { date: string; ticker: string }>(rows: T[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const row of rows) out.set(row.date, [...(out.get(row.date) ?? []), row]);
  return out;
}

function rankScores<T extends { ticker: string }>(rows: T[], valueFor: (row: T) => number | null, direction: 'ascending' | 'descending'): Map<string, number> {
  const ranked = rows
    .map((row) => ({ row, value: valueFor(row) }))
    .filter((item): item is { row: T; value: number } => item.value !== null && Number.isFinite(item.value))
    .sort((a, b) => {
      const byValue = direction === 'ascending' ? a.value - b.value : b.value - a.value;
      return byValue || a.row.ticker.localeCompare(b.row.ticker);
    });
  const n = ranked.length;
  const scores = new Map<string, number>();
  ranked.forEach((item, index) => scores.set(item.row.ticker, n === 1 ? 1 : 1 - index / (n - 1)));
  return scores;
}

function featureDefinitions(): Record<string, string> {
  return {
    marketRet20d: 'Equal-weight average ret_20d across all tickers on the same signal date.',
    relRet20d: 'Ticker ret_20d minus same-date marketRet20d.',
    marketRet5d: 'Equal-weight average ret_5d across all tickers on the same signal date.',
    relRet5d: 'Ticker ret_5d minus same-date marketRet5d.',
    sectorAvgSma20Gap: 'Equal-weight average sma_20_gap for ticker sector on the same signal date.',
    sectorRelativeSma20Gap: 'Ticker sma_20_gap minus same-date sectorAvgSma20Gap.',
    sectorAvgRet20d: 'Equal-weight average ret_20d for ticker sector on the same signal date.',
    sectorRelativeRet20d: 'Ticker ret_20d minus same-date sectorAvgRet20d.',
    volAdjustedSma20Gap: 'sma_20_gap divided by vol_20d; null when volatility is missing or zero.',
    volAdjustedRet20d: 'ret_20d divided by vol_20d; null when volatility is missing or zero.',
    trendUp20: 'True when sma_20_gap is positive; null when sma_20_gap is unavailable.',
    trendUp50: 'True when sma_50_gap is positive; null when sma_50_gap is unavailable.',
    pullbackInUptrend: 'True when sma_20_gap is negative and sma_50_gap is positive.',
    deepPullbackInUptrend: 'True when sma_20_gap is <= -0.08 and sma_50_gap is positive.',
    universeBreadth20: 'Percent of same-date universe with sma_20_gap above zero.',
    universeBreadth50: 'Percent of same-date universe with sma_50_gap above zero.',
    sectorBreadth20: 'Percent of same-date sector with sma_20_gap above zero.',
    sectorBreadth50: 'Percent of same-date sector with sma_50_gap above zero.',
    relStrengthRank: 'Same-date normalized rank score for relRet20d, descending; 1 is strongest.',
    pullbackRank: 'Same-date normalized rank score for sectorRelativeSma20Gap, ascending; 1 is deepest sector-relative pullback.',
    volAdjustedPullbackRank: 'Same-date normalized rank score for volAdjustedSma20Gap, ascending; 1 is deepest volatility-adjusted pullback.',
    trendQualifiedPullbackScore: 'Simple deterministic score favoring pullbacks in positive 50-day trend while penalizing deep and high-volatility pullbacks.',
    relativePullbackComposite: 'Average of sector-relative pullback rank, relative-strength rank, universe breadth, and sector breadth.',
  };
}

export function buildFeatureEngineeredArtifact(
  artifact: PriceFeatureLabelArtifact,
  sourceArtifactPath: string | null = artifact.sourceArtifactPath,
): FeatureEngineeredArtifact {
  const sortedRows = [...artifact.rows].sort((a, b) => a.date.localeCompare(b.date) || a.ticker.localeCompare(b.ticker));
  const byDate = rowsByDate(sortedRows);
  const enriched: FeatureEngineeredRow[] = [];

  for (const [, dateRows] of byDate) {
    const marketRet20d = avg(dateRows.map((row) => finite(row.ret_20d)));
    const marketRet5d = avg(dateRows.map((row) => finite(row.ret_5d)));
    const universeBreadth20 = percentTrue(dateRows.map((row) => {
      const gap = finite(row.sma_20_gap);
      return gap === null ? null : gap > 0;
    }));
    const universeBreadth50 = percentTrue(dateRows.map((row) => {
      const gap = finite(row.sma_50_gap);
      return gap === null ? null : gap > 0;
    }));
    const sectorGroups = new Map<SectorBucket, PriceFeatureLabelRow[]>();
    for (const row of dateRows) {
      const sector = sectorForTicker(row.ticker);
      sectorGroups.set(sector, [...(sectorGroups.get(sector) ?? []), row]);
    }

    const dateEnriched = dateRows.map((row): FeatureEngineeredRow => {
      const sector = sectorForTicker(row.ticker);
      const sectorRows = sectorGroups.get(sector) ?? [];
      const sectorAvgSma20Gap = avg(sectorRows.map((item) => finite(item.sma_20_gap)));
      const sectorAvgRet20d = avg(sectorRows.map((item) => finite(item.ret_20d)));
      const sma20 = finite(row.sma_20_gap);
      const sma50 = finite(row.sma_50_gap);
      const ret20 = finite(row.ret_20d);
      const ret5 = finite(row.ret_5d);
      const vol20 = finite(row.vol_20d);
      const sectorBreadth20 = percentTrue(sectorRows.map((item) => {
        const gap = finite(item.sma_20_gap);
        return gap === null ? null : gap > 0;
      }));
      const sectorBreadth50 = percentTrue(sectorRows.map((item) => {
        const gap = finite(item.sma_50_gap);
        return gap === null ? null : gap > 0;
      }));
      return {
        ...row,
        sector,
        marketRet20d,
        relRet20d: ret20 !== null && marketRet20d !== null ? ret20 - marketRet20d : null,
        marketRet5d,
        relRet5d: ret5 !== null && marketRet5d !== null ? ret5 - marketRet5d : null,
        sectorAvgSma20Gap,
        sectorRelativeSma20Gap: sma20 !== null && sectorAvgSma20Gap !== null ? sma20 - sectorAvgSma20Gap : null,
        sectorAvgRet20d,
        sectorRelativeRet20d: ret20 !== null && sectorAvgRet20d !== null ? ret20 - sectorAvgRet20d : null,
        volAdjustedSma20Gap: safeDivide(sma20, vol20),
        volAdjustedRet20d: safeDivide(ret20, vol20),
        trendUp20: sma20 === null ? null : sma20 > 0,
        trendUp50: sma50 === null ? null : sma50 > 0,
        pullbackInUptrend: sma20 !== null && sma50 !== null && sma20 < 0 && sma50 > 0,
        deepPullbackInUptrend: sma20 !== null && sma50 !== null && sma20 <= -0.08 && sma50 > 0,
        universeBreadth20,
        universeBreadth50,
        sectorBreadth20,
        sectorBreadth50,
        relStrengthRank: null,
        pullbackRank: null,
        volAdjustedPullbackRank: null,
        trendQualifiedPullbackScore: null,
        relativePullbackComposite: null,
      };
    });

    const relRanks = rankScores(dateEnriched, (row) => row.relRet20d, 'descending');
    const pullbackRanks = rankScores(dateEnriched, (row) => row.sectorRelativeSma20Gap, 'ascending');
    const volRanks = rankScores(dateEnriched, (row) => row.volAdjustedSma20Gap, 'ascending');
    for (const row of dateEnriched) {
      const relStrengthRank = relRanks.get(row.ticker) ?? null;
      const pullbackRank = pullbackRanks.get(row.ticker) ?? null;
      const volAdjustedPullbackRank = volRanks.get(row.ticker) ?? null;
      const moderatePullbackScore = row.sectorRelativeSma20Gap === null
        ? null
        : Math.max(0, 1 - Math.abs(row.sectorRelativeSma20Gap + 0.04) / 0.12);
      const volPenalty = row.volAdjustedSma20Gap === null ? 0.15 : Math.min(0.35, Math.abs(row.volAdjustedSma20Gap) / 20);
      const trendQualifiedPullbackScore = row.pullbackInUptrend && moderatePullbackScore !== null
        ? Math.max(0, Math.min(1, 0.45 + 0.35 * moderatePullbackScore + 0.2 * (pullbackRank ?? 0) - (row.deepPullbackInUptrend ? 0.25 : 0) - volPenalty))
        : 0;
      const compositeParts = [
        pullbackRank,
        relStrengthRank,
        row.universeBreadth20,
        row.sectorBreadth20,
      ].filter((value): value is number => value !== null);
      enriched.push({
        ...row,
        relStrengthRank,
        pullbackRank,
        volAdjustedPullbackRank,
        trendQualifiedPullbackScore: roundFinite(trendQualifiedPullbackScore),
        relativePullbackComposite: roundFinite(avg(compositeParts)),
      });
    }
  }

  const tickers = Array.from(new Set(enriched.map((row) => row.ticker))).sort((a, b) => a.localeCompare(b));
  const nullCounts = Object.fromEntries(FEATURE_NAMES.map((name) => [
    name,
    enriched.filter((row) => row[name] === null).length,
  ]));
  return {
    generatedAt: new Date().toISOString(),
    lane: 'research_only',
    datasetType: 'feature_engineered_signal_discovery',
    schemaVersion: 'feature_engineered_signal_discovery_v1',
    sourceArtifactPath,
    sourceArtifactSchemaVersion: artifact.schemaVersion,
    rowCount: enriched.length,
    tickerCount: tickers.length,
    dateRange: {
      firstDate: enriched[0]?.date ?? null,
      lastDate: enriched[enriched.length - 1]?.date ?? null,
    },
    featureDefinitions: featureDefinitions(),
    nullCounts,
    warnings: [
      'Research-only feature artifact. No production signal logic, model training, live data fetching, or trading behavior is changed.',
      'All cross-sectional features are computed from same-date universe or same-date sector rows only.',
    ],
    rows: enriched,
  };
}

export function expandSignalDiscoveryConfigGrid(config: RequiredSignalDiscoveryConfig): SignalDiscoveryStrategyConfig[] {
  const configs: SignalDiscoveryStrategyConfig[] = [];
  for (const familyId of FAMILIES) {
    for (const topN of config.topNs) {
      for (const costBps of config.costBpsValues) {
        configs.push({
          configId: `${familyId}_top${topN}_hold${config.holdDays}_${costBps}bps`,
          familyId,
          topN,
          holdDays: config.holdDays,
          costBps,
        });
      }
    }
  }
  return configs;
}

interface SimContext {
  rowsByDate: Map<string, FeatureEngineeredRow[]>;
  tickerDateRows: Map<string, Map<string, FeatureEngineeredRow>>;
  dates: string[];
  tickers: string[];
}

interface EquityPoint {
  date: string;
  equity: number;
  exposure: number;
}

interface Position {
  ticker: string;
  signalDate: string;
  entryDate: string;
  exitDate: string;
  entryPrice: number;
  shares: number;
  capitalAllocated: number;
}

interface PendingEntry {
  ticker: string;
  signalDate: string;
  entryDate: string;
  exitDate: string;
  entryPrice: number;
}

function buildSimContext(rows: FeatureEngineeredRow[]): SimContext {
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date) || a.ticker.localeCompare(b.ticker));
  const byDate = new Map<string, FeatureEngineeredRow[]>();
  const tickerDateRows = new Map<string, Map<string, FeatureEngineeredRow>>();
  for (const row of sorted) {
    byDate.set(row.date, [...(byDate.get(row.date) ?? []), row]);
    const tickerMap = tickerDateRows.get(row.ticker) ?? new Map<string, FeatureEngineeredRow>();
    tickerMap.set(row.date, row);
    tickerDateRows.set(row.ticker, tickerMap);
  }
  return {
    rowsByDate: byDate,
    tickerDateRows,
    dates: Array.from(byDate.keys()).sort((a, b) => a.localeCompare(b)),
    tickers: Array.from(tickerDateRows.keys()).sort((a, b) => a.localeCompare(b)),
  };
}

function rowFor(ctx: SimContext, ticker: string, date: string): FeatureEngineeredRow | undefined {
  return ctx.tickerDateRows.get(ticker)?.get(date);
}

function eligibleRows(rows: FeatureEngineeredRow[], config: SignalDiscoveryStrategyConfig): FeatureEngineeredRow[] {
  const withPrices = rows.filter((row) => priceFor(row) !== null);
  const sortAsc = (field: keyof FeatureEngineeredRow) => (a: FeatureEngineeredRow, b: FeatureEngineeredRow) => {
    const av = finite(a[field]);
    const bv = finite(b[field]);
    if (av === null && bv === null) return a.ticker.localeCompare(b.ticker);
    if (av === null) return 1;
    if (bv === null) return -1;
    return av - bv || a.ticker.localeCompare(b.ticker);
  };
  const sortDesc = (field: keyof FeatureEngineeredRow) => (a: FeatureEngineeredRow, b: FeatureEngineeredRow) => {
    const av = finite(a[field]);
    const bv = finite(b[field]);
    if (av === null && bv === null) return a.ticker.localeCompare(b.ticker);
    if (av === null) return 1;
    if (bv === null) return -1;
    return bv - av || a.ticker.localeCompare(b.ticker);
  };

  if (config.familyId === 'sector_relative_pullback') {
    return withPrices.filter((row) => row.pullbackInUptrend && row.sectorRelativeSma20Gap !== null).sort(sortAsc('sectorRelativeSma20Gap'));
  }
  if (config.familyId === 'relative_strength_pullback') {
    return withPrices
      .filter((row) => row.pullbackInUptrend && row.relStrengthRank !== null && row.pullbackRank !== null)
      .sort((a, b) => ((b.relStrengthRank ?? 0) + (b.pullbackRank ?? 0)) - ((a.relStrengthRank ?? 0) + (a.pullbackRank ?? 0)) || a.ticker.localeCompare(b.ticker));
  }
  if (config.familyId === 'vol_adjusted_pullback') {
    return withPrices
      .filter((row) => row.volAdjustedSma20Gap !== null && row.vol_20d !== null && row.vol_20d !== 0 && (row.sma_20_gap ?? 0) > -0.12)
      .sort(sortAsc('volAdjustedSma20Gap'));
  }
  if (config.familyId === 'breadth_filtered_pullback') {
    return withPrices
      .filter((row) => (row.universeBreadth20 ?? 0) >= 0.45 && (row.sectorBreadth20 ?? 0) >= 0.4 && row.sectorRelativeSma20Gap !== null)
      .sort(sortAsc('sectorRelativeSma20Gap'));
  }
  return withPrices
    .filter((row) => row.pullbackInUptrend && (row.universeBreadth20 ?? 0) >= 0.45 && row.relativePullbackComposite !== null)
    .sort(sortDesc('relativePullbackComposite'));
}

function baselineBuyHold(ctx: SimContext, initialCapital: number, costBps: number): { equityCurve: EquityPoint[]; trades: ProfitTrade[]; turnoverNotional: number } {
  const cost = costBps / 10_000;
  const firstDate = ctx.dates[0];
  const lastDate = ctx.dates[ctx.dates.length - 1];
  const tickers = ctx.tickers.filter((ticker) => priceFor(rowFor(ctx, ticker, firstDate)) !== null && priceFor(rowFor(ctx, ticker, lastDate)) !== null);
  const alloc = tickers.length ? initialCapital / tickers.length : 0;
  let cash = initialCapital;
  let turnoverNotional = 0;
  const positions: Position[] = [];
  for (const ticker of tickers) {
    const entryPrice = priceFor(rowFor(ctx, ticker, firstDate));
    if (entryPrice === null) continue;
    const investable = alloc - alloc * cost;
    cash -= alloc;
    turnoverNotional += investable;
    positions.push({ ticker, signalDate: firstDate, entryDate: firstDate, exitDate: lastDate, entryPrice, shares: investable / entryPrice, capitalAllocated: alloc });
  }
  const equityCurve = ctx.dates.map((date) => {
    const positionValue = positions.reduce((sum, position) => sum + position.shares * (priceFor(rowFor(ctx, position.ticker, date)) ?? position.entryPrice), 0);
    const equity = cash + positionValue;
    return { date, equity: roundFinite(equity, 6) ?? equity, exposure: equity > 0 ? positionValue / equity : 0 };
  });
  const trades: ProfitTrade[] = [];
  for (const position of positions) {
    const exitPrice = priceFor(rowFor(ctx, position.ticker, lastDate));
    if (exitPrice === null) continue;
    turnoverNotional += position.shares * exitPrice;
    trades.push({
      strategyId: 'equal_weight_buy_hold',
      ticker: position.ticker,
      signalDate: firstDate,
      entryDate: firstDate,
      exitDate: lastDate,
      entryPrice: position.entryPrice,
      exitPrice,
      grossReturn: roundFinite(exitPrice / position.entryPrice - 1) ?? 0,
      netReturn: roundFinite((exitPrice * (1 - cost)) / (position.entryPrice * (1 + cost)) - 1) ?? 0,
      capitalAllocated: roundFinite(position.capitalAllocated, 2) ?? position.capitalAllocated,
    });
  }
  if (equityCurve.length && positions.length) {
    const last = equityCurve[equityCurve.length - 1];
    last.equity = roundFinite(last.equity - positions.reduce((sum, position) => {
      const exitPrice = priceFor(rowFor(ctx, position.ticker, lastDate)) ?? 0;
      return sum + position.shares * exitPrice * cost;
    }, 0), 6) ?? last.equity;
  }
  return { equityCurve, trades, turnoverNotional };
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

function toDiscoveryMetrics(
  metrics: ProfitMetrics,
  verdict: ProfitVerdict,
  extras: Pick<SignalDiscoveryMetrics, 'averageHoldingsPerRebalance' | 'skippedCandidates' | 'skippedRebalances'>,
): SignalDiscoveryMetrics {
  return {
    totalReturn: metrics.totalReturn,
    CAGR: metrics.CAGR,
    Sharpe: metrics.Sharpe,
    maxDrawdown: metrics.maxDrawdown,
    Calmar: metrics.Calmar,
    trades: metrics.numberOfTrades,
    numberOfTrades: metrics.numberOfTrades,
    turnover: metrics.turnover,
    winRate: metrics.winRate,
    benchmarkRelativeReturn: metrics.benchmarkRelativeReturn,
    benchmarkRelativeMaxDrawdown: metrics.benchmarkRelativeMaxDrawdown,
    profitVerdict: verdict,
    ...extras,
  };
}

function simulateStrategy(
  ctx: SimContext,
  config: SignalDiscoveryStrategyConfig,
  initialCapital: number,
): { equityCurve: EquityPoint[]; trades: ProfitTrade[]; turnoverNotional: number; averageHoldingsPerRebalance: number | null; skippedCandidates: number; skippedRebalances: number } {
  const cost = config.costBps / 10_000;
  let cash = initialCapital;
  let positions: Position[] = [];
  let pendingEntries: PendingEntry[] = [];
  let nextSignalIndex = 0;
  let turnoverNotional = 0;
  let skippedCandidates = 0;
  let skippedRebalances = 0;
  const holdingsCounts: number[] = [];
  const trades: ProfitTrade[] = [];
  const equityCurve: EquityPoint[] = [];

  for (let dateIndex = 0; dateIndex < ctx.dates.length; dateIndex += 1) {
    const date = ctx.dates[dateIndex];
    for (const position of positions.filter((item) => item.exitDate === date)) {
      const exitPrice = priceFor(rowFor(ctx, position.ticker, date));
      if (exitPrice === null) continue;
      const grossProceeds = position.shares * exitPrice;
      cash += grossProceeds - grossProceeds * cost;
      turnoverNotional += grossProceeds;
      trades.push({
        strategyId: config.configId,
        ticker: position.ticker,
        signalDate: position.signalDate,
        entryDate: position.entryDate,
        exitDate: position.exitDate,
        entryPrice: position.entryPrice,
        exitPrice,
        grossReturn: roundFinite(exitPrice / position.entryPrice - 1) ?? 0,
        netReturn: roundFinite((exitPrice * (1 - cost)) / (position.entryPrice * (1 + cost)) - 1) ?? 0,
        capitalAllocated: roundFinite(position.capitalAllocated, 2) ?? position.capitalAllocated,
      });
    }
    positions = positions.filter((item) => item.exitDate !== date);

    const entering = pendingEntries.filter((entry) => entry.entryDate === date);
    if (entering.length) {
      const alloc = cash / entering.length;
      for (const entry of entering) {
        const investable = alloc - alloc * cost;
        cash -= alloc;
        turnoverNotional += investable;
        positions.push({ ticker: entry.ticker, signalDate: entry.signalDate, entryDate: entry.entryDate, exitDate: entry.exitDate, entryPrice: entry.entryPrice, shares: investable / entry.entryPrice, capitalAllocated: alloc });
      }
      pendingEntries = pendingEntries.filter((entry) => entry.entryDate !== date);
    }

    if (dateIndex >= nextSignalIndex && positions.length === 0 && pendingEntries.length === 0) {
      const entryIndex = dateIndex + 1;
      const exitIndex = entryIndex + config.holdDays;
      if (exitIndex < ctx.dates.length) {
        const ranked = eligibleRows(ctx.rowsByDate.get(date) ?? [], config);
        const selected = ranked.slice(0, config.topN);
        skippedCandidates += Math.max(0, ranked.length - selected.length);
        const entryDate = ctx.dates[entryIndex];
        const exitDate = ctx.dates[exitIndex];
        const validEntries = selected
          .map((row) => {
            const entryPrice = priceFor(rowFor(ctx, row.ticker, entryDate));
            const exitPrice = priceFor(rowFor(ctx, row.ticker, exitDate));
            return entryPrice !== null && exitPrice !== null ? { row, entryPrice } : null;
          })
          .filter((item): item is { row: FeatureEngineeredRow; entryPrice: number } => Boolean(item));
        if (validEntries.length) {
          holdingsCounts.push(validEntries.length);
          for (const entry of validEntries) pendingEntries.push({ ticker: entry.row.ticker, signalDate: date, entryDate, exitDate, entryPrice: entry.entryPrice });
        } else {
          skippedRebalances += 1;
        }
      }
      nextSignalIndex = dateIndex + Math.max(5, config.holdDays + 1);
    }

    const positionValue = positions.reduce((sum, position) => sum + position.shares * (priceFor(rowFor(ctx, position.ticker, date)) ?? position.entryPrice), 0);
    const equity = cash + positionValue;
    equityCurve.push({ date, equity: roundFinite(equity, 6) ?? equity, exposure: equity > 0 ? roundFinite(positionValue / equity) ?? 0 : 0 });
  }

  return {
    equityCurve,
    trades,
    turnoverNotional,
    averageHoldingsPerRebalance: roundFinite(mean(holdingsCounts)),
    skippedCandidates,
    skippedRebalances,
  };
}

function evaluateConfig(rows: FeatureEngineeredRow[], normalized: RequiredSignalDiscoveryConfig, config: SignalDiscoveryStrategyConfig): SignalDiscoveryEvaluation {
  const ctx = buildSimContext(rows);
  const benchmark = baselineBuyHold(ctx, normalized.initialCapital, config.costBps);
  const benchmarkMetrics = computeProfitMetrics(benchmark.equityCurve, benchmark.trades, normalized.initialCapital, undefined, benchmark.turnoverNotional);
  const sim = simulateStrategy(ctx, config, normalized.initialCapital);
  const metrics = computeProfitMetrics(sim.equityCurve, sim.trades, normalized.initialCapital, benchmarkMetrics, sim.turnoverNotional);
  return {
    config,
    metrics: toDiscoveryMetrics(metrics, profitVerdict(metrics, benchmarkMetrics, normalized.minTradesForCandidate), {
      averageHoldingsPerRebalance: sim.averageHoldingsPerRebalance,
      skippedCandidates: sim.skippedCandidates,
      skippedRebalances: sim.skippedRebalances,
    }),
    benchmarkMetrics,
  };
}

function compareForSelection(a: { config: SignalDiscoveryStrategyConfig; metrics: SignalDiscoveryMetrics }, b: { config: SignalDiscoveryStrategyConfig; metrics: SignalDiscoveryMetrics }): number {
  return (
    VERDICT_SCORE[b.metrics.profitVerdict] - VERDICT_SCORE[a.metrics.profitVerdict] ||
    (b.metrics.Sharpe ?? Number.NEGATIVE_INFINITY) - (a.metrics.Sharpe ?? Number.NEGATIVE_INFINITY) ||
    (b.metrics.benchmarkRelativeReturn ?? Number.NEGATIVE_INFINITY) - (a.metrics.benchmarkRelativeReturn ?? Number.NEGATIVE_INFINITY) ||
    Math.abs(a.metrics.maxDrawdown) - Math.abs(b.metrics.maxDrawdown) ||
    b.config.costBps - a.config.costBps ||
    b.config.topN - a.config.topN ||
    a.config.configId.localeCompare(b.config.configId)
  );
}

export function selectBestSignalDiscoveryTrainConfig(evaluated: Array<{ config: SignalDiscoveryStrategyConfig; metrics: SignalDiscoveryMetrics }>): { config: SignalDiscoveryStrategyConfig; metrics: SignalDiscoveryMetrics } {
  if (!evaluated.length) throw new Error('Cannot select train config from an empty evaluation set.');
  return [...evaluated].sort(compareForSelection)[0];
}

export function signalDiscoveryWalkForwardWindows(): SignalDiscoveryWalkForwardWindow[] {
  return [
    { windowId: 'wf_2023', train: { windowId: 'train_2021_2022', startDate: '2021-01-04', endDate: '2022-12-31' }, test: { windowId: 'test_2023', startDate: '2023-01-01', endDate: '2023-12-31' } },
    { windowId: 'wf_2024', train: { windowId: 'train_2021_2023', startDate: '2021-01-04', endDate: '2023-12-31' }, test: { windowId: 'test_2024', startDate: '2024-01-01', endDate: '2024-12-31' } },
    { windowId: 'wf_2025', train: { windowId: 'train_2021_2024', startDate: '2021-01-04', endDate: '2024-12-31' }, test: { windowId: 'test_2025', startDate: '2025-01-01', endDate: '2025-12-31' } },
    { windowId: 'wf_2026_ytd', train: { windowId: 'train_2021_2025', startDate: '2021-01-04', endDate: '2025-12-31' }, test: { windowId: 'test_2026_ytd', startDate: '2026-01-01', endDate: '2026-04-24' } },
  ];
}

function windowRows(rows: FeatureEngineeredRow[], window: SignalDiscoveryWindow): FeatureEngineeredRow[] {
  return rows.filter((row) => row.date >= window.startDate && row.date <= window.endDate);
}

function familySummary(familyId: SignalDiscoveryFamilyId, results: FamilyWalkForwardResult[]): SignalDiscoveryReport['familySummaries'][number] {
  const familyResults = results.filter((result) => result.familyId === familyId);
  const sharpes = familyResults.map((result) => result.testMetrics.Sharpe).filter((value): value is number => value !== null);
  const relatives = familyResults.map((result) => result.testMetrics.benchmarkRelativeReturn).filter((value): value is number => value !== null);
  return {
    familyId,
    selectedWindows: familyResults.length,
    researchCandidateTestWindows: familyResults.filter((result) => result.testMetrics.profitVerdict === 'research_candidate').length,
    weakOrBetterTestWindows: familyResults.filter((result) => result.testMetrics.profitVerdict === 'weak' || result.testMetrics.profitVerdict === 'research_candidate').length,
    averageTestSharpe: roundFinite(mean(sharpes)),
    medianTestSharpe: roundFinite(median(sharpes)),
    averageTestBenchmarkRelativeReturn: roundFinite(mean(relatives)),
    medianTestBenchmarkRelativeReturn: roundFinite(median(relatives)),
    worstTestMaxDrawdown: roundFinite(Math.min(...familyResults.map((result) => result.testMetrics.maxDrawdown))) ?? 0,
  };
}

export function finalSignalDiscoveryDecision(input: {
  familySummaries: SignalDiscoveryReport['familySummaries'];
  perFamilyWalkForwardResults: FamilyWalkForwardResult[];
}): SignalDiscoveryDecision {
  const continueFamily = input.familySummaries.some((summary) => {
    const tenBpsCandidate = input.perFamilyWalkForwardResults.some((result) => (
      result.familyId === summary.familyId &&
      result.selectedConfig.costBps >= 10 &&
      result.testMetrics.profitVerdict === 'research_candidate'
    ));
    return summary.researchCandidateTestWindows >= 2 &&
      summary.weakOrBetterTestWindows >= 3 &&
      (summary.averageTestBenchmarkRelativeReturn ?? 0) > 0 &&
      tenBpsCandidate;
  });
  if (continueFamily) return 'continue_new_signal_research';

  const refineFamily = input.familySummaries.some((summary) => {
    const tenBpsWeak = input.perFamilyWalkForwardResults.some((result) => (
      result.familyId === summary.familyId &&
      result.selectedConfig.costBps >= 10 &&
      (result.testMetrics.profitVerdict === 'weak' || result.testMetrics.profitVerdict === 'research_candidate')
    ));
    return summary.weakOrBetterTestWindows > 1 &&
      (summary.averageTestBenchmarkRelativeReturn ?? Number.NEGATIVE_INFINITY) > -0.0495 &&
      summary.worstTestMaxDrawdown > -1 &&
      tenBpsWeak;
  });
  return refineFamily ? 'refine_feature_set' : 'stop_price_only_research';
}

function recommendationFor(decision: SignalDiscoveryDecision): SignalDiscoveryRecommendation {
  if (decision === 'continue_new_signal_research') return 'continue_with_best_new_signal_family';
  if (decision === 'refine_feature_set') return 'refine_relative_features_and_filters';
  return 'stop_price_only_and_add_non_price_data';
}

interface RequiredSignalDiscoveryConfig {
  inputPath: string | null;
  featuresOutputPath: string | null;
  outputPath: string | null;
  initialCapital: number;
  topNs: number[];
  costBpsValues: number[];
  holdDays: number;
  minTradesForCandidate: number;
}

function normalizeConfig(config: SignalDiscoveryConfig): RequiredSignalDiscoveryConfig {
  return {
    inputPath: config.inputPath ? path.resolve(config.inputPath) : null,
    featuresOutputPath: config.featuresOutputPath ? path.resolve(config.featuresOutputPath) : null,
    outputPath: config.outputPath ? path.resolve(config.outputPath) : null,
    initialCapital: config.initialCapital ?? DEFAULT_INITIAL_CAPITAL,
    topNs: [...(config.topNs ?? DEFAULT_TOP_NS)],
    costBpsValues: [...(config.costBpsValues ?? DEFAULT_COST_BPS_VALUES)],
    holdDays: config.holdDays ?? DEFAULT_HOLD_DAYS,
    minTradesForCandidate: config.minTradesForCandidate ?? DEFAULT_MIN_TRADES_FOR_CANDIDATE,
  };
}

export function buildSignalDiscoveryReport(
  featureArtifact: FeatureEngineeredArtifact,
  config: SignalDiscoveryConfig = {},
): SignalDiscoveryReport {
  const normalized = normalizeConfig(config);
  const configs = expandSignalDiscoveryConfigGrid(normalized);
  const familyResults: FamilyWalkForwardResult[] = [];
  const overallResults: OverallWalkForwardResult[] = [];

  for (const window of signalDiscoveryWalkForwardWindows()) {
    const trainRows = windowRows(featureArtifact.rows, window.train);
    const testRows = windowRows(featureArtifact.rows, window.test);
    const trainEvaluated = configs.map((strategyConfig) => evaluateConfig(trainRows, normalized, strategyConfig));
    for (const familyId of FAMILIES) {
      const selected = selectBestSignalDiscoveryTrainConfig(trainEvaluated.filter((result) => result.config.familyId === familyId));
      const test = evaluateConfig(testRows, normalized, selected.config);
      familyResults.push({
        windowId: window.windowId,
        familyId,
        trainWindow: window.train,
        testWindow: window.test,
        selectedConfig: selected.config,
        trainMetrics: selected.metrics,
        testMetrics: test.metrics,
      });
    }
    const overall = selectBestSignalDiscoveryTrainConfig(trainEvaluated);
    const overallTest = evaluateConfig(testRows, normalized, overall.config);
    overallResults.push({
      windowId: window.windowId,
      trainWindow: window.train,
      testWindow: window.test,
      selectedConfig: overall.config,
      selectedFamilyId: overall.config.familyId,
      trainMetrics: overall.metrics,
      testMetrics: overallTest.metrics,
    });
  }

  const familySummaries = FAMILIES.map((familyId) => familySummary(familyId, familyResults));
  const testSharpes = overallResults.map((result) => result.testMetrics.Sharpe).filter((value): value is number => value !== null);
  const testRelatives = overallResults.map((result) => result.testMetrics.benchmarkRelativeReturn).filter((value): value is number => value !== null);
  const selectedCostBpsValues = Array.from(new Set(overallResults.map((result) => result.selectedConfig.costBps))).sort((a, b) => a - b);
  const familyCounts = countBy(overallResults.map((result) => result.selectedFamilyId), FAMILIES);
  const selectedFamilyMostOften = Object.entries(familyCounts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
  const bestFamily = [...familySummaries].sort((a, b) => (
    b.weakOrBetterTestWindows - a.weakOrBetterTestWindows ||
    (b.averageTestBenchmarkRelativeReturn ?? Number.NEGATIVE_INFINITY) - (a.averageTestBenchmarkRelativeReturn ?? Number.NEGATIVE_INFINITY) ||
    b.worstTestMaxDrawdown - a.worstTestMaxDrawdown
  ))[0];
  const finalDecision = finalSignalDiscoveryDecision({ familySummaries, perFamilyWalkForwardResults: familyResults });

  return {
    generatedAt: new Date().toISOString(),
    lane: 'research_only',
    reportType: 'research_feature_engineering_signal_discovery',
    schemaVersion: 'research_feature_engineering_signal_discovery_v1',
    featureArtifactHealth: {
      sourceArtifactPath: featureArtifact.sourceArtifactPath,
      featureArtifactPath: normalized.featuresOutputPath,
      rowCount: featureArtifact.rowCount,
      tickerCount: featureArtifact.tickerCount,
      dateRange: featureArtifact.dateRange,
      nullCounts: featureArtifact.nullCounts,
      warnings: featureArtifact.warnings,
    },
    configGrid: {
      families: FAMILIES,
      topNs: normalized.topNs,
      holdDays: [normalized.holdDays],
      costBpsValues: normalized.costBpsValues,
      totalConfigsTested: configs.length,
      configs,
    },
    familySummaries,
    walkForwardSelections: overallResults,
    perFamilyWalkForwardResults: familyResults,
    bestOverallTrainSelectedTestResults: overallResults,
    summary: {
      totalConfigsTested: configs.length,
      walkForwardWindows: overallResults.length,
      countOfTestWindowsByProfitVerdict: countBy(overallResults.map((result) => result.testMetrics.profitVerdict), ['reject', 'weak', 'research_candidate', 'expand_universe']),
      averageTestSharpe: roundFinite(mean(testSharpes)),
      medianTestSharpe: roundFinite(median(testSharpes)),
      averageTestBenchmarkRelativeReturn: roundFinite(mean(testRelatives)),
      medianTestBenchmarkRelativeReturn: roundFinite(median(testRelatives)),
      worstTestMaxDrawdown: roundFinite(Math.min(...overallResults.map((result) => result.testMetrics.maxDrawdown))) ?? 0,
      costRobustness: {
        selectedCostBpsValues,
        selectedConfigsUsed10BpsOr25Bps: selectedCostBpsValues.some((value) => value === 10 || value === 25),
        selectedTestResearchCandidateAt10Bps: overallResults.some((result) => result.selectedConfig.costBps === 10 && result.testMetrics.profitVerdict === 'research_candidate'),
        selectedTestResearchCandidateAt25Bps: overallResults.some((result) => result.selectedConfig.costBps === 25 && result.testMetrics.profitVerdict === 'research_candidate'),
      },
      familyStability: {
        selectedFamilyCounts: familyCounts,
        selectedFamilyMostOften,
        selectedTopNCounts: countBy(overallResults.map((result) => String(result.selectedConfig.topN)), ['4', '6', '8']),
        selectedCostBpsCounts: countBy(overallResults.map((result) => String(result.selectedConfig.costBps)), ['0', '10', '25']),
      },
      stoppedSma20BaselineComparison: {
        sma20ResearchCandidateTestWindows: 0,
        sma20WeakOrBetterTestWindows: 1,
        sma20AverageTestBenchmarkRelativeReturn: -0.0495,
        bestNewFamilyWeakOrBetterTestWindows: bestFamily?.weakOrBetterTestWindows ?? 0,
        bestNewFamilyAverageBenchmarkRelativeReturn: bestFamily?.averageTestBenchmarkRelativeReturn ?? null,
        bestNewFamilyWorstMaxDrawdown: bestFamily?.worstTestMaxDrawdown ?? null,
        meaningfullyBeatsBaseline: Boolean(bestFamily && bestFamily.weakOrBetterTestWindows > 1 && (bestFamily.averageTestBenchmarkRelativeReturn ?? Number.NEGATIVE_INFINITY) > -0.0495),
      },
      finalDecision,
      finalRecommendation: recommendationFor(finalDecision),
    },
    warnings: [
      'Research-only signal-discovery workflow. No production signal logic, no model training, no policy tuning, no live provider usage, no data fetching, no auto-trading, and no runDailyScan behavior changes are performed.',
      'Uses the existing local price-feature artifact only.',
      'Walk-forward configs are selected on train windows only and applied unchanged to test windows.',
      'The 2026 test window is a partial year ending 2026-04-24.',
    ],
  };
}

export async function loadPriceFeatureArtifactForSignalDiscovery(inputPath: string): Promise<PriceFeatureLabelArtifact> {
  return JSON.parse(await readFile(path.resolve(inputPath), 'utf8')) as PriceFeatureLabelArtifact;
}

export async function persistFeatureEngineeredArtifact(artifact: FeatureEngineeredArtifact, outputPath: string): Promise<string> {
  const target = path.resolve(outputPath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  return target;
}

function defaultReportOutputPath(now = new Date()): string {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  return path.join(process.cwd(), '.dexter', 'signal-engine', 'research', 'analysis', `feature-engineering-signal-discovery-${stamp}.json`);
}

export async function persistSignalDiscoveryReport(report: SignalDiscoveryReport, outputPath?: string): Promise<string> {
  const target = path.resolve(outputPath ?? defaultReportOutputPath());
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return target;
}
