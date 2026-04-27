import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PriceFeatureLabelArtifact, PriceFeatureLabelRow } from './price-feature-labels.js';

export type ProfitStrategyId =
  | 'drawdown_reversal_20d'
  | 'ret_1d_reversal_5d'
  | 'sma20_gap_reversion_20d'
  | string;

export type RebalanceFrequency = 'daily' | 'weekly';
export type ProfitVerdict = 'reject' | 'weak' | 'research_candidate' | 'expand_universe';
export type ProfitFeature = 'drawdown_252d' | 'ret_1d' | 'ret_5d' | 'ret_20d' | 'sma_20_gap' | 'sma_50_gap' | 'vol_20d';
export type ProfitRankDirection = 'ascending' | 'descending';

export interface ProfitBacktestConfig {
  inputPath?: string;
  outputPath?: string;
  initialCapital?: number;
  costBps?: number;
  topN?: number;
  maxPositions?: number;
  minTradesForCandidate?: number;
  strategies?: ProfitStrategyConfig[];
}

export interface ProfitStrategyConfig {
  id: ProfitStrategyId;
  feature: ProfitFeature;
  rankDirection: ProfitRankDirection;
  holdDays: number;
  rebalanceFrequency: RebalanceFrequency;
  topN?: number;
  maxPositions?: number;
}

interface ValidationSource {
  initialCapital: string;
  costBps: string;
  topN: string;
  maxPositions: string;
  minTradesForCandidate: string;
}

export interface ProfitTrade {
  strategyId: string;
  ticker: string;
  signalDate: string;
  entryDate: string;
  exitDate: string;
  entryPrice: number;
  exitPrice: number;
  grossReturn: number;
  netReturn: number;
  capitalAllocated: number;
}

export interface MonthlyReturn {
  month: string;
  return: number;
}

export interface ProfitMetrics {
  totalReturn: number;
  CAGR: number;
  annualizedVolatility: number;
  Sharpe: number | null;
  maxDrawdown: number;
  Calmar: number | null;
  winRate: number | null;
  averageTradeReturn: number | null;
  medianTradeReturn: number | null;
  numberOfTrades: number;
  turnover: number;
  averageExposure: number;
  bestMonth: MonthlyReturn | null;
  worstMonth: MonthlyReturn | null;
  benchmarkRelativeReturn: number | null;
  benchmarkRelativeMaxDrawdown: number | null;
}

export interface ProfitStrategyResult {
  id: string;
  kind: 'strategy' | 'baseline';
  description: string;
  config: ProfitStrategyConfig | null;
  metrics: ProfitMetrics;
  profitVerdict: ProfitVerdict;
  trades: ProfitTrade[];
  warnings: string[];
}

