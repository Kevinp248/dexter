import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PriceFeatureLabelArtifact } from './price-feature-labels.js';
import {
  buildProfitBacktestReport,
  type ProfitStrategyConfig,
  type ProfitVerdict,
  type RebalanceFrequency,
} from './profit-backtest.js';

export type RobustnessVerdict = 'robust_candidate' | 'fragile_candidate' | 'reject_candidate';

export interface ProfitRobustnessGridConfig {
  inputPath?: string;
  outputPath?: string;
  initialCapital?: number;
  minTradesForCandidate?: number;
  holdDays?: number[];
  topNs?: number[];
  costBps?: number[];
  rebalanceFrequencies?: RebalanceFrequency[];
}

export interface ProfitRobustnessGridRow {
  strategyId: string;
  holdDays: number;
  topN: number;
  costBps: number;
  rebalanceFrequency: RebalanceFrequency;
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

export interface ParameterSensitivityRow {
  parameter: 'holdDays' | 'topN' | 'costBps';
  value: number;
  rows: number;
  researchCandidateRows: number;
  averageTotalReturn: number;
  averageSharpe: number | null;
  averageBenchmarkRelativeReturn: number | null;
  averageMaxDrawdown: number;
}

export interface ProfitRobustnessGridReport {
  generatedAt: string;
  lane: 'research_only';
  reportType: 'research_profit_robustness_grid';
  schemaVersion: 'research_profit_robustness_grid_v1';
  config: Required<Omit<ProfitRobustnessGridConfig, 'inputPath' | 'outputPath'>> & {
    inputPath: string | null;
    strategyFamily: 'sma20_gap_reversion';
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
  rows: ProfitRobustnessGridRow[];
  summary: {
    totalGridRows: number;
    countByVerdict: Record<ProfitVerdict, number>;
    bestRowBySharpe: ProfitRobustnessGridRow | null;
    bestRowByBenchmarkRelativeReturn: ProfitRobustnessGridRow | null;
    lowestDrawdownProfitableRow: ProfitRobustnessGridRow | null;
    parameterSensitivity: ParameterSensitivityRow[];
    finalRobustnessVerdict: RobustnessVerdict;
  };
  warnings: string[];
}

const DEFAULT_HOLD_DAYS = [5, 10, 20, 40];
const DEFAULT_TOP_NS = [1, 2, 3, 4];
const DEFAULT_COST_BPS = [0, 10, 25, 50];
const DEFAULT_REBALANCE_FREQUENCIES: RebalanceFrequency[] = ['weekly'];
const DEFAULT_INITIAL_CAPITAL = 100_000;
const DEFAULT_MIN_TRADES_FOR_CANDIDATE = 20;

function round(value: number | null, digits = 10): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

function average(values: Array<number | null>): number | null {
  const usable = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (!usable.length) return null;
  return usable.reduce((sum, value) => sum + value, 0) / usable.length;
}

function assertPositiveIntegerArray(values: number[] | undefined, label: string): void {
  if (values === undefined) return;
  if (!values.length) throw new Error(`Invalid grid config for ${label}: expected at least one value.`);
  for (const value of values) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`Invalid grid config for ${label}: ${value}. Expected positive integers.`);
    }
  }
}

function assertNonNegativeNumberArray(values: number[] | undefined, label: string): void {
  if (values === undefined) return;
  if (!values.length) throw new Error(`Invalid grid config for ${label}: expected at least one value.`);
  for (const value of values) {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`Invalid grid config for ${label}: ${value}. Expected non-negative numbers.`);
    }
  }
}

function validateGridConfig(config: ProfitRobustnessGridConfig): void {
  assertPositiveIntegerArray(config.holdDays, 'holdDays');
  assertPositiveIntegerArray(config.topNs, 'topNs');
  assertNonNegativeNumberArray(config.costBps, 'costBps');
  if (config.rebalanceFrequencies !== undefined) {
    if (!config.rebalanceFrequencies.length) {
      throw new Error('Invalid grid config for rebalanceFrequencies: expected at least one value.');
    }
    for (const frequency of config.rebalanceFrequencies) {
      if (frequency !== 'daily' && frequency !== 'weekly') {
        throw new Error(`Invalid grid config for rebalanceFrequencies: ${frequency}. Expected daily or weekly.`);
      }
    }
  }
  if (config.initialCapital !== undefined && (!Number.isFinite(config.initialCapital) || config.initialCapital <= 0)) {
    throw new Error(`Invalid grid config for initialCapital: ${config.initialCapital}. Expected a positive number.`);
  }
  if (
    config.minTradesForCandidate !== undefined &&
    (!Number.isInteger(config.minTradesForCandidate) || config.minTradesForCandidate < 0)
  ) {
    throw new Error(
      `Invalid grid config for minTradesForCandidate: ${config.minTradesForCandidate}. Expected a non-negative integer.`,
    );
  }
}

