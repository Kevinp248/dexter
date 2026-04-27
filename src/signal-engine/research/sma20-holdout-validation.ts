import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PriceFeatureLabelArtifact, PriceFeatureLabelRow } from './price-feature-labels.js';
import { buildProfitBacktestReport, ProfitVerdict, type ProfitStrategyConfig } from './profit-backtest.js';
import {
  assertNonNegativeNumber,
  assertPositiveInteger,
  assertPositiveNumber,
  countBy,
  validateDateWindow,
  validateNonOverlappingWindows,
} from './research-utils.js';

export type HoldoutWindowId = 'research' | 'holdout';
export type HoldoutVerdict = 'holdout_pass' | 'holdout_fragile' | 'holdout_fail';
export type HoldoutRecommendation = 'continue_sma20_research' | 'rethink_sma20_parameters' | 'stop_sma20_family';
export type VerdictTransition =
  | 'candidate_to_candidate'
  | 'candidate_to_weak'
  | 'candidate_to_reject'
  | 'weak_to_candidate'
  | 'reject_to_candidate'
  | 'stable_reject'
  | 'mixed';

export interface HoldoutWindowConfig {
  windowId: HoldoutWindowId;
  startDate: string;
  endDate: string;
}

export interface Sma20HoldoutValidationConfig {
  inputPath?: string;
  outputPath?: string;
  initialCapital?: number;
  topNs?: number[];
  costBpsValues?: number[];
  minTradesForCandidate?: number;
  researchWindow?: Omit<HoldoutWindowConfig, 'windowId'>;
  holdoutWindow?: Omit<HoldoutWindowConfig, 'windowId'>;
}

export interface WindowCoverage {
  windowId: HoldoutWindowId;
  startDate: string;
  endDate: string;
  rowCount: number;
  tickerCount: number;
  tickerCoverage: Array<{
    ticker: string;
    rowCount: number;
    firstDate: string | null;
    lastDate: string | null;
  }>;
}

export interface Sma20HoldoutRow {
  windowId: HoldoutWindowId;
  startDate: string;
  endDate: string;
  topN: number;
  costBps: number;
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
}

export interface Sma20HoldoutPair {
  topN: number;
  costBps: number;
  researchProfitVerdict: ProfitVerdict;
  holdoutProfitVerdict: ProfitVerdict;
  researchTotalReturn: number;
  holdoutTotalReturn: number;
  researchSharpe: number | null;
  holdoutSharpe: number | null;
  researchMaxDrawdown: number;
  holdoutMaxDrawdown: number;
  verdictTransition: VerdictTransition;
}

export interface Sma20HoldoutSummary {
  researchCountByVerdict: Record<ProfitVerdict, number>;
  holdoutCountByVerdict: Record<ProfitVerdict, number>;
  holdoutResearchCandidatePairs: number;
  holdoutWeakOrBetterPairs: number;
  bestResearchRowBySharpe: Sma20HoldoutRow | null;
  bestHoldoutRowBySharpe: Sma20HoldoutRow | null;
  bestHoldoutRowByBenchmarkRelativeReturn: Sma20HoldoutRow | null;
  topN6SurvivesHoldoutAt10Bps: boolean;
  any25BpsRowSurvivesHoldout: boolean;
  finalHoldoutVerdict: HoldoutVerdict;
  finalRecommendation: HoldoutRecommendation;
}