export interface ProfitBacktestReport {
  generatedAt: string;
  lane: 'research_only';
  reportType: 'research_profit_backtest';
  schemaVersion: 'research_profit_backtest_v1';
  config: Required<Omit<ProfitBacktestConfig, 'inputPath' | 'outputPath' | 'strategies'>> & {
    inputPath: string | null;
    strategies: ProfitStrategyConfig[];
    nonOverlap: true;
    priceBasis: 'adjusted_close_if_available_else_close';
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
  baselines: ProfitStrategyResult[];
  strategies: ProfitStrategyResult[];
  warnings: string[];
}

interface BacktestContext {
  rowsByDate: Map<string, PriceFeatureLabelRow[]>;
  rowsByTicker: Map<string, PriceFeatureLabelRow[]>;
  tickerDateRows: Map<string, Map<string, PriceFeatureLabelRow>>;
  dates: string[];
  tickers: string[];
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

const DEFAULT_INITIAL_CAPITAL = 100_000;
const DEFAULT_COST_BPS = 10;
const DEFAULT_TOP_N = 2;
const DEFAULT_MAX_POSITIONS = 3;
const DEFAULT_MIN_TRADES_FOR_CANDIDATE = 20;
const SUPPORTED_PROFIT_FEATURES = new Set<ProfitFeature>([
  'drawdown_252d',
  'ret_1d',
  'ret_5d',
  'ret_20d',
  'sma_20_gap',
  'sma_50_gap',
  'vol_20d',
]);
const SUPPORTED_RANK_DIRECTIONS = new Set<ProfitRankDirection>(['ascending', 'descending']);
const TRADING_DAYS_PER_YEAR = 252;
const CONFIG_VALIDATION_SOURCE: ValidationSource = {
  initialCapital: 'initialCapital',
  costBps: 'costBps',
  topN: 'topN',
  maxPositions: 'maxPositions',
  minTradesForCandidate: 'minTradesForCandidate',
};

export const DEFAULT_PROFIT_STRATEGIES: ProfitStrategyConfig[] = [
  {
    id: 'drawdown_reversal_20d',
    feature: 'drawdown_252d',
    rankDirection: 'ascending',
    holdDays: 20,
    rebalanceFrequency: 'weekly',
  },
  {
    id: 'ret_1d_reversal_5d',
    feature: 'ret_1d',
    rankDirection: 'ascending',
    holdDays: 5,
    rebalanceFrequency: 'weekly',
  },
  {
    id: 'sma20_gap_reversion_20d',
    feature: 'sma_20_gap',
    rankDirection: 'ascending',
    holdDays: 20,
    rebalanceFrequency: 'weekly',
  },
];

function round(value: number | null, digits = 10): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function mean(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function stdDev(values: number[]): number | null {
  if (values.length < 2) return null;
  const avg = mean(values);
  if (avg === null) return null;
  const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function assertPositiveNumber(value: number | undefined, label: string): void {
  if (value === undefined) return;
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid value for ${label}: ${value}. Expected a positive number.`);
  }
}

function assertNonNegativeNumber(value: number | undefined, label: string): void {
  if (value === undefined) return;
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid value for ${label}: ${value}. Expected a non-negative number.`);
  }
}

function assertPositiveInteger(value: number | undefined, label: string): void {
  if (value === undefined) return;
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid value for ${label}: ${value}. Expected a positive integer.`);
  }
}

function assertNonNegativeInteger(value: number | undefined, label: string): void {
  if (value === undefined) return;
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Invalid value for ${label}: ${value}. Expected a non-negative integer.`);
  }
}

export function validateProfitBacktestConfig(
  config: ProfitBacktestConfig,
  source: Partial<ValidationSource> = {},
): void {
  const labels = { ...CONFIG_VALIDATION_SOURCE, ...source };
  assertPositiveNumber(config.initialCapital, labels.initialCapital);
  assertNonNegativeNumber(config.costBps, labels.costBps);
  assertPositiveInteger(config.topN, labels.topN);
  assertPositiveInteger(config.maxPositions, labels.maxPositions);
  assertNonNegativeInteger(config.minTradesForCandidate, labels.minTradesForCandidate);

  for (const strategy of config.strategies ?? []) {
    if (!SUPPORTED_PROFIT_FEATURES.has(strategy.feature)) {
      throw new Error(`Invalid feature for ${strategy.id}: ${String(strategy.feature)}.`);
    }
    if (!SUPPORTED_RANK_DIRECTIONS.has(strategy.rankDirection)) {
      throw new Error(`Invalid rankDirection for ${strategy.id}: ${String(strategy.rankDirection)}.`);
    }
    assertPositiveInteger(strategy.topN, `${strategy.id}.topN`);
    assertPositiveInteger(strategy.maxPositions, `${strategy.id}.maxPositions`);
    assertPositiveInteger(strategy.holdDays, `${strategy.id}.holdDays`);
  }
}

function normalizeConfig(config: ProfitBacktestConfig): Required<Omit<ProfitBacktestConfig, 'inputPath' | 'outputPath' | 'strategies'>> & {
  inputPath: string | null;
  strategies: ProfitStrategyConfig[];
  nonOverlap: true;
  priceBasis: 'adjusted_close_if_available_else_close';
} {
  validateProfitBacktestConfig(config);
  const topN = config.topN ?? DEFAULT_TOP_N;
  const maxPositions = config.maxPositions ?? DEFAULT_MAX_POSITIONS;
  return {
    inputPath: config.inputPath ? path.resolve(config.inputPath) : null,
    initialCapital: config.initialCapital ?? DEFAULT_INITIAL_CAPITAL,
    costBps: config.costBps ?? DEFAULT_COST_BPS,
    topN,
    maxPositions,
    minTradesForCandidate: config.minTradesForCandidate ?? DEFAULT_MIN_TRADES_FOR_CANDIDATE,
    strategies: (config.strategies ?? DEFAULT_PROFIT_STRATEGIES).map((strategy) => ({
      ...strategy,
      topN: strategy.topN ?? topN,
      maxPositions: strategy.maxPositions ?? maxPositions,
    })),
    nonOverlap: true,
    priceBasis: 'adjusted_close_if_available_else_close',
  };
}