function normalizedConfig(config: ProfitRobustnessGridConfig): ProfitRobustnessGridReport['config'] {
  validateGridConfig(config);
  return {
    inputPath: config.inputPath ? path.resolve(config.inputPath) : null,
    initialCapital: config.initialCapital ?? DEFAULT_INITIAL_CAPITAL,
    minTradesForCandidate: config.minTradesForCandidate ?? DEFAULT_MIN_TRADES_FOR_CANDIDATE,
    holdDays: config.holdDays ?? DEFAULT_HOLD_DAYS,
    topNs: config.topNs ?? DEFAULT_TOP_NS,
    costBps: config.costBps ?? DEFAULT_COST_BPS,
    rebalanceFrequencies: config.rebalanceFrequencies ?? DEFAULT_REBALANCE_FREQUENCIES,
    strategyFamily: 'sma20_gap_reversion',
  };
}

export function expandProfitRobustnessGrid(
  config: ProfitRobustnessGridConfig = {},
): Array<{
  holdDays: number;
  topN: number;
  costBps: number;
  rebalanceFrequency: RebalanceFrequency;
}> {
  const cfg = normalizedConfig(config);
  const rows: Array<{
    holdDays: number;
    topN: number;
    costBps: number;
    rebalanceFrequency: RebalanceFrequency;
  }> = [];
  for (const holdDays of cfg.holdDays) {
    for (const topN of cfg.topNs) {
      for (const costBps of cfg.costBps) {
        for (const rebalanceFrequency of cfg.rebalanceFrequencies) {
          rows.push({ holdDays, topN, costBps, rebalanceFrequency });
        }
      }
    }
  }
  return rows;
}

function strategyFor(row: {
  holdDays: number;
  topN: number;
  rebalanceFrequency: RebalanceFrequency;
}): ProfitStrategyConfig {
  return {
    id: 'sma20_gap_reversion_20d',
    feature: 'sma_20_gap',
    rankDirection: 'ascending',
    holdDays: row.holdDays,
    rebalanceFrequency: row.rebalanceFrequency,
    topN: row.topN,
    maxPositions: row.topN,
  };
}

function countByVerdict(rows: ProfitRobustnessGridRow[]): Record<ProfitVerdict, number> {
  return {
    reject: rows.filter((row) => row.profitVerdict === 'reject').length,
    weak: rows.filter((row) => row.profitVerdict === 'weak').length,
    research_candidate: rows.filter((row) => row.profitVerdict === 'research_candidate').length,
    expand_universe: rows.filter((row) => row.profitVerdict === 'expand_universe').length,
  };
}

function bestBy(
  rows: ProfitRobustnessGridRow[],
  score: (row: ProfitRobustnessGridRow) => number | null,
): ProfitRobustnessGridRow | null {
  const sorted = rows
    .map((row) => ({ row, value: score(row) }))
    .filter((item): item is { row: ProfitRobustnessGridRow; value: number } => item.value !== null)
    .sort(
      (a, b) =>
        b.value - a.value ||
        (b.row.benchmarkRelativeReturn ?? Number.NEGATIVE_INFINITY) -
          (a.row.benchmarkRelativeReturn ?? Number.NEGATIVE_INFINITY) ||
        a.row.maxDrawdown - b.row.maxDrawdown ||
        a.row.holdDays - b.row.holdDays ||
        a.row.topN - b.row.topN ||
        a.row.costBps - b.row.costBps ||
        a.row.rebalanceFrequency.localeCompare(b.row.rebalanceFrequency),
    );
  return sorted[0]?.row ?? null;
}

