import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PriceFeatureLabelArtifact } from './price-feature-labels.js';
import {
  buildProfitBacktestReport,
  ProfitFeature,
  ProfitRankDirection,
  ProfitVerdict,
  RebalanceFrequency,
  type ProfitStrategyConfig,
} from './profit-backtest.js';

export type FamilyVerdict = 'family_research_candidate' | 'family_fragile' | 'family_reject';
export type OverallFamilyRecommendation = 'continue_family_research' | 'rethink_features' | 'stop_price_only_research';

export interface StrategyFamilyDefinition {
  familyId: string;
  feature: ProfitFeature;
  rankDirection: ProfitRankDirection;
  holdDays: number;
  rebalanceFrequency: RebalanceFrequency;
}

export interface StrategyFamilyComparisonConfig {
  inputPath?: string;
  outputPath?: string;
  initialCapital?: number;
  topNs?: number[];
  costBpsValues?: number[];
  maxPositions?: number;
  minTradesForCandidate?: number;
  families?: StrategyFamilyDefinition[];
}

export interface StrategyFamilyComparisonRow {
  familyId: string;
  feature: ProfitFeature;
  rankDirection: ProfitRankDirection;
  holdDays: number;
  topN: number;
  costBps: number;
  rebalanceFrequency: RebalanceFrequency;
  profitVerdict: ProfitVerdict;
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
}

export interface StrategyFamilySummary {
  familyId: string;
  rows: number;
  researchCandidateRows: number;
  weakRows: number;
  rejectRows: number;
  expandUniverseRows: number;
  bestSharpe: number | null;
  bestBenchmarkRelativeReturn: number | null;
  averageSharpe: number | null;
  averageBenchmarkRelativeReturn: number | null;
  averageMaxDrawdown: number | null;
  survives10BpsAsResearchCandidate: boolean;
  survives25BpsAsResearchCandidate: boolean;
  familyVerdict: FamilyVerdict;
}

export interface StrategyFamilyComparisonReport {
  generatedAt: string;
  lane: 'research_only';
  reportType: 'research_strategy_family_comparison';
  schemaVersion: 'research_strategy_family_comparison_v1';
  config: {
    inputPath: string | null;
    initialCapital: number;
    topNs: number[];
    costBpsValues: number[];
    maxPositions: number;
    minTradesForCandidate: number;
    families: StrategyFamilyDefinition[];
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
  rows: StrategyFamilyComparisonRow[];
  summary: {
    totalRows: number;
    countByFamily: Record<string, number>;
    countByVerdict: Record<ProfitVerdict, number>;
    bestRowBySharpe: StrategyFamilyComparisonRow | null;
    bestRowByBenchmarkRelativeReturn: StrategyFamilyComparisonRow | null;
    bestRowByMaxDrawdownAmongProfitable: StrategyFamilyComparisonRow | null;
    familySummary: StrategyFamilySummary[];
    overallRecommendation: OverallFamilyRecommendation;
  };
  warnings: string[];
}

const DEFAULT_INITIAL_CAPITAL = 100_000;
const DEFAULT_TOP_NS = [2, 4, 6];
const DEFAULT_COST_BPS_VALUES = [0, 10, 25];
const DEFAULT_MAX_POSITIONS = 6;
const DEFAULT_MIN_TRADES_FOR_CANDIDATE = 20;

export const DEFAULT_STRATEGY_FAMILIES: StrategyFamilyDefinition[] = [
  {
    familyId: 'sma20_gap_reversion',
    feature: 'sma_20_gap',
    rankDirection: 'ascending',
    holdDays: 20,
    rebalanceFrequency: 'weekly',
  },
  {
    familyId: 'sma50_gap_reversion',
    feature: 'sma_50_gap',
    rankDirection: 'ascending',
    holdDays: 20,
    rebalanceFrequency: 'weekly',
  },
  {
    familyId: 'ret_5d_reversal',
    feature: 'ret_5d',
    rankDirection: 'ascending',
    holdDays: 5,
    rebalanceFrequency: 'weekly',
  },
  {
    familyId: 'ret_20d_momentum',
    feature: 'ret_20d',
    rankDirection: 'descending',
    holdDays: 20,
    rebalanceFrequency: 'weekly',
  },
  {
    familyId: 'low_vol_20d',
    feature: 'vol_20d',
    rankDirection: 'ascending',
    holdDays: 20,
    rebalanceFrequency: 'weekly',
  },
  {
    familyId: 'drawdown_recovery',
    feature: 'drawdown_252d',
    rankDirection: 'ascending',
    holdDays: 20,
    rebalanceFrequency: 'weekly',
  },
];

function round(value: number | null, digits = 10): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

function average(values: Array<number | null>): number | null {
  const finite = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (!finite.length) return null;
  return round(finite.reduce((sum, value) => sum + value, 0) / finite.length);
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid value for ${label}: ${value}. Expected a positive integer.`);
  }
}

function assertNonNegativeNumber(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid value for ${label}: ${value}. Expected a non-negative number.`);
  }
}

