import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PriceFeatureLabelArtifact, PriceFeatureLabelRow } from './price-feature-labels.js';
import {
  buildProfitBacktestReport,
  computeProfitMetrics,
  ProfitMetrics,
  ProfitTrade,
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
  roundFinite,
  validateDateWindow,
  validateNonOverlappingWindows,
} from './research-utils.js';
import { sectorForTicker, type SectorBucket } from './sma20-regime-risk-diagnostic.js';

export type RiskControlVariantId =
  | 'baseline'
  | 'avoid_deep_pullback'
  | 'avoid_deep_pullback_and_high_vol'
  | 'sector_cap_one'
  | 'avoid_deep_pullback_plus_sector_cap'
  | 'ticker_cooldown_after_loss'
  | 'avoid_deep_pullback_plus_cooldown';
export type RiskControlWindowId = 'full' | 'research' | 'holdout';
export type RiskControlVerdict = 'risk_control_pass' | 'risk_control_fragile' | 'risk_control_fail';
export type RiskControlRecommendation =
  | 'continue_sma20_with_risk_controls'
  | 'rethink_or_expand_controls'
  | 'stop_sma20_research';

export interface Sma20RiskControlConfig {
  inputPath?: string;
  outputPath?: string;
  initialCapital?: number;
  topNs?: number[];
  costBpsValues?: number[];
  minTradesForCandidate?: number;
  researchWindow?: { startDate: string; endDate: string };
  holdoutWindow?: { startDate: string; endDate: string };
  variantIds?: RiskControlVariantId[];
}

export interface Sma20RiskControlRow {
  variantId: RiskControlVariantId;
  topN: number;
  costBps: number;
  windowId: RiskControlWindowId;
  startDate: string | null;
  endDate: string | null;
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
  cashDragEstimate: number | null;
  notes: string[];
  warnings: string[];
}

export interface Sma20RiskControlSummary {
  totalRows: number;
  countByVariant: Record<RiskControlVariantId, number>;
  countByVerdictByWindow: Record<RiskControlWindowId, Record<ProfitVerdict, number>>;
  bestHoldoutRowBySharpe: Sma20RiskControlRow | null;
  bestHoldoutRowByBenchmarkRelativeReturn: Sma20RiskControlRow | null;
  bestHoldoutRowWithCostBpsAtLeast10: Sma20RiskControlRow | null;
  anyHoldoutResearchCandidate: boolean;
  anyHoldoutResearchCandidateAt10Bps: boolean;
  anyHoldoutResearchCandidateAt25Bps: boolean;
  anyRiskControlImprovesSharpeVsBaselineTopN6Cost10: boolean;
  anyRiskControlImprovesMaxDrawdownVsBaselineTopN6Cost10: boolean;
  anyRiskControlImprovesBenchmarkRelativeReturnVsBaselineTopN6Cost10: boolean;
  finalRiskControlVerdict: RiskControlVerdict;
  finalRecommendation: RiskControlRecommendation;
}