export interface Sma20HoldoutValidationReport {
  generatedAt: string;
  lane: 'research_only';
  reportType: 'research_sma20_holdout_validation';
  schemaVersion: 'research_sma20_holdout_validation_v1';
  config: {
    inputPath: string | null;
    initialCapital: number;
    topNs: number[];
    costBpsValues: number[];
    minTradesForCandidate: number;
    strategy: ProfitStrategyConfig;
    researchWindow: HoldoutWindowConfig;
    holdoutWindow: HoldoutWindowConfig;
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
  windowCoverage: WindowCoverage[];
  rows: Sma20HoldoutRow[];
  pairedComparisons: Sma20HoldoutPair[];
  summary: Sma20HoldoutSummary;
  warnings: string[];
}

const DEFAULT_INITIAL_CAPITAL = 100_000;
const DEFAULT_TOP_NS = [2, 4, 6];
const DEFAULT_COST_BPS_VALUES = [0, 10, 25];
const DEFAULT_MIN_TRADES_FOR_CANDIDATE = 20;
const DEFAULT_RESEARCH_WINDOW: HoldoutWindowConfig = {
  windowId: 'research',
  startDate: '2021-01-04',
  endDate: '2024-12-31',
};
const DEFAULT_HOLDOUT_WINDOW: HoldoutWindowConfig = {
  windowId: 'holdout',
  startDate: '2025-01-01',
  endDate: '2026-04-24',
};
const BASE_SMA20_STRATEGY: ProfitStrategyConfig = {
  id: 'sma20_gap_reversion_holdout',
  feature: 'sma_20_gap',
  rankDirection: 'ascending',
  holdDays: 20,
  rebalanceFrequency: 'weekly',
};

function validateWindow(window: HoldoutWindowConfig): void {
  validateDateWindow(window, window.windowId);
}

export function validateSma20HoldoutConfig(config: Sma20HoldoutValidationConfig): void {
  assertPositiveNumber(config.initialCapital, 'initialCapital');
  if (config.minTradesForCandidate !== undefined) assertPositiveInteger(config.minTradesForCandidate, 'minTradesForCandidate');
  for (const topN of config.topNs ?? DEFAULT_TOP_NS) assertPositiveInteger(topN, 'topNs');
  for (const costBps of config.costBpsValues ?? DEFAULT_COST_BPS_VALUES) assertNonNegativeNumber(costBps, 'costBpsValues');

  const researchWindow: HoldoutWindowConfig = {
    ...DEFAULT_RESEARCH_WINDOW,
    ...config.researchWindow,
    windowId: 'research',
  };
  const holdoutWindow: HoldoutWindowConfig = {
    ...DEFAULT_HOLDOUT_WINDOW,
    ...config.holdoutWindow,
    windowId: 'holdout',
  };

  validateWindow(researchWindow);
  validateWindow(holdoutWindow);
  validateNonOverlappingWindows(researchWindow, holdoutWindow, 'holdout split');
}

function normalizeConfig(config: Sma20HoldoutValidationConfig): Sma20HoldoutValidationReport['config'] {
  validateSma20HoldoutConfig(config);
  return {
    inputPath: config.inputPath ? path.resolve(config.inputPath) : null,
    initialCapital: config.initialCapital ?? DEFAULT_INITIAL_CAPITAL,
    topNs: [...(config.topNs ?? DEFAULT_TOP_NS)],
    costBpsValues: [...(config.costBpsValues ?? DEFAULT_COST_BPS_VALUES)],
    minTradesForCandidate: config.minTradesForCandidate ?? DEFAULT_MIN_TRADES_FOR_CANDIDATE,
    strategy: { ...BASE_SMA20_STRATEGY },
    researchWindow: {
      ...DEFAULT_RESEARCH_WINDOW,
      ...config.researchWindow,
      windowId: 'research',
    },
    holdoutWindow: {
      ...DEFAULT_HOLDOUT_WINDOW,
      ...config.holdoutWindow,
      windowId: 'holdout',
    },
  };
}

function summarizeRows(rows: PriceFeatureLabelRow[]): PriceFeatureLabelArtifact['summary'] {
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date) || a.ticker.localeCompare(b.ticker));
  const tickers = Array.from(new Set(sorted.map((row) => row.ticker))).sort((a, b) => a.localeCompare(b));
  return {
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
    usableLabelCounts: {
      '1d': sorted.filter((row) => row.label_available_1d).length,
      '5d': sorted.filter((row) => row.label_available_5d).length,
      '10d': sorted.filter((row) => row.label_available_10d).length,
      '20d': sorted.filter((row) => row.label_available_20d).length,
    },
    nullFeatureCounts: {
      ret_1d: sorted.filter((row) => row.ret_1d === null).length,
      ret_5d: sorted.filter((row) => row.ret_5d === null).length,
      ret_20d: sorted.filter((row) => row.ret_20d === null).length,
      sma_20_gap: sorted.filter((row) => row.sma_20_gap === null).length,
      sma_50_gap: sorted.filter((row) => row.sma_50_gap === null).length,
      vol_20d: sorted.filter((row) => row.vol_20d === null).length,
      drawdown_252d: sorted.filter((row) => row.drawdown_252d === null).length,
      range_pct: sorted.filter((row) => row.range_pct === null).length,
    },
  };
}

export function splitArtifactByWindow(
  artifact: PriceFeatureLabelArtifact,
  window: HoldoutWindowConfig,
): PriceFeatureLabelArtifact {
  validateWindow(window);
  const rows = artifact.rows.filter((row) => row.date >= window.startDate && row.date <= window.endDate);
  return {
    ...artifact,
    rows,
    summary: summarizeRows(rows),
  };
}