function assertPositiveNumber(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid value for ${label}: ${value}. Expected a positive number.`);
  }
}

function validateFamily(family: StrategyFamilyDefinition): void {
  if (!family.familyId.trim()) throw new Error('Invalid strategy family: familyId is required.');
  if (family.rankDirection !== 'ascending' && family.rankDirection !== 'descending') {
    throw new Error(`Invalid rankDirection for ${family.familyId}: ${String(family.rankDirection)}.`);
  }
  if (family.rebalanceFrequency !== 'daily' && family.rebalanceFrequency !== 'weekly') {
    throw new Error(`Invalid rebalanceFrequency for ${family.familyId}: ${String(family.rebalanceFrequency)}.`);
  }
  assertPositiveInteger(family.holdDays, `${family.familyId}.holdDays`);
}

export function validateStrategyFamilyComparisonConfig(config: StrategyFamilyComparisonConfig): void {
  if (config.initialCapital !== undefined) assertPositiveNumber(config.initialCapital, 'initialCapital');
  if (config.maxPositions !== undefined) assertPositiveInteger(config.maxPositions, 'maxPositions');
  if (config.minTradesForCandidate !== undefined) assertPositiveInteger(config.minTradesForCandidate, 'minTradesForCandidate');

  for (const topN of config.topNs ?? DEFAULT_TOP_NS) assertPositiveInteger(topN, 'topNs');
  for (const costBps of config.costBpsValues ?? DEFAULT_COST_BPS_VALUES) assertNonNegativeNumber(costBps, 'costBpsValues');
  for (const family of config.families ?? DEFAULT_STRATEGY_FAMILIES) validateFamily(family);
}

function normalizeConfig(config: StrategyFamilyComparisonConfig): StrategyFamilyComparisonReport['config'] {
  validateStrategyFamilyComparisonConfig(config);
  return {
    inputPath: config.inputPath ? path.resolve(config.inputPath) : null,
    initialCapital: config.initialCapital ?? DEFAULT_INITIAL_CAPITAL,
    topNs: [...(config.topNs ?? DEFAULT_TOP_NS)],
    costBpsValues: [...(config.costBpsValues ?? DEFAULT_COST_BPS_VALUES)],
    maxPositions: config.maxPositions ?? DEFAULT_MAX_POSITIONS,
    minTradesForCandidate: config.minTradesForCandidate ?? DEFAULT_MIN_TRADES_FOR_CANDIDATE,
    families: [...(config.families ?? DEFAULT_STRATEGY_FAMILIES)],
  };
}

function strategyFor(family: StrategyFamilyDefinition, topN: number): ProfitStrategyConfig {
  return {
    id: `${family.familyId}_top${topN}_${family.holdDays}d`,
    feature: family.feature,
    rankDirection: family.rankDirection,
    holdDays: family.holdDays,
    rebalanceFrequency: family.rebalanceFrequency,
    topN,
    maxPositions: topN,
  };
}

export function expandStrategyFamilyGrid(config: StrategyFamilyComparisonConfig = {}): Array<{
  family: StrategyFamilyDefinition;
  topN: number;
  costBps: number;
}> {
  const normalized = normalizeConfig(config);
  const rows: Array<{ family: StrategyFamilyDefinition; topN: number; costBps: number }> = [];
  for (const family of normalized.families) {
    for (const topN of normalized.topNs) {
      for (const costBps of normalized.costBpsValues) {
        rows.push({ family, topN, costBps });
      }
    }
  }
  return rows;
}

function compareNullableDesc(a: number | null, b: number | null): number {
  return (b ?? Number.NEGATIVE_INFINITY) - (a ?? Number.NEGATIVE_INFINITY);
}

function rowTieBreak(a: StrategyFamilyComparisonRow, b: StrategyFamilyComparisonRow): number {
  return (
    a.familyId.localeCompare(b.familyId) ||
    a.holdDays - b.holdDays ||
    a.topN - b.topN ||
    a.costBps - b.costBps ||
    a.feature.localeCompare(b.feature)
  );
}

export function bestRowBySharpe(rows: StrategyFamilyComparisonRow[]): StrategyFamilyComparisonRow | null {
  return [...rows].sort((a, b) => compareNullableDesc(a.Sharpe, b.Sharpe) || rowTieBreak(a, b))[0] ?? null;
}

export function bestRowByBenchmarkRelativeReturn(rows: StrategyFamilyComparisonRow[]): StrategyFamilyComparisonRow | null {
  return [...rows].sort((a, b) => compareNullableDesc(a.benchmarkRelativeReturn, b.benchmarkRelativeReturn) || rowTieBreak(a, b))[0] ?? null;
}

export function bestRowByMaxDrawdownAmongProfitable(rows: StrategyFamilyComparisonRow[]): StrategyFamilyComparisonRow | null {
  const profitable = rows.filter((row) => row.totalReturn > 0);
  return [...profitable].sort((a, b) => b.maxDrawdown - a.maxDrawdown || rowTieBreak(a, b))[0] ?? null;
}

function countByVerdict(rows: StrategyFamilyComparisonRow[]): Record<ProfitVerdict, number> {
  return {
    reject: rows.filter((row) => row.profitVerdict === 'reject').length,
    weak: rows.filter((row) => row.profitVerdict === 'weak').length,
    research_candidate: rows.filter((row) => row.profitVerdict === 'research_candidate').length,
    expand_universe: rows.filter((row) => row.profitVerdict === 'expand_universe').length,
  };
}

export function familyVerdictForRows(rows: StrategyFamilyComparisonRow[]): FamilyVerdict {
  const researchRows = rows.filter((row) => row.profitVerdict === 'research_candidate');
  const weakRows = rows.filter((row) => row.profitVerdict === 'weak');
  const avgBenchmarkRelativeReturn = average(rows.map((row) => row.benchmarkRelativeReturn)) ?? 0;
  const survives10 = researchRows.some((row) => row.costBps >= 10);

  if (researchRows.length >= 2 && survives10 && avgBenchmarkRelativeReturn > 0) return 'family_research_candidate';
  if (researchRows.length || weakRows.length) return 'family_fragile';
  return 'family_reject';
}

function summarizeFamilies(rows: StrategyFamilyComparisonRow[], families: StrategyFamilyDefinition[]): StrategyFamilySummary[] {
  return families.map((family) => {
    const familyRows = rows.filter((row) => row.familyId === family.familyId);
    const verdictCounts = countByVerdict(familyRows);
    const researchRows = familyRows.filter((row) => row.profitVerdict === 'research_candidate');
    return {
      familyId: family.familyId,
      rows: familyRows.length,
      researchCandidateRows: verdictCounts.research_candidate,
      weakRows: verdictCounts.weak,
      rejectRows: verdictCounts.reject,
      expandUniverseRows: verdictCounts.expand_universe,
      bestSharpe: bestRowBySharpe(familyRows)?.Sharpe ?? null,
      bestBenchmarkRelativeReturn: bestRowByBenchmarkRelativeReturn(familyRows)?.benchmarkRelativeReturn ?? null,
      averageSharpe: average(familyRows.map((row) => row.Sharpe)),
      averageBenchmarkRelativeReturn: average(familyRows.map((row) => row.benchmarkRelativeReturn)),
      averageMaxDrawdown: average(familyRows.map((row) => row.maxDrawdown)),
      survives10BpsAsResearchCandidate: researchRows.some((row) => row.costBps >= 10),
      survives25BpsAsResearchCandidate: researchRows.some((row) => row.costBps >= 25),
      familyVerdict: familyVerdictForRows(familyRows),
    };
  });
}

function overallRecommendation(familySummary: StrategyFamilySummary[]): OverallFamilyRecommendation {
  if (familySummary.some((family) => family.familyVerdict === 'family_research_candidate')) return 'continue_family_research';
  if (familySummary.some((family) => family.familyVerdict === 'family_fragile')) return 'rethink_features';
  return 'stop_price_only_research';
}

export function buildStrategyFamilyComparisonReport(
  artifact: PriceFeatureLabelArtifact,
  config: StrategyFamilyComparisonConfig = {},
): StrategyFamilyComparisonReport {
  const normalized = normalizeConfig(config);
  const rows: StrategyFamilyComparisonRow[] = [];

  for (const gridRow of expandStrategyFamilyGrid({
    initialCapital: normalized.initialCapital,
    topNs: normalized.topNs,
    costBpsValues: normalized.costBpsValues,
    maxPositions: normalized.maxPositions,
    minTradesForCandidate: normalized.minTradesForCandidate,
    families: normalized.families,
  })) {
    const strategy = strategyFor(gridRow.family, gridRow.topN);
    const backtest = buildProfitBacktestReport(artifact, {
      inputPath: normalized.inputPath ?? undefined,
      initialCapital: normalized.initialCapital,
      costBps: gridRow.costBps,
      topN: gridRow.topN,
      maxPositions: Math.max(normalized.maxPositions, gridRow.topN),
      minTradesForCandidate: normalized.minTradesForCandidate,
      strategies: [strategy],
    });
    const result = backtest.strategies[0];
    rows.push({
      familyId: gridRow.family.familyId,
      feature: gridRow.family.feature,
      rankDirection: gridRow.family.rankDirection,
      holdDays: gridRow.family.holdDays,
      topN: gridRow.topN,
      costBps: gridRow.costBps,
      rebalanceFrequency: gridRow.family.rebalanceFrequency,
      profitVerdict: result.profitVerdict,
      totalReturn: result.metrics.totalReturn,
      CAGR: result.metrics.CAGR,
      Sharpe: result.metrics.Sharpe,
      maxDrawdown: result.metrics.maxDrawdown,
      Calmar: result.metrics.Calmar,
      numberOfTrades: result.metrics.numberOfTrades,
      turnover: result.metrics.turnover,
      winRate: result.metrics.winRate,
      benchmarkRelativeReturn: result.metrics.benchmarkRelativeReturn,
      benchmarkRelativeMaxDrawdown: result.metrics.benchmarkRelativeMaxDrawdown,
    });
  }

  const familySummary = summarizeFamilies(rows, normalized.families);
  const countByFamily = Object.fromEntries(normalized.families.map((family) => [
    family.familyId,
    rows.filter((row) => row.familyId === family.familyId).length,
  ]));

  return {
    generatedAt: new Date().toISOString(),
    lane: 'research_only',
    reportType: 'research_strategy_family_comparison',
    schemaVersion: 'research_strategy_family_comparison_v1',
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
    rows,
    summary: {
      totalRows: rows.length,
      countByFamily,
      countByVerdict: countByVerdict(rows),
      bestRowBySharpe: bestRowBySharpe(rows),
      bestRowByBenchmarkRelativeReturn: bestRowByBenchmarkRelativeReturn(rows),
      bestRowByMaxDrawdownAmongProfitable: bestRowByMaxDrawdownAmongProfitable(rows),
      familySummary,
      overallRecommendation: overallRecommendation(familySummary),
    },
    warnings: [
      'Research-only strategy-family comparison. Historical simulation only; not trading advice and not production evidence.',
      'Uses an existing local price-feature artifact only; no live provider calls are made.',
      'Expanded universe has no holdout split in this report.',
      'No model training, policy tuning, auto-trading, or runDailyScan behavior changes are performed.',
    ],
  };
}

export async function loadPriceFeatureArtifactForFamilyComparison(inputPath: string): Promise<PriceFeatureLabelArtifact> {
  const absolute = path.resolve(inputPath);
  return JSON.parse(await readFile(absolute, 'utf8')) as PriceFeatureLabelArtifact;
}

function defaultOutputPath(now = new Date()): string {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  return path.join(
    process.cwd(),
    '.dexter',
    'signal-engine',
    'research',
    'analysis',
    `strategy-family-comparison-${stamp}.json`,
  );
}

export async function persistStrategyFamilyComparisonReport(
  report: StrategyFamilyComparisonReport,
  outputPath?: string,
): Promise<string> {
  const target = path.resolve(outputPath ?? defaultOutputPath());
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return target;
}