function sensitivityFor(
  rows: ProfitRobustnessGridRow[],
  parameter: ParameterSensitivityRow['parameter'],
): ParameterSensitivityRow[] {
  const values = Array.from(new Set(rows.map((row) => row[parameter]))).sort((a, b) => a - b);
  return values.map((value) => {
    const group = rows.filter((row) => row[parameter] === value);
    return {
      parameter,
      value,
      rows: group.length,
      researchCandidateRows: group.filter((row) => row.profitVerdict === 'research_candidate').length,
      averageTotalReturn: round(average(group.map((row) => row.totalReturn))) ?? 0,
      averageSharpe: round(average(group.map((row) => row.Sharpe))),
      averageBenchmarkRelativeReturn: round(average(group.map((row) => row.benchmarkRelativeReturn))),
      averageMaxDrawdown: round(average(group.map((row) => row.maxDrawdown))) ?? 0,
    };
  });
}

export function robustnessVerdictForRows(rows: ProfitRobustnessGridRow[]): RobustnessVerdict {
  const researchRows = rows.filter((row) => row.profitVerdict === 'research_candidate');
  if (!researchRows.length) return 'reject_candidate';

  const candidateRatio = researchRows.length / rows.length;
  const survivesHigherCost = researchRows.some((row) => row.costBps >= 25);
  const bestSharpe = bestBy(rows, (row) => row.Sharpe);
  const bestNotOnlyTopN1 = bestSharpe !== null && bestSharpe.topN !== 1;

  if (candidateRatio >= 0.25 && survivesHigherCost && bestNotOnlyTopN1) {
    return 'robust_candidate';
  }
  return 'fragile_candidate';
}

function buildSummary(rows: ProfitRobustnessGridRow[]): ProfitRobustnessGridReport['summary'] {
  const profitableRows = rows.filter((row) => row.totalReturn > 0);
  return {
    totalGridRows: rows.length,
    countByVerdict: countByVerdict(rows),
    bestRowBySharpe: bestBy(rows, (row) => row.Sharpe),
    bestRowByBenchmarkRelativeReturn: bestBy(rows, (row) => row.benchmarkRelativeReturn),
    lowestDrawdownProfitableRow: bestBy(profitableRows, (row) => -Math.abs(row.maxDrawdown)),
    parameterSensitivity: [
      ...sensitivityFor(rows, 'holdDays'),
      ...sensitivityFor(rows, 'topN'),
      ...sensitivityFor(rows, 'costBps'),
    ],
    finalRobustnessVerdict: robustnessVerdictForRows(rows),
  };
}

export function buildProfitRobustnessGridReport(
  artifact: PriceFeatureLabelArtifact,
  config: ProfitRobustnessGridConfig = {},
): ProfitRobustnessGridReport {
  const cfg = normalizedConfig(config);
  const grid = expandProfitRobustnessGrid(config);

  const rows: ProfitRobustnessGridRow[] = grid.map((gridRow) => {
    const report = buildProfitBacktestReport(artifact, {
      inputPath: cfg.inputPath ?? undefined,
      initialCapital: cfg.initialCapital,
      costBps: gridRow.costBps,
      topN: gridRow.topN,
      maxPositions: gridRow.topN,
      minTradesForCandidate: cfg.minTradesForCandidate,
      strategies: [strategyFor(gridRow)],
    });
    const result = report.strategies[0];
    const metrics = result.metrics;
    return {
      strategyId: 'sma20_gap_reversion',
      holdDays: gridRow.holdDays,
      topN: gridRow.topN,
      costBps: gridRow.costBps,
      rebalanceFrequency: gridRow.rebalanceFrequency,
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
      profitVerdict: result.profitVerdict,
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    lane: 'research_only',
    reportType: 'research_profit_robustness_grid',
    schemaVersion: 'research_profit_robustness_grid_v1',
    config: cfg,
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
    summary: buildSummary(rows),
    warnings: [
      'Research-only robustness grid. Historical simulation only; not trading advice and not production evidence.',
      'Uses the same local artifact universe; no new data is fetched and no live provider is used.',
      'No holdout period is created by this grid; larger universe and holdout testing are still required.',
      'No model training, policy tuning, auto-trading, or runDailyScan behavior changes are performed.',
    ],
  };
}

export async function loadPriceFeatureArtifactForRobustness(inputPath: string): Promise<PriceFeatureLabelArtifact> {
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
    `profit-robustness-grid-${stamp}.json`,
  );
}

export async function persistProfitRobustnessGridReport(
  report: ProfitRobustnessGridReport,
  outputPath?: string,
): Promise<string> {
  const target = path.resolve(outputPath ?? defaultOutputPath());
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return target;
}