function windowCoverage(window: HoldoutWindowConfig, artifact: PriceFeatureLabelArtifact): WindowCoverage {
  return {
    windowId: window.windowId,
    startDate: window.startDate,
    endDate: window.endDate,
    rowCount: artifact.summary.rowCount,
    tickerCount: artifact.summary.tickers.length,
    tickerCoverage: artifact.summary.tickerCoverage,
  };
}

function countByVerdict(rows: Sma20HoldoutRow[]): Record<ProfitVerdict, number> {
  return countBy(rows.map((row) => row.profitVerdict), ['reject', 'weak', 'research_candidate', 'expand_universe']);
}

function compareNullableDesc(a: number | null, b: number | null): number {
  return (b ?? Number.NEGATIVE_INFINITY) - (a ?? Number.NEGATIVE_INFINITY);
}

function rowTieBreak(a: Sma20HoldoutRow, b: Sma20HoldoutRow): number {
  return a.windowId.localeCompare(b.windowId) || a.topN - b.topN || a.costBps - b.costBps;
}

export function bestHoldoutRowBySharpe(rows: Sma20HoldoutRow[]): Sma20HoldoutRow | null {
  return [...rows].sort((a, b) => compareNullableDesc(a.Sharpe, b.Sharpe) || rowTieBreak(a, b))[0] ?? null;
}

export function bestHoldoutRowByBenchmarkRelativeReturn(rows: Sma20HoldoutRow[]): Sma20HoldoutRow | null {
  return [...rows].sort((a, b) => compareNullableDesc(a.benchmarkRelativeReturn, b.benchmarkRelativeReturn) || rowTieBreak(a, b))[0] ?? null;
}

function verdictTransition(research: ProfitVerdict, holdout: ProfitVerdict): VerdictTransition {
  if (research === 'research_candidate' && holdout === 'research_candidate') return 'candidate_to_candidate';
  if (research === 'research_candidate' && holdout === 'weak') return 'candidate_to_weak';
  if (research === 'research_candidate' && holdout === 'reject') return 'candidate_to_reject';
  if (research === 'weak' && holdout === 'research_candidate') return 'weak_to_candidate';
  if (research === 'reject' && holdout === 'research_candidate') return 'reject_to_candidate';
  if (research === 'reject' && holdout === 'reject') return 'stable_reject';
  return 'mixed';
}

export function pairHoldoutRows(rows: Sma20HoldoutRow[]): Sma20HoldoutPair[] {
  const researchRows = rows.filter((row) => row.windowId === 'research');
  const holdoutRows = rows.filter((row) => row.windowId === 'holdout');
  return researchRows
    .map((research) => {
      const holdout = holdoutRows.find((row) => row.topN === research.topN && row.costBps === research.costBps);
      if (!holdout) return null;
      return {
        topN: research.topN,
        costBps: research.costBps,
        researchProfitVerdict: research.profitVerdict,
        holdoutProfitVerdict: holdout.profitVerdict,
        researchTotalReturn: research.totalReturn,
        holdoutTotalReturn: holdout.totalReturn,
        researchSharpe: research.Sharpe,
        holdoutSharpe: holdout.Sharpe,
        researchMaxDrawdown: research.maxDrawdown,
        holdoutMaxDrawdown: holdout.maxDrawdown,
        verdictTransition: verdictTransition(research.profitVerdict, holdout.profitVerdict),
      };
    })
    .filter((pair): pair is Sma20HoldoutPair => Boolean(pair))
    .sort((a, b) => a.topN - b.topN || a.costBps - b.costBps);
}

export function finalHoldoutVerdict(rows: Sma20HoldoutRow[], pairs: Sma20HoldoutPair[]): HoldoutVerdict {
  const holdoutRows = rows.filter((row) => row.windowId === 'holdout');
  const hasHoldoutCandidate = holdoutRows.some((row) => row.profitVerdict === 'research_candidate');
  const hasCandidateToCandidate = pairs.some((pair) => pair.verdictTransition === 'candidate_to_candidate');
  const has10BpsCandidate = holdoutRows.some((row) => row.costBps >= 10 && row.profitVerdict === 'research_candidate');
  const hasWeakOrBetter = holdoutRows.some((row) => row.profitVerdict === 'weak' || row.profitVerdict === 'research_candidate');

  if (hasHoldoutCandidate && hasCandidateToCandidate && has10BpsCandidate) return 'holdout_pass';
  if (hasWeakOrBetter) return 'holdout_fragile';
  return 'holdout_fail';
}

function recommendationFor(verdict: HoldoutVerdict): HoldoutRecommendation {
  if (verdict === 'holdout_pass') return 'continue_sma20_research';
  if (verdict === 'holdout_fragile') return 'rethink_sma20_parameters';
  return 'stop_sma20_family';
}