export interface Sma20RiskControlReport {
  generatedAt: string;
  lane: 'research_only';
  reportType: 'research_sma20_risk_control_test';
  schemaVersion: 'research_sma20_risk_control_test_v1';
  config: {
    inputPath: string | null;
    initialCapital: number;
    topNs: number[];
    costBpsValues: number[];
    minTradesForCandidate: number;
    researchWindow: { startDate: string; endDate: string };
    holdoutWindow: { startDate: string; endDate: string };
    variantIds: RiskControlVariantId[];
    strategy: ProfitStrategyConfig;
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
  artifactCoverage: {
    rowCount: number;
    tickerCount: number;
    firstDate: string | null;
    lastDate: string | null;
  };
  rows: Sma20RiskControlRow[];
  summary: Sma20RiskControlSummary;
  warnings: string[];
}

export interface Sma20RiskControlContext {
  rowsByDate: Map<string, PriceFeatureLabelRow[]>;
  tickerDateRows: Map<string, Map<string, PriceFeatureLabelRow>>;
  dates: string[];
  tickers: string[];
  volTerciles: { low: number; high: number };
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

interface EquityPoint {
  date: string;
  equity: number;
  exposure: number;
}

export interface SelectionDiagnostics {
  skippedCandidates: number;
  skippedRebalance: boolean;
  notes: string[];
}

export interface SimulatedRiskControl {
  equityCurve: EquityPoint[];
  trades: ProfitTrade[];
  turnoverNotional: number;
  averageHoldingsPerRebalance: number | null;
  skippedCandidates: number;
  skippedRebalances: number;
  cashDragEstimate: number | null;
  notes: string[];
  warnings: string[];
}

const DEFAULT_INITIAL_CAPITAL = 100_000;
const DEFAULT_TOP_NS = [4, 6];
const DEFAULT_COST_BPS_VALUES = [0, 10, 25];
const DEFAULT_MIN_TRADES_FOR_CANDIDATE = 20;
const DEFAULT_RESEARCH_WINDOW = { startDate: '2021-01-04', endDate: '2024-12-31' };
const DEFAULT_HOLDOUT_WINDOW = { startDate: '2025-01-01', endDate: '2026-04-24' };
const DEFAULT_VARIANTS: RiskControlVariantId[] = [
  'baseline',
  'avoid_deep_pullback',
  'avoid_deep_pullback_and_high_vol',
  'sector_cap_one',
  'avoid_deep_pullback_plus_sector_cap',
  'ticker_cooldown_after_loss',
  'avoid_deep_pullback_plus_cooldown',
];
const SMA20_STRATEGY: ProfitStrategyConfig = {
  id: 'sma20_gap_reversion_risk_control',
  feature: 'sma_20_gap',
  rankDirection: 'ascending',
  holdDays: 20,
  rebalanceFrequency: 'weekly',
};
const ALL_VERDICTS: ProfitVerdict[] = ['reject', 'weak', 'research_candidate', 'expand_universe'];
const ALL_WINDOWS: RiskControlWindowId[] = ['full', 'research', 'holdout'];
const DEEP_PULLBACK_THRESHOLD = -0.1;
const COOLDOWN_LOSS_THRESHOLD = -0.08;
const COOLDOWN_TRADING_DAYS = 20;

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function priceFor(row: PriceFeatureLabelRow | undefined): number | null {
  if (!row) return null;
  const price = finite(row.adjustedClose) ?? finite(row.close);
  return price !== null && price > 0 ? price : null;
}

function rowFor(ctx: Sma20RiskControlContext, ticker: string, date: string): PriceFeatureLabelRow | undefined {
  return ctx.tickerDateRows.get(ticker)?.get(date);
}

function rebalanceStep(): number {
  return 5;
}

export function buildSma20RiskControlContext(artifact: PriceFeatureLabelArtifact): Sma20RiskControlContext {
  const rows = [...artifact.rows].sort((a, b) => a.date.localeCompare(b.date) || a.ticker.localeCompare(b.ticker));
  const rowsByDate = new Map<string, PriceFeatureLabelRow[]>();
  const tickerDateRows = new Map<string, Map<string, PriceFeatureLabelRow>>();
  for (const row of rows) {
    rowsByDate.set(row.date, [...(rowsByDate.get(row.date) ?? []), row]);
    const tickerRows = tickerDateRows.get(row.ticker) ?? new Map<string, PriceFeatureLabelRow>();
    tickerRows.set(row.date, row);
    tickerDateRows.set(row.ticker, tickerRows);
  }
  const dates = Array.from(rowsByDate.keys()).sort((a, b) => a.localeCompare(b));
  const avgVols = dates
    .map((date) => averageVol20d(rowsByDate.get(date) ?? []))
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b);
  const low = avgVols[Math.floor((avgVols.length - 1) / 3)] ?? 0;
  const high = avgVols[Math.floor(((avgVols.length - 1) * 2) / 3)] ?? low;
  return {
    rowsByDate,
    tickerDateRows,
    dates,
    tickers: Array.from(tickerDateRows.keys()).sort((a, b) => a.localeCompare(b)),
    volTerciles: { low, high },
  };
}

function averageVol20d(rows: PriceFeatureLabelRow[]): number | null {
  return mean(rows.map((row) => finite(row.vol_20d)).filter((value): value is number => value !== null));
}

function isHighVol(ctx: Sma20RiskControlContext, date: string): boolean {
  const avgVol = averageVol20d(ctx.rowsByDate.get(date) ?? []);
  return avgVol !== null && avgVol >= ctx.volTerciles.high;
}

function variantUsesDeepPullback(variantId: RiskControlVariantId): boolean {
  return (
    variantId === 'avoid_deep_pullback' ||
    variantId === 'avoid_deep_pullback_and_high_vol' ||
    variantId === 'avoid_deep_pullback_plus_sector_cap' ||
    variantId === 'avoid_deep_pullback_plus_cooldown'
  );
}

function variantUsesHighVolSkip(variantId: RiskControlVariantId): boolean {
  return variantId === 'avoid_deep_pullback_and_high_vol';
}

function variantUsesSectorCap(variantId: RiskControlVariantId): boolean {
  return variantId === 'sector_cap_one' || variantId === 'avoid_deep_pullback_plus_sector_cap';
}

function variantUsesCooldown(variantId: RiskControlVariantId): boolean {
  return variantId === 'ticker_cooldown_after_loss' || variantId === 'avoid_deep_pullback_plus_cooldown';
}

export function selectSma20RiskControlCandidates(
  rows: PriceFeatureLabelRow[],
  ctx: Sma20RiskControlContext,
  signalDate: string,
  variantId: RiskControlVariantId,
  topN: number,
  cooldownUntilIndex: Map<string, number>,
): { selected: PriceFeatureLabelRow[]; diagnostics: SelectionDiagnostics } {
  const dateIndex = ctx.dates.indexOf(signalDate);
  const notes: string[] = [];
  if (variantUsesHighVolSkip(variantId) && isHighVol(ctx, signalDate)) {
    return {
      selected: [],
      diagnostics: { skippedCandidates: 0, skippedRebalance: true, notes: ['Skipped rebalance because universe average vol_20d was in the high-vol bucket.'] },
    };
  }

  const ranked = rows
    .filter((row) => finite(row.sma_20_gap) !== null && priceFor(row) !== null)
    .sort((a, b) => (finite(a.sma_20_gap) ?? 0) - (finite(b.sma_20_gap) ?? 0) || a.ticker.localeCompare(b.ticker));

  const selected: PriceFeatureLabelRow[] = [];
  const usedSectors = new Set<SectorBucket>();
  let skippedCandidates = 0;

  for (const row of ranked) {
    const gap = finite(row.sma_20_gap);
    const sector = sectorForTicker(row.ticker);
    const cooldownUntil = cooldownUntilIndex.get(row.ticker);
    const blockedByCooldown = cooldownUntil !== undefined && dateIndex >= 0 && dateIndex <= cooldownUntil;
    const blockedByDeepPullback = variantUsesDeepPullback(variantId) && gap !== null && gap <= DEEP_PULLBACK_THRESHOLD;
    const blockedBySector = variantUsesSectorCap(variantId) && usedSectors.has(sector);
    if (blockedByDeepPullback || blockedBySector || (variantUsesCooldown(variantId) && blockedByCooldown)) {
      skippedCandidates += 1;
      continue;
    }
    selected.push(row);
    usedSectors.add(sector);
    if (selected.length >= topN) break;
  }

  if (variantUsesDeepPullback(variantId)) notes.push('Excluded candidates with sma_20_gap <= -0.10.');
  if (variantUsesSectorCap(variantId)) notes.push('Applied max one selected name per sector bucket per rebalance.');
  if (variantUsesCooldown(variantId)) notes.push('Applied 20-trading-day ticker cooldown after closed losses <= -8%.');
  return { selected, diagnostics: { skippedCandidates, skippedRebalance: false, notes } };
}

export function simulateSma20RiskControlStrategy(
  artifact: PriceFeatureLabelArtifact,
  variantId: RiskControlVariantId,
  topN: number,
  costBps: number,
  initialCapital: number,
): SimulatedRiskControl {
  const ctx = buildSma20RiskControlContext(artifact);
  const cost = costBps / 10_000;
  let cash = initialCapital;
  let positions: Position[] = [];
  let pendingEntries: PendingEntry[] = [];
  let nextSignalIndex = 0;
  let turnoverNotional = 0;
  const trades: ProfitTrade[] = [];
  const warnings: string[] = [];
  const notes = new Set<string>();
  const equityCurve: EquityPoint[] = [];
  const cooldownUntilIndex = new Map<string, number>();
  const holdingsPerRebalance: number[] = [];
  let skippedCandidates = 0;
  let skippedRebalances = 0;

  for (let dateIndex = 0; dateIndex < ctx.dates.length; dateIndex += 1) {
    const date = ctx.dates[dateIndex];

    const exiting = positions.filter((position) => position.exitDate === date);
    for (const position of exiting) {
      const exitPrice = priceFor(rowFor(ctx, position.ticker, date));
      if (exitPrice === null) continue;
      const grossProceeds = position.shares * exitPrice;
      const exitCost = grossProceeds * cost;
      cash += grossProceeds - exitCost;
      turnoverNotional += grossProceeds;
      const grossReturn = exitPrice / position.entryPrice - 1;
      const netReturn = (exitPrice * (1 - cost)) / (position.entryPrice * (1 + cost)) - 1;
      if (variantUsesCooldown(variantId) && netReturn <= COOLDOWN_LOSS_THRESHOLD) {
        cooldownUntilIndex.set(position.ticker, dateIndex + COOLDOWN_TRADING_DAYS);
      }
      trades.push({
        strategyId: `sma20_${variantId}_top${topN}_${costBps}bps`,
        ticker: position.ticker,
        signalDate: position.signalDate,
        entryDate: position.entryDate,
        exitDate: position.exitDate,
        entryPrice: position.entryPrice,
        exitPrice,
        grossReturn: roundFinite(grossReturn) ?? grossReturn,
        netReturn: roundFinite(netReturn) ?? netReturn,
        capitalAllocated: roundFinite(position.capitalAllocated, 2) ?? position.capitalAllocated,
      });
    }
    positions = positions.filter((position) => position.exitDate !== date);

    const entering = pendingEntries.filter((entry) => entry.entryDate === date);
    if (entering.length) {
      const alloc = cash / entering.length;
      for (const entry of entering) {
        const entryCost = alloc * cost;
        const investable = alloc - entryCost;
        const shares = investable / entry.entryPrice;
        cash -= alloc;
        turnoverNotional += investable;
        positions.push({
          ticker: entry.ticker,
          signalDate: entry.signalDate,
          entryDate: entry.entryDate,
          exitDate: entry.exitDate,
          entryPrice: entry.entryPrice,
          shares,
          capitalAllocated: alloc,
        });
      }
      pendingEntries = pendingEntries.filter((entry) => entry.entryDate !== date);
    }

    if (dateIndex >= nextSignalIndex && positions.length === 0 && pendingEntries.length === 0) {
      const entryIdx = dateIndex + 1;
      const exitIdx = entryIdx + SMA20_STRATEGY.holdDays;
      if (entryIdx < ctx.dates.length && exitIdx < ctx.dates.length) {
        const entryDate = ctx.dates[entryIdx];
        const exitDate = ctx.dates[exitIdx];
        const selection = selectSma20RiskControlCandidates(
          ctx.rowsByDate.get(date) ?? [],
          ctx,
          date,
          variantId,
          topN,
          cooldownUntilIndex,
        );
        skippedCandidates += selection.diagnostics.skippedCandidates;
        for (const note of selection.diagnostics.notes) notes.add(note);
        if (selection.diagnostics.skippedRebalance) {
          skippedRebalances += 1;
          holdingsPerRebalance.push(0);
        } else {
          const validSignals = selection.selected
            .map((row) => {
              const entryPrice = priceFor(rowFor(ctx, row.ticker, entryDate));
              const exitPrice = priceFor(rowFor(ctx, row.ticker, exitDate));
              return entryPrice !== null && exitPrice !== null ? { row, entryPrice } : null;
            })
            .filter((item): item is { row: PriceFeatureLabelRow; entryPrice: number } => Boolean(item));
          holdingsPerRebalance.push(validSignals.length);
          for (const signal of validSignals) {
            pendingEntries.push({
              ticker: signal.row.ticker,
              signalDate: date,
              entryDate,
              exitDate,
              entryPrice: signal.entryPrice,
            });
          }
        }
      }
      nextSignalIndex = dateIndex + Math.max(rebalanceStep(), SMA20_STRATEGY.holdDays + 1);
    }

    let positionValue = 0;
    for (const position of positions) {
      const markPrice = priceFor(rowFor(ctx, position.ticker, date)) ?? position.entryPrice;
      positionValue += position.shares * markPrice;
    }
    const equity = cash + positionValue;
    equityCurve.push({
      date,
      equity: roundFinite(equity, 6) ?? equity,
      exposure: equity > 0 ? roundFinite(positionValue / equity) ?? 0 : 0,
    });
  }

  if (positions.length) warnings.push(`${variantId}: ${positions.length} open positions remained at artifact end and were marked but not closed.`);
  if (pendingEntries.length) warnings.push(`${variantId}: ${pendingEntries.length} pending entries remained at artifact end and were not opened.`);
  const averageHoldings = mean(holdingsPerRebalance);
  return {
    equityCurve,
    trades,
    turnoverNotional,
    averageHoldingsPerRebalance: roundFinite(averageHoldings),
    skippedCandidates,
    skippedRebalances,
    cashDragEstimate: averageHoldings !== null && topN > 0 ? roundFinite(1 - averageHoldings / topN) : null,
    notes: Array.from(notes).sort((a, b) => a.localeCompare(b)),
    warnings,
  };
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

function artifactForWindow(
  artifact: PriceFeatureLabelArtifact,
  windowId: RiskControlWindowId,
  config: Sma20RiskControlReport['config'],
): { artifact: PriceFeatureLabelArtifact; startDate: string | null; endDate: string | null } {
  if (windowId === 'research') {
    return {
      artifact: splitArtifact(artifact, config.researchWindow.startDate, config.researchWindow.endDate),
      startDate: config.researchWindow.startDate,
      endDate: config.researchWindow.endDate,
    };
  }
  if (windowId === 'holdout') {
    return {
      artifact: splitArtifact(artifact, config.holdoutWindow.startDate, config.holdoutWindow.endDate),
      startDate: config.holdoutWindow.startDate,
      endDate: config.holdoutWindow.endDate,
    };
  }
  return { artifact, startDate: artifact.summary.firstDate, endDate: artifact.summary.lastDate };
}

function baselineReport(
  artifact: PriceFeatureLabelArtifact,
  config: Sma20RiskControlReport['config'],
  topN: number,
  costBps: number,
) {
  return buildProfitBacktestReport(artifact, {
    inputPath: config.inputPath ?? undefined,
    initialCapital: config.initialCapital,
    costBps,
    topN,
    maxPositions: topN,
    minTradesForCandidate: config.minTradesForCandidate,
    strategies: [{ ...SMA20_STRATEGY, id: `sma20_baseline_top${topN}_${costBps}bps`, topN, maxPositions: topN }],
  });
}

function rowFromMetrics(
  variantId: RiskControlVariantId,
  topN: number,
  costBps: number,
  windowId: RiskControlWindowId,
  startDate: string | null,
  endDate: string | null,
  metrics: ProfitMetrics,
  verdict: ProfitVerdict,
  extras: Pick<Sma20RiskControlRow, 'averageHoldingsPerRebalance' | 'skippedCandidates' | 'skippedRebalances' | 'cashDragEstimate' | 'notes' | 'warnings'>,
): Sma20RiskControlRow {
  return {
    variantId,
    topN,
    costBps,
    windowId,
    startDate,
    endDate,
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

function averageHoldingsFromTrades(trades: ProfitTrade[], topN: number): Pick<Sma20RiskControlRow, 'averageHoldingsPerRebalance' | 'cashDragEstimate'> {
  const bySignal = new Map<string, number>();
  for (const trade of trades) bySignal.set(trade.signalDate, (bySignal.get(trade.signalDate) ?? 0) + 1);
  const avg = mean(Array.from(bySignal.values()));
  return {
    averageHoldingsPerRebalance: roundFinite(avg),
    cashDragEstimate: avg !== null && topN > 0 ? roundFinite(1 - avg / topN) : null,
  };
}

function buildRow(
  artifact: PriceFeatureLabelArtifact,
  config: Sma20RiskControlReport['config'],
  variantId: RiskControlVariantId,
  topN: number,
  costBps: number,
  windowId: RiskControlWindowId,
): Sma20RiskControlRow {
  const windowed = artifactForWindow(artifact, windowId, config);
  const benchmarkReport = baselineReport(windowed.artifact, config, topN, costBps);
  const benchmarkMetrics = benchmarkReport.baselines[0].metrics;
  if (variantId === 'baseline') {
    const result = benchmarkReport.strategies[0];
    const holdings = averageHoldingsFromTrades(result.trades, topN);
    return rowFromMetrics(variantId, topN, costBps, windowId, windowed.startDate, windowed.endDate, result.metrics, result.profitVerdict, {
      ...holdings,
      skippedCandidates: 0,
      skippedRebalances: 0,
      notes: ['Baseline uses the existing research profit backtest without candidate filters.'],
      warnings: result.warnings,
    });
  }

  const sim = simulateSma20RiskControlStrategy(windowed.artifact, variantId, topN, costBps, config.initialCapital);
  const metrics = computeProfitMetrics(sim.equityCurve, sim.trades, config.initialCapital, benchmarkMetrics, sim.turnoverNotional);
  return rowFromMetrics(
    variantId,
    topN,
    costBps,
    windowId,
    windowed.startDate,
    windowed.endDate,
    metrics,
    profitVerdict(metrics, benchmarkMetrics, config.minTradesForCandidate),
    {
      averageHoldingsPerRebalance: sim.averageHoldingsPerRebalance,
      skippedCandidates: sim.skippedCandidates,
      skippedRebalances: sim.skippedRebalances,
      cashDragEstimate: sim.cashDragEstimate,
      notes: sim.notes,
      warnings: sim.warnings,
    },
  );
}

function compareNullableDesc(a: number | null, b: number | null): number {
  return (b ?? Number.NEGATIVE_INFINITY) - (a ?? Number.NEGATIVE_INFINITY);
}

function rowTieBreak(a: Sma20RiskControlRow, b: Sma20RiskControlRow): number {
  return a.costBps - b.costBps || a.topN - b.topN || a.variantId.localeCompare(b.variantId) || a.windowId.localeCompare(b.windowId);
}

export function bestRiskControlRowBySharpe(rows: Sma20RiskControlRow[]): Sma20RiskControlRow | null {
  return [...rows].sort((a, b) => compareNullableDesc(a.Sharpe, b.Sharpe) || rowTieBreak(a, b))[0] ?? null;
}

export function bestRiskControlRowByBenchmarkRelativeReturn(rows: Sma20RiskControlRow[]): Sma20RiskControlRow | null {
  return [...rows].sort((a, b) => compareNullableDesc(a.benchmarkRelativeReturn, b.benchmarkRelativeReturn) || rowTieBreak(a, b))[0] ?? null;
}

function baselineComparison(rows: Sma20RiskControlRow[]): {
  improvesSharpe: boolean;
  improvesMaxDrawdown: boolean;
  improvesBenchmarkRelativeReturn: boolean;
} {
  const baseline = rows.find((row) => row.windowId === 'holdout' && row.variantId === 'baseline' && row.topN === 6 && row.costBps === 10);
  const controlled = rows.filter((row) => row.windowId === 'holdout' && row.variantId !== 'baseline');
  if (!baseline) return { improvesSharpe: false, improvesMaxDrawdown: false, improvesBenchmarkRelativeReturn: false };
  return {
    improvesSharpe: controlled.some((row) => (row.Sharpe ?? Number.NEGATIVE_INFINITY) > (baseline.Sharpe ?? Number.NEGATIVE_INFINITY)),
    improvesMaxDrawdown: controlled.some((row) => Math.abs(row.maxDrawdown) < Math.abs(baseline.maxDrawdown)),
    improvesBenchmarkRelativeReturn: controlled.some((row) => (row.benchmarkRelativeReturn ?? Number.NEGATIVE_INFINITY) > (baseline.benchmarkRelativeReturn ?? Number.NEGATIVE_INFINITY)),
  };
}

export function finalRiskControlVerdict(rows: Sma20RiskControlRow[]): RiskControlVerdict {
  const holdoutRows = rows.filter((row) => row.windowId === 'holdout');
  const controlledHoldout = holdoutRows.filter((row) => row.variantId !== 'baseline');
  const baseline = holdoutRows.find((row) => row.variantId === 'baseline' && row.topN === 6 && row.costBps === 10);
  if (!baseline) return 'risk_control_fail';
  const improvesSharpe = (row: Sma20RiskControlRow): boolean =>
    (row.Sharpe ?? Number.NEGATIVE_INFINITY) > (baseline.Sharpe ?? Number.NEGATIVE_INFINITY);
  const improvesMaxDrawdown = (row: Sma20RiskControlRow): boolean => Math.abs(row.maxDrawdown) < Math.abs(baseline.maxDrawdown);
  const improvesBenchmarkRelativeReturn = (row: Sma20RiskControlRow): boolean =>
    (row.benchmarkRelativeReturn ?? Number.NEGATIVE_INFINITY) > (baseline.benchmarkRelativeReturn ?? Number.NEGATIVE_INFINITY);
  const improvementCount = (row: Sma20RiskControlRow): number =>
    [improvesSharpe(row), improvesMaxDrawdown(row), improvesBenchmarkRelativeReturn(row)].filter(Boolean).length;

  if (
    controlledHoldout.some(
      (row) =>
        row.profitVerdict === 'research_candidate' &&
        row.costBps >= 10 &&
        Math.abs(row.maxDrawdown) <= Math.abs(baseline.maxDrawdown) &&
        improvesBenchmarkRelativeReturn(row),
    )
  ) {
    return 'risk_control_pass';
  }

  if (
    controlledHoldout.some(
      (row) =>
        (row.profitVerdict === 'weak' || row.profitVerdict === 'research_candidate') &&
        improvementCount(row) >= 2,
    )
  ) {
    return 'risk_control_fragile';
  }
  return 'risk_control_fail';
}

function recommendationFor(verdict: RiskControlVerdict): RiskControlRecommendation {
  if (verdict === 'risk_control_pass') return 'continue_sma20_with_risk_controls';
  if (verdict === 'risk_control_fragile') return 'rethink_or_expand_controls';
  return 'stop_sma20_research';
}

function normalizeConfig(config: Sma20RiskControlConfig): Sma20RiskControlReport['config'] {
  validateSma20RiskControlConfig(config);
  return {
    inputPath: config.inputPath ? path.resolve(config.inputPath) : null,
    initialCapital: config.initialCapital ?? DEFAULT_INITIAL_CAPITAL,
    topNs: [...(config.topNs ?? DEFAULT_TOP_NS)],
    costBpsValues: [...(config.costBpsValues ?? DEFAULT_COST_BPS_VALUES)],
    minTradesForCandidate: config.minTradesForCandidate ?? DEFAULT_MIN_TRADES_FOR_CANDIDATE,
    researchWindow: config.researchWindow ?? DEFAULT_RESEARCH_WINDOW,
    holdoutWindow: config.holdoutWindow ?? DEFAULT_HOLDOUT_WINDOW,
    variantIds: [...(config.variantIds ?? DEFAULT_VARIANTS)],
    strategy: { ...SMA20_STRATEGY },
  };
}

export function validateSma20RiskControlConfig(config: Sma20RiskControlConfig): void {
  assertPositiveNumber(config.initialCapital, 'initialCapital');
  assertNonNegativeInteger(config.minTradesForCandidate, 'minTradesForCandidate');
  for (const topN of config.topNs ?? DEFAULT_TOP_NS) assertPositiveInteger(topN, 'topNs');
  for (const costBps of config.costBpsValues ?? DEFAULT_COST_BPS_VALUES) assertNonNegativeNumber(costBps, 'costBpsValues');
  const variantIds = config.variantIds ?? DEFAULT_VARIANTS;
  if (!variantIds.length) throw new Error('Invalid variantIds: expected at least one variant.');
  for (const variantId of variantIds) {
    if (!DEFAULT_VARIANTS.includes(variantId)) throw new Error(`Invalid risk-control variant: ${String(variantId)}.`);
  }
  const researchWindow = config.researchWindow ?? DEFAULT_RESEARCH_WINDOW;
  const holdoutWindow = config.holdoutWindow ?? DEFAULT_HOLDOUT_WINDOW;
  validateDateWindow(researchWindow, 'research');
  validateDateWindow(holdoutWindow, 'holdout');
  validateNonOverlappingWindows(researchWindow, holdoutWindow, 'risk-control split');
}

function summaryFor(rows: Sma20RiskControlRow[]): Sma20RiskControlSummary {
  const holdoutRows = rows.filter((row) => row.windowId === 'holdout');
  const verdict = finalRiskControlVerdict(rows);
  const comparison = baselineComparison(rows);
  return {
    totalRows: rows.length,
    countByVariant: countBy(rows.map((row) => row.variantId), DEFAULT_VARIANTS),
    countByVerdictByWindow: Object.fromEntries(
      ALL_WINDOWS.map((windowId) => [
        windowId,
        countBy(rows.filter((row) => row.windowId === windowId).map((row) => row.profitVerdict), ALL_VERDICTS),
      ]),
    ) as Record<RiskControlWindowId, Record<ProfitVerdict, number>>,
    bestHoldoutRowBySharpe: bestRiskControlRowBySharpe(holdoutRows),
    bestHoldoutRowByBenchmarkRelativeReturn: bestRiskControlRowByBenchmarkRelativeReturn(holdoutRows),
    bestHoldoutRowWithCostBpsAtLeast10: bestRiskControlRowBySharpe(holdoutRows.filter((row) => row.costBps >= 10)),
    anyHoldoutResearchCandidate: holdoutRows.some((row) => row.profitVerdict === 'research_candidate'),
    anyHoldoutResearchCandidateAt10Bps: holdoutRows.some((row) => row.costBps >= 10 && row.profitVerdict === 'research_candidate'),
    anyHoldoutResearchCandidateAt25Bps: holdoutRows.some((row) => row.costBps >= 25 && row.profitVerdict === 'research_candidate'),
    anyRiskControlImprovesSharpeVsBaselineTopN6Cost10: comparison.improvesSharpe,
    anyRiskControlImprovesMaxDrawdownVsBaselineTopN6Cost10: comparison.improvesMaxDrawdown,
    anyRiskControlImprovesBenchmarkRelativeReturnVsBaselineTopN6Cost10: comparison.improvesBenchmarkRelativeReturn,
    finalRiskControlVerdict: verdict,
    finalRecommendation: recommendationFor(verdict),
  };
}

export function buildSma20RiskControlReport(
  artifact: PriceFeatureLabelArtifact,
  config: Sma20RiskControlConfig = {},
): Sma20RiskControlReport {
  const normalized = normalizeConfig(config);
  const rows: Sma20RiskControlRow[] = [];
  for (const variantId of normalized.variantIds) {
    for (const topN of normalized.topNs) {
      for (const costBps of normalized.costBpsValues) {
        for (const windowId of ALL_WINDOWS) {
          rows.push(buildRow(artifact, normalized, variantId, topN, costBps, windowId));
        }
      }
    }
  }
  return {
    generatedAt: new Date().toISOString(),
    lane: 'research_only',
    reportType: 'research_sma20_risk_control_test',
    schemaVersion: 'research_sma20_risk_control_test_v1',
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
    artifactCoverage: {
      rowCount: artifact.summary.rowCount,
      tickerCount: artifact.summary.tickers.length,
      firstDate: artifact.summary.firstDate,
      lastDate: artifact.summary.lastDate,
    },
    rows,
    summary: summaryFor(rows),
    warnings: [
      'Research-only SMA20 risk-control test. Historical simulation only; not trading advice and not production evidence.',
      'Uses existing local price-feature artifacts only; no live provider calls are made.',
      'No model training, production policy tuning, auto-trading, live trading, or runDailyScan behavior changes are performed.',
      'Risk controls are research hypotheses only and are not production filters.',
    ],
  };
}

export async function loadPriceFeatureArtifactForSma20RiskControl(inputPath: string): Promise<PriceFeatureLabelArtifact> {
  return JSON.parse(await readFile(path.resolve(inputPath), 'utf8')) as PriceFeatureLabelArtifact;
}

function defaultOutputPath(now = new Date()): string {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  return path.join(process.cwd(), '.dexter', 'signal-engine', 'research', 'analysis', `sma20-risk-control-test-${stamp}.json`);
}

export async function persistSma20RiskControlReport(report: Sma20RiskControlReport, outputPath?: string): Promise<string> {
  const target = path.resolve(outputPath ?? defaultOutputPath());
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return target;
}