function buildContext(artifact: PriceFeatureLabelArtifact): BacktestContext {
  const rows = [...artifact.rows].sort((a, b) => a.date.localeCompare(b.date) || a.ticker.localeCompare(b.ticker));
  const rowsByDate = new Map<string, PriceFeatureLabelRow[]>();
  const rowsByTicker = new Map<string, PriceFeatureLabelRow[]>();
  const tickerDateRows = new Map<string, Map<string, PriceFeatureLabelRow>>();

  for (const row of rows) {
    const dateRows = rowsByDate.get(row.date) ?? [];
    dateRows.push(row);
    rowsByDate.set(row.date, dateRows);

    const tickerRows = rowsByTicker.get(row.ticker) ?? [];
    tickerRows.push(row);
    rowsByTicker.set(row.ticker, tickerRows);

    const dateMap = tickerDateRows.get(row.ticker) ?? new Map<string, PriceFeatureLabelRow>();
    dateMap.set(row.date, row);
    tickerDateRows.set(row.ticker, dateMap);
  }

  return {
    rowsByDate,
    rowsByTicker,
    tickerDateRows,
    dates: Array.from(rowsByDate.keys()).sort((a, b) => a.localeCompare(b)),
    tickers: Array.from(rowsByTicker.keys()).sort((a, b) => a.localeCompare(b)),
  };
}

function priceFor(row: PriceFeatureLabelRow | undefined): number | null {
  if (!row) return null;
  const price = asNumber(row.adjustedClose) ?? asNumber(row.close);
  return price !== null && price > 0 ? price : null;
}

function rowFor(ctx: BacktestContext, ticker: string, date: string): PriceFeatureLabelRow | undefined {
  return ctx.tickerDateRows.get(ticker)?.get(date);
}

function nextIndex(currentIndex: number, dates: string[]): number | null {
  const idx = currentIndex + 1;
  return idx < dates.length ? idx : null;
}

function exitIndex(entryIndex: number, holdDays: number, dates: string[]): number | null {
  const idx = entryIndex + holdDays;
  return idx < dates.length ? idx : null;
}

function rebalanceStep(frequency: RebalanceFrequency): number {
  return frequency === 'daily' ? 1 : 5;
}

function selectRows(rows: PriceFeatureLabelRow[], strategy: ProfitStrategyConfig, limit: number): PriceFeatureLabelRow[] {
  return rows
    .filter((row) => asNumber(row[strategy.feature]) !== null && priceFor(row) !== null)
    .sort((a, b) => {
      const aValue = asNumber(a[strategy.feature]) ?? 0;
      const bValue = asNumber(b[strategy.feature]) ?? 0;
      const valueSort = strategy.rankDirection === 'ascending' ? aValue - bValue : bValue - aValue;
      return valueSort || a.ticker.localeCompare(b.ticker);
    })
    .slice(0, limit);
}

function monthlyReturns(equityCurve: EquityPoint[]): MonthlyReturn[] {
  const groups = new Map<string, EquityPoint[]>();
  for (const point of equityCurve) {
    const month = point.date.slice(0, 7);
    const arr = groups.get(month) ?? [];
    arr.push(point);
    groups.set(month, arr);
  }

  return Array.from(groups.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, points]) => {
      const first = points[0];
      const last = points[points.length - 1];
      return {
        month,
        return: first.equity === 0 ? 0 : round(last.equity / first.equity - 1) ?? 0,
      };
    });
}

export function maxDrawdownFromEquity(equityValues: number[]): number {
  if (!equityValues.length) return 0;
  let peak = equityValues[0];
  let maxDrawdown = 0;
  for (const value of equityValues) {
    peak = Math.max(peak, value);
    if (peak > 0) {
      maxDrawdown = Math.min(maxDrawdown, value / peak - 1);
    }
  }
  return round(maxDrawdown) ?? 0;
}