function toHoldoutRow(
  window: HoldoutWindowConfig,
  topN: number,
  costBps: number,
  report: ReturnType<typeof buildProfitBacktestReport>,
): Sma20HoldoutRow {
  const result = report.strategies[0];
  return {
    windowId: window.windowId,
    startDate: window.startDate,
    endDate: window.endDate,
    topN,
    costBps,
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
    profitVerdict: result.profitVerdict,
  };
}

export function buildSma20HoldoutValidationReport(
  artifact: PriceFeatureLabelArtifact,
  config: Sma20HoldoutValidationConfig = {},
): Sma20HoldoutValidationReport {
  const normalized = normalizeConfig(config);
  const researchArtifact = splitArtifactByWindow(artifact, normalized.researchWindow);
  const holdoutArtifact = splitArtifactByWindow(artifact, normalized.holdoutWindow);
  const rows: Sma20HoldoutRow[] = [];

  for (const window of [normalized.researchWindow, normalized.holdoutWindow]) {
    const windowArtifact = window.windowId === 'research' ? researchArtifact : holdoutArtifact;
    for (const topN of normalized.topNs) {
      for (const costBps of normalized.costBpsValues) {
        const strategy: ProfitStrategyConfig = {
          ...normalized.strategy,
          id: `sma20_gap_reversion_${window.windowId}_top${topN}_${costBps}bps`,
          topN,
          maxPositions: topN,
        };
        const backtest = buildProfitBacktestReport(windowArtifact, {
          inputPath: normalized.inputPath ?? undefined,
          initialCapital: normalized.initialCapital,
          costBps,
          topN,
          maxPositions: topN,
          minTradesForCandidate: normalized.minTradesForCandidate,
          strategies: [strategy],
        });
        rows.push(toHoldoutRow(window, topN, costBps, backtest));
      }
    }
  }

  const pairedComparisons = pairHoldoutRows(rows);
  const researchRows = rows.filter((row) => row.windowId === 'research');
  const holdoutRows = rows.filter((row) => row.windowId === 'holdout');
  const verdict = finalHoldoutVerdict(rows, pairedComparisons);

  return {
    generatedAt: new Date().toISOString(),
    lane: 'research_only',
    reportType: 'research_sma20_holdout_validation',
    schemaVersion: 'research_sma20_holdout_validation_v1',
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
    windowCoverage: [
      windowCoverage(normalized.researchWindow, researchArtifact),
      windowCoverage(normalized.holdoutWindow, holdoutArtifact),
    ],
    rows,
    pairedComparisons,
    summary: {
      researchCountByVerdict: countByVerdict(researchRows),
      holdoutCountByVerdict: countByVerdict(holdoutRows),
      holdoutResearchCandidatePairs: pairedComparisons.filter((pair) => pair.verdictTransition === 'candidate_to_candidate').length,
      holdoutWeakOrBetterPairs: pairedComparisons.filter((pair) => pair.holdoutProfitVerdict === 'weak' || pair.holdoutProfitVerdict === 'research_candidate').length,
      bestResearchRowBySharpe: bestHoldoutRowBySharpe(researchRows),
      bestHoldoutRowBySharpe: bestHoldoutRowBySharpe(holdoutRows),
      bestHoldoutRowByBenchmarkRelativeReturn: bestHoldoutRowByBenchmarkRelativeReturn(holdoutRows),
      topN6SurvivesHoldoutAt10Bps: holdoutRows.some((row) => row.topN === 6 && row.costBps === 10 && row.profitVerdict === 'research_candidate'),
      any25BpsRowSurvivesHoldout: holdoutRows.some((row) => row.costBps === 25 && row.profitVerdict === 'research_candidate'),
      finalHoldoutVerdict: verdict,
      finalRecommendation: recommendationFor(verdict),
    },
    warnings: [
      'Research-only holdout validation. Historical simulation only; not trading advice and not production evidence.',
      'Uses one fixed time split only; results can still be regime-dependent.',
      'Uses an existing local price-feature artifact only; no live provider calls are made.',
      'No model training, policy tuning, auto-trading, live trading, or runDailyScan behavior changes are performed.',
    ],
  };
}

export async function loadPriceFeatureArtifactForSma20Holdout(inputPath: string): Promise<PriceFeatureLabelArtifact> {
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
    `sma20-holdout-validation-${stamp}.json`,
  );
}

export async function persistSma20HoldoutValidationReport(
  report: Sma20HoldoutValidationReport,
  outputPath?: string,
): Promise<string> {
  const target = path.resolve(outputPath ?? defaultOutputPath());
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return target;
}