export function computeProfitMetrics(
  equityCurve: EquityPoint[],
  trades: ProfitTrade[],
  initialCapital: number,
  benchmark?: ProfitMetrics,
  turnoverNotional = 0,
): ProfitMetrics {
  const endingEquity = equityCurve[equityCurve.length - 1]?.equity ?? initialCapital;
  const totalReturn = initialCapital === 0 ? 0 : endingEquity / initialCapital - 1;
  const dailyReturns: number[] = [];
  for (let i = 1; i < equityCurve.length; i += 1) {
    const prev = equityCurve[i - 1].equity;
    const current = equityCurve[i].equity;
    if (prev > 0) dailyReturns.push(current / prev - 1);
  }

  const years = equityCurve.length > 1 ? (equityCurve.length - 1) / TRADING_DAYS_PER_YEAR : 0;
  const CAGR = years > 0 && endingEquity > 0 ? (endingEquity / initialCapital) ** (1 / years) - 1 : totalReturn;
  const dailyVol = stdDev(dailyReturns) ?? 0;
  const annualizedVolatility = dailyVol * Math.sqrt(TRADING_DAYS_PER_YEAR);
  const avgDailyReturn = mean(dailyReturns) ?? 0;
  const Sharpe = annualizedVolatility > 0 ? (avgDailyReturn * TRADING_DAYS_PER_YEAR) / annualizedVolatility : null;
  const maxDrawdown = maxDrawdownFromEquity(equityCurve.map((point) => point.equity));
  const Calmar = maxDrawdown < 0 ? CAGR / Math.abs(maxDrawdown) : null;

  const tradeReturns = trades.map((trade) => trade.netReturn);
  const monthlies = monthlyReturns(equityCurve);
  const bestMonth = monthlies.length ? [...monthlies].sort((a, b) => b.return - a.return)[0] : null;
  const worstMonth = monthlies.length ? [...monthlies].sort((a, b) => a.return - b.return)[0] : null;

  return {
    totalReturn: round(totalReturn) ?? 0,
    CAGR: round(CAGR) ?? 0,
    annualizedVolatility: round(annualizedVolatility) ?? 0,
    Sharpe: round(Sharpe),
    maxDrawdown: round(maxDrawdown) ?? 0,
    Calmar: round(Calmar),
    winRate: tradeReturns.length ? round(tradeReturns.filter((value) => value > 0).length / tradeReturns.length) : null,
    averageTradeReturn: round(mean(tradeReturns)),
    medianTradeReturn: round(median(tradeReturns)),
    numberOfTrades: trades.length,
    turnover: initialCapital > 0 ? round(turnoverNotional / initialCapital) ?? 0 : 0,
    averageExposure: equityCurve.length ? round(mean(equityCurve.map((point) => point.exposure))) ?? 0 : 0,
    bestMonth,
    worstMonth,
    benchmarkRelativeReturn: benchmark ? round(totalReturn - benchmark.totalReturn) : null,
    benchmarkRelativeMaxDrawdown: benchmark ? round(maxDrawdown - benchmark.maxDrawdown) : null,
  };
}

function simulateStrategy(
  ctx: BacktestContext,
  strategy: ProfitStrategyConfig,
  initialCapital: number,
  costBps: number,
): { equityCurve: EquityPoint[]; trades: ProfitTrade[]; warnings: string[]; turnoverNotional: number } {
  const cost = costBps / 10_000;
  let cash = initialCapital;
  let positions: Position[] = [];
  let pendingEntries: PendingEntry[] = [];
  let nextSignalIndex = 0;
  let turnoverNotional = 0;
  const trades: ProfitTrade[] = [];
  const warnings: string[] = [];
  const equityCurve: EquityPoint[] = [];
  const step = rebalanceStep(strategy.rebalanceFrequency);
  const topN = strategy.topN ?? DEFAULT_TOP_N;
  const maxPositions = strategy.maxPositions ?? DEFAULT_MAX_POSITIONS;
  const selectionCount = Math.max(1, Math.min(topN, maxPositions));

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
      trades.push({
        strategyId: strategy.id,
        ticker: position.ticker,
        signalDate: position.signalDate,
        entryDate: position.entryDate,
        exitDate: position.exitDate,
        entryPrice: position.entryPrice,
        exitPrice,
        grossReturn: round(grossReturn) ?? grossReturn,
        netReturn: round(netReturn) ?? netReturn,
        capitalAllocated: round(position.capitalAllocated, 2) ?? position.capitalAllocated,
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
      const entryIdx = nextIndex(dateIndex, ctx.dates);
      const targetExitIdx = entryIdx === null ? null : exitIndex(entryIdx, strategy.holdDays, ctx.dates);
      if (entryIdx !== null && targetExitIdx !== null) {
        const signalRows = selectRows(ctx.rowsByDate.get(date) ?? [], strategy, selectionCount);
        const entryDate = ctx.dates[entryIdx];
        const exitDate = ctx.dates[targetExitIdx];
        const validSignals = signalRows
          .map((row) => {
            const entryPrice = priceFor(rowFor(ctx, row.ticker, entryDate));
            const exitPrice = priceFor(rowFor(ctx, row.ticker, exitDate));
            return entryPrice !== null && exitPrice !== null ? { row, entryPrice } : null;
          })
          .filter((item): item is { row: PriceFeatureLabelRow; entryPrice: number } => Boolean(item));

        if (validSignals.length) {
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
      nextSignalIndex = dateIndex + Math.max(step, strategy.holdDays + 1);
    }

    let positionValue = 0;
    for (const position of positions) {
      const markPrice = priceFor(rowFor(ctx, position.ticker, date)) ?? position.entryPrice;
      positionValue += position.shares * markPrice;
    }
    const equity = cash + positionValue;
    equityCurve.push({
      date,
      equity: round(equity, 6) ?? equity,
      exposure: equity > 0 ? round(positionValue / equity) ?? 0 : 0,
    });
  }

  if (positions.length) {
    warnings.push(`${strategy.id}: ${positions.length} open positions remained at the end of the artifact and were marked but not closed.`);
  }
  if (pendingEntries.length) {
    warnings.push(`${strategy.id}: ${pendingEntries.length} pending entries remained at the end of the artifact and were not opened.`);
  }

  return { equityCurve, trades, warnings, turnoverNotional };
}

function baselineBuyHold(
  ctx: BacktestContext,
  initialCapital: number,
  costBps: number,
): { equityCurve: EquityPoint[]; trades: ProfitTrade[]; turnoverNotional: number } {
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
    const entryCost = alloc * cost;
    const investable = alloc - entryCost;
    cash -= alloc;
    turnoverNotional += investable;
    positions.push({
      ticker,
      signalDate: firstDate,
      entryDate: firstDate,
      exitDate: lastDate,
      entryPrice,
      shares: investable / entryPrice,
      capitalAllocated: alloc,
    });
  }

  const equityCurve: EquityPoint[] = [];
  for (const date of ctx.dates) {
    const positionValue = positions.reduce((sum, position) => {
      const markPrice = priceFor(rowFor(ctx, position.ticker, date)) ?? position.entryPrice;
      return sum + position.shares * markPrice;
    }, 0);
    const equity = cash + positionValue;
    equityCurve.push({ date, equity: round(equity, 6) ?? equity, exposure: equity > 0 ? round(positionValue / equity) ?? 0 : 0 });
  }

  const trades: ProfitTrade[] = [];
  for (const position of positions) {
    const exitPrice = priceFor(rowFor(ctx, position.ticker, lastDate));
    if (exitPrice === null) continue;
    const grossProceeds = position.shares * exitPrice;
    turnoverNotional += grossProceeds;
    trades.push({
      strategyId: 'equal_weight_buy_hold',
      ticker: position.ticker,
      signalDate: firstDate,
      entryDate: firstDate,
      exitDate: lastDate,
      entryPrice: position.entryPrice,
      exitPrice,
      grossReturn: round(exitPrice / position.entryPrice - 1) ?? 0,
      netReturn: round((exitPrice * (1 - cost)) / (position.entryPrice * (1 + cost)) - 1) ?? 0,
      capitalAllocated: round(position.capitalAllocated, 2) ?? position.capitalAllocated,
    });
  }

  if (equityCurve.length && positions.length) {
    const finalPoint = equityCurve[equityCurve.length - 1];
    finalPoint.equity = round(finalPoint.equity - positions.reduce((sum, position) => {
      const exitPrice = priceFor(rowFor(ctx, position.ticker, lastDate)) ?? 0;
      return sum + position.shares * exitPrice * cost;
    }, 0), 6) ?? finalPoint.equity;
  }

  return { equityCurve, trades, turnoverNotional };
}

function cashBaseline(ctx: BacktestContext, initialCapital: number): EquityPoint[] {
  return ctx.dates.map((date) => ({ date, equity: initialCapital, exposure: 0 }));
}

function profitVerdict(metrics: ProfitMetrics, benchmark: ProfitMetrics, minTrades: number): ProfitVerdict {
  if (metrics.numberOfTrades < minTrades) return 'expand_universe';
  if (metrics.totalReturn <= benchmark.totalReturn && Math.abs(metrics.maxDrawdown) >= Math.abs(benchmark.maxDrawdown)) {
    return 'reject';
  }
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

export function buildProfitBacktestReport(
  artifact: PriceFeatureLabelArtifact,
  config: ProfitBacktestConfig = {},
): ProfitBacktestReport {
  const normalizedConfig = normalizeConfig(config);
  const ctx = buildContext(artifact);
  const warnings = [
    'Research-only profit simulation. Not trading advice, not production policy, and not model training.',
    'V1 uses non-overlapping baskets; rebalance signals are skipped while a basket is open.',
  ];

  const buyHold = baselineBuyHold(ctx, normalizedConfig.initialCapital, normalizedConfig.costBps);
  const buyHoldMetrics = computeProfitMetrics(
    buyHold.equityCurve,
    buyHold.trades,
    normalizedConfig.initialCapital,
    undefined,
    buyHold.turnoverNotional,
  );

  const cashCurve = cashBaseline(ctx, normalizedConfig.initialCapital);
  const cashMetrics = computeProfitMetrics(cashCurve, [], normalizedConfig.initialCapital, buyHoldMetrics, 0);

  const baselines: ProfitStrategyResult[] = [
    {
      id: 'equal_weight_buy_hold',
      kind: 'baseline',
      description: 'Equal-weight buy-and-hold over tickers available at the artifact start and end dates.',
      config: null,
      metrics: { ...buyHoldMetrics, benchmarkRelativeReturn: 0, benchmarkRelativeMaxDrawdown: 0 },
      profitVerdict: 'research_candidate',
      trades: buyHold.trades,
      warnings: [],
    },
    {
      id: 'cash',
      kind: 'baseline',
      description: 'Cash baseline with zero return and zero exposure.',
      config: null,
      metrics: cashMetrics,
      profitVerdict: 'reject',
      trades: [],
      warnings: [],
    },
  ];

  if (ctx.tickers.includes('SPY')) {
    const spyCtx = buildContext({ ...artifact, rows: artifact.rows.filter((row) => row.ticker === 'SPY') });
    const spy = baselineBuyHold(spyCtx, normalizedConfig.initialCapital, normalizedConfig.costBps);
    baselines.push({
      id: 'SPY_buy_hold',
      kind: 'baseline',
      description: 'SPY buy-and-hold baseline because SPY exists in the artifact.',
      config: null,
      metrics: computeProfitMetrics(spy.equityCurve, spy.trades, normalizedConfig.initialCapital, buyHoldMetrics, spy.turnoverNotional),
      profitVerdict: 'research_candidate',
      trades: spy.trades,
      warnings: [],
    });
  }

  const strategies: ProfitStrategyResult[] = normalizedConfig.strategies.map((strategy) => {
    const sim = simulateStrategy(ctx, strategy, normalizedConfig.initialCapital, normalizedConfig.costBps);
    const metrics = computeProfitMetrics(
      sim.equityCurve,
      sim.trades,
      normalizedConfig.initialCapital,
      buyHoldMetrics,
      sim.turnoverNotional,
    );
    return {
      id: strategy.id,
      kind: 'strategy',
      description: `${strategy.id}: rank ${strategy.feature} ${strategy.rankDirection}, buy up to ${strategy.topN ?? normalizedConfig.topN}, hold ${strategy.holdDays} trading days.`,
      config: strategy,
      metrics,
      profitVerdict: profitVerdict(metrics, buyHoldMetrics, normalizedConfig.minTradesForCandidate),
      trades: sim.trades,
      warnings: sim.warnings,
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    lane: 'research_only',
    reportType: 'research_profit_backtest',
    schemaVersion: 'research_profit_backtest_v1',
    config: normalizedConfig,
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
    baselines,
    strategies,
    warnings,
  };
}

export async function loadPriceFeatureArtifactFromFile(inputPath: string): Promise<PriceFeatureLabelArtifact> {
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
    `profit-backtest-${stamp}.json`,
  );
}

export async function persistProfitBacktestReport(
  report: ProfitBacktestReport,
  outputPath?: string,
): Promise<string> {
  const target = path.resolve(outputPath ?? defaultOutputPath());
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return target;
}
