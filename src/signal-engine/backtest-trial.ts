import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { runFundamentalAnalysis } from '../agents/analysis/fundamentals.js';
import { runSentimentAnalysis } from '../agents/analysis/sentiment.js';
import { runTechnicalAnalysis } from '../agents/analysis/technical.js';
import { runValuationAnalysis } from '../agents/analysis/valuation.js';
import {
  fetchHistoricalPricesRouted,
  getPriceFetchStats,
  PriceBar,
  PriceProviderRouting,
  resetPriceFetchStats,
} from '../data/market.js';
import { estimateTargetNotionalUsd } from './execution.js';
import { runDailyScan, type ScanProviders } from './index.js';
import { SIGNAL_CONFIG } from './config.js';
import { getApiUsageSnapshot } from '../tools/finance/api.js';

export type BacktestMode = 'long_only' | 'long_short';
export type BacktestExecutionModel = 'next_open';
export type BacktestSignalProfile =
  | 'baseline'
  | 'research'
  | 'adaptive'
  | 'adaptive_safe'
  | 'swing_alpha'
  | 'macd_parity'
  | 'ml_sidecar';

export interface TrialBacktestConfig {
  ticker: string;
  startDate: string;
  endDate: string;
  initialCapitalUsd: number;
  mode: BacktestMode;
  execution: BacktestExecutionModel;
  dataRouting: {
    priceProvider: PriceProviderRouting;
    fundamentalsProvider: 'paid_cached';
  };
  apiDelayMs: number;
  fundamentalRefreshDays: number;
  valuationRefreshDays: number;
  sentimentRefreshDays: number;
  dataQualityMaxFallbackRate: number;
  signalProfile: BacktestSignalProfile;
  adaptiveLookbackDays: number;
  adaptiveMinSamples: number;
  adaptiveBuyQuantile: number;
  adaptiveSellQuantile: number;
  adaptiveEntryBuffer: number;
  adaptiveCommitteeBuyRelief: number;
  adaptiveBuyScoreFloor: number;
  adaptiveAddScoreImprovementMin: number;
  tacticalDipEnabled: boolean;
  tacticalRsiMax: number;
  tacticalZScoreMax: number;
  tacticalTrendScoreMin: number;
  tacticalMinRiskScore: number;
  tacticalMaxAggregateScore: number;
  tacticalMinEdgeAfterCostsBps: number;
  exitStopLossPct: number;
  exitTakeProfitPct: number;
  exitMaxHoldTradingDays: number;
  adaptiveMinExpectedEdgeAfterCostsBps: number;
  mlPredictionsCsvPath: string | null;
  mlBuyProbabilityThreshold: number;
  mlSellProbabilityThreshold: number;
  mlMinRiskScore: number;
  mlPositionScale: number;
}

export interface TrialBacktestDailyRecord {
  date: string;
  isTradingDay: boolean;
  marketClosed: boolean;
  signalAction: 'BUY' | 'SELL' | 'HOLD' | 'COVER' | 'N/A';
  normalizedAction: 'BUY' | 'SELL' | 'HOLD' | 'COVER' | 'N/A';
  actionNote: string;
  executedAction: 'BUY' | 'SELL' | 'HOLD' | 'COVER' | 'N/A';
  executionPrice: number | null;
  closePrice: number | null;
  shares: number;
  cashUsd: number;
  positionValueUsd: number;
  equityUsd: number;
  dailyPnlUsd: number;
  cumulativePnlUsd: number;
  drawdownPct: number;
  realizedPnlUsd: number;
  unrealizedPnlUsd: number;
  fallbackUsed: boolean;
  aggregateScore: number | null;
  riskScore: number | null;
  confidence: number | null;
  buyScoreGap: number | null;
  buyRiskGap: number | null;
  sellScoreGap: number | null;
  longExitGap: number | null;
  primaryBlocker: string;
  blockersTop3: string[];
  alphaLaneScore: number | null;
  contextLaneScore: number | null;
}

export interface TrialExecutionRow {
  signalDate: string;
  executionDate: string;
  signalAction: 'BUY' | 'SELL' | 'HOLD' | 'COVER';
  executedAction: 'BUY' | 'SELL' | 'HOLD' | 'COVER';
  fillPrice: number;
  shares: number;
  feesUsd: number;
  tradeNotionalUsd: number;
}

export interface TrialBacktestSummary {
  totalReturnPct: number;
  netPnlUsd: number;
  maxDrawdownPct: number;
  trades: number;
  winRatePct: number | null;
  averageWinPct: number | null;
  averageLossPct: number | null;
  turnoverPct: number;
  totalCostsUsd: number;
  benchmarkReturnPct: number | null;
  fallbackTradingDays: number;
  fallbackRatePct: number;
  dataQualityStatus: 'pass' | 'warn' | 'fail';
  dataQualityNote: string;
  holdTradingDays: number;
  noSignalTradingDays: number;
  nearBuyDays: number;
  nearSellDays: number;
  cacheHitRate: number;
  apiCallsByEndpoint: Array<{ endpoint: string; calls: number }>;
}

export interface TrialBacktestReport {
  config: TrialBacktestConfig;
  generatedAt: string;
  summary: TrialBacktestSummary;
  dailyRecords: TrialBacktestDailyRecord[];
  executionRows: TrialExecutionRow[];
}

type SignalSnapshot = {
  finalAction: 'BUY' | 'SELL' | 'HOLD' | 'COVER';
  fallbackUsed: boolean;
  targetNotionalUsd: number;
  oneWayCostBps: number;
  expectedEdgeAfterCostsBps?: number;
  mlProbabilityUp?: number | null;
  buyScoreThresholdUsed?: number;
  sellScoreThresholdUsed?: number;
  buyRiskThresholdUsed?: number;
  qualityGuardSuppressed?: boolean;
  qualityGuardReason?: string;
  aggregateScore?: number;
  riskScore?: number;
  confidence?: number;
  blockersTop3?: string[];
  alphaLaneScore?: number;
  contextLaneScore?: number;
};

export interface TrialBacktestDependencies {
  getBars: (ticker: string, startDate: string, endDate: string) => Promise<PriceBar[]>;
  runSignal: (params: {
    ticker: string;
    asOfDate: string;
    equityUsd: number;
    longShares: number;
    shortShares: number;
  }) => Promise<SignalSnapshot>;
}

const DEFAULT_CONFIG: TrialBacktestConfig = {
  ticker: 'AAPL',
  startDate: '2026-01-01',
  endDate: '2026-01-31',
  initialCapitalUsd: 10_000,
  mode: 'long_only',
  execution: 'next_open',
  dataRouting: {
    priceProvider: 'cache_yahoo_paid_fallback',
    fundamentalsProvider: 'paid_cached',
  },
  apiDelayMs: 250,
  fundamentalRefreshDays: 7,
  valuationRefreshDays: 7,
  sentimentRefreshDays: 3,
  dataQualityMaxFallbackRate: 0.2,
  signalProfile: 'adaptive_safe',
  adaptiveLookbackDays: 30,
  adaptiveMinSamples: 10,
  adaptiveBuyQuantile: 0.78,
  adaptiveSellQuantile: 0.2,
  adaptiveEntryBuffer: 0.015,
  adaptiveCommitteeBuyRelief: 0.03,
  adaptiveBuyScoreFloor: -0.14,
  adaptiveAddScoreImprovementMin: 0.01,
  tacticalDipEnabled: true,
  tacticalRsiMax: 42,
  tacticalZScoreMax: -0.9,
  tacticalTrendScoreMin: -0.2,
  tacticalMinRiskScore: 0.55,
  tacticalMaxAggregateScore: 0.05,
  tacticalMinEdgeAfterCostsBps: 8,
  exitStopLossPct: 2.5,
  exitTakeProfitPct: 4.5,
  exitMaxHoldTradingDays: 7,
  adaptiveMinExpectedEdgeAfterCostsBps: 20,
  mlPredictionsCsvPath: null,
  mlBuyProbabilityThreshold: 0.58,
  mlSellProbabilityThreshold: 0.42,
  mlMinRiskScore: 0.3,
  mlPositionScale: 0.5,
};

function round2(value: number): number {
  return Number(value.toFixed(2));
}

function round4(value: number): number {
  return Number(value.toFixed(4));
}

function asDateOnly(value: string): string {
  return value.slice(0, 10);
}

function dateToEpochDay(date: string): number {
  return Math.floor(Date.parse(`${date}T00:00:00.000Z`) / 86_400_000);
}

function fromEpochDay(day: number): string {
  return new Date(day * 86_400_000).toISOString().slice(0, 10);
}

function bucketDate(date: string, bucketDays: number): string {
  const day = dateToEpochDay(date);
  const bucketStart = day - (day % Math.max(1, bucketDays));
  return fromEpochDay(bucketStart);
}

function subtractDays(date: string, days: number): string {
  const dt = new Date(`${date}T00:00:00.000Z`);
  dt.setUTCDate(dt.getUTCDate() - days);
  return dt.toISOString().slice(0, 10);
}

function enumerateCalendarDates(startDate: string, endDate: string): string[] {
  const out: string[] = [];
  const cursor = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  while (cursor <= end) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

function drawdownPct(equity: number, peak: number): number {
  if (peak <= 0) return 0;
  return round4(((equity - peak) / peak) * 100);
}

function csvCell(value: string | number | boolean | null): string {
  const raw = value === null ? '' : String(value);
  if (/[",\n]/.test(raw)) return `"${raw.replace(/"/g, '""')}"`;
  return raw;
}

function toCsv(rows: TrialBacktestDailyRecord[]): string {
  const headers = [
    'date',
    'isTradingDay',
    'marketClosed',
    'signalAction',
    'normalizedAction',
    'actionNote',
    'executedAction',
    'executionPrice',
    'closePrice',
    'shares',
    'cashUsd',
    'positionValueUsd',
    'equityUsd',
    'dailyPnlUsd',
    'cumulativePnlUsd',
    'drawdownPct',
    'realizedPnlUsd',
    'unrealizedPnlUsd',
    'fallbackUsed',
    'aggregateScore',
    'riskScore',
    'confidence',
    'buyScoreGap',
    'buyRiskGap',
    'sellScoreGap',
    'longExitGap',
    'primaryBlocker',
    'blockersTop3',
    'alphaLaneScore',
    'contextLaneScore',
  ];
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(
      [
        row.date,
        row.isTradingDay,
        row.marketClosed,
        row.signalAction,
        row.normalizedAction,
        row.actionNote,
        row.executedAction,
        row.executionPrice,
        row.closePrice,
        row.shares,
        row.cashUsd,
        row.positionValueUsd,
        row.equityUsd,
        row.dailyPnlUsd,
        row.cumulativePnlUsd,
        row.drawdownPct,
        row.realizedPnlUsd,
        row.unrealizedPnlUsd,
        row.fallbackUsed,
        row.aggregateScore,
        row.riskScore,
        row.confidence,
        row.buyScoreGap,
        row.buyRiskGap,
        row.sellScoreGap,
        row.longExitGap,
        row.primaryBlocker,
        row.blockersTop3.join(' | '),
        row.alphaLaneScore,
        row.contextLaneScore,
      ]
        .map(csvCell)
        .join(','),
    );
  }
  return `${lines.join('\n')}\n`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseMlProbabilities(csvPath: string | null): Map<string, number> {
  const out = new Map<string, number>();
  if (!csvPath) return out;
  try {
    const raw = readFileSync(csvPath, 'utf8');
    const lines = raw.split(/\r?\n/).filter(Boolean);
    if (lines.length <= 1) return out;
    const headers = lines[0].split(',');
    const dateIdx = headers.indexOf('date');
    const probIdx = headers.indexOf('p_up_blend');
    if (dateIdx < 0 || probIdx < 0) return out;
    for (let i = 1; i < lines.length; i += 1) {
      const cols = lines[i].split(',');
      if (cols.length <= Math.max(dateIdx, probIdx)) continue;
      const date = cols[dateIdx]?.trim();
      const prob = Number(cols[probIdx]);
      if (date && Number.isFinite(prob)) out.set(date, prob);
    }
  } catch {
    // Missing/invalid file -> leave map empty; profile falls back to deterministic.
  }
  return out;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function quantile(values: number[], q: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = clamp(q, 0, 1) * (sorted.length - 1);
  const low = Math.floor(index);
  const high = Math.ceil(index);
  if (low === high) return sorted[low];
  const weight = index - low;
  return sorted[low] + (sorted[high] - sorted[low]) * weight;
}

function adaptiveThresholds(
  scoreHistory: number[],
  config: TrialBacktestConfig,
): {
  buyScore: number;
  sellScore: number;
  buyRisk: number;
} {
  const recent = scoreHistory.slice(-config.adaptiveLookbackDays);
  if (!recent.length) {
    return {
      buyScore: 0.12,
      sellScore: -0.12,
      buyRisk: 0.25,
    };
  }
  if (recent.length < config.adaptiveMinSamples) {
    const warmBuy = (quantile(recent, 0.7) ?? recent[recent.length - 1]) + 0.03;
    const warmSell = (quantile(recent, 0.3) ?? recent[0]) - 0.03;
    return {
      buyScore: round4(clamp(warmBuy, -0.08, 0.22)),
      sellScore: round4(clamp(warmSell, -0.35, 0.02)),
      buyRisk: 0.25,
    };
  }
  const buyCandidate = quantile(recent, config.adaptiveBuyQuantile) ?? 0.2;
  const sellCandidate = quantile(recent, config.adaptiveSellQuantile) ?? -0.15;
  let buyScore = clamp(buyCandidate, -0.05, 0.35);
  let sellScore = clamp(sellCandidate, -0.45, 0.05);
  if (buyScore - sellScore < 0.08) {
    buyScore = round4(clamp(buyScore + 0.04, -0.05, 0.35));
    sellScore = round4(clamp(sellScore - 0.04, -0.45, 0.05));
  }
  return {
    buyScore: round4(buyScore),
    sellScore: round4(sellScore),
    buyRisk: 0.25,
  };
}

function signalVoteFromComponentScore(
  componentName: string,
  score: number,
): 'bullish' | 'bearish' | 'neutral' {
  if (componentName === 'Sentiment') {
    if (score >= 0.5) return 'bullish';
    if (score <= -0.5) return 'bearish';
    return 'neutral';
  }
  if (score >= 0.15) return 'bullish';
  if (score <= -0.15) return 'bearish';
  return 'neutral';
}

function ema(values: number[], period: number): number {
  if (!values.length) return 0;
  const alpha = 2 / (period + 1);
  let out = values[0];
  for (let i = 1; i < values.length; i += 1) {
    out = alpha * values[i] + (1 - alpha) * out;
  }
  return out;
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values: number[]): number {
  if (values.length <= 1) return 0;
  const mean = average(values);
  const variance = average(values.map((value) => (value - mean) ** 2));
  return Math.sqrt(variance);
}

function rsi(closes: number[], period = 14): number {
  if (closes.length <= period) return 50;
  let gains = 0;
  let losses = 0;
  for (let i = closes.length - period; i < closes.length; i += 1) {
    const prev = closes[i - 1];
    const curr = closes[i];
    const delta = curr - prev;
    if (delta >= 0) gains += delta;
    else losses += Math.abs(delta);
  }
  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - 100 / (1 + rs);
}

function technicalAlphaLane(
  history: PriceBar[],
): {
  alphaLaneScore: number;
  details: {
    emaSignal: number;
    rsiSignal: number;
    macdSignal: number;
    bbSignal: number;
    stochSignal: number;
  };
} {
  const bars = history.slice(-220);
  const closes = bars.map((bar) => bar.close).filter(Number.isFinite);
  const highs = bars.map((bar) => bar.high).filter(Number.isFinite);
  const lows = bars.map((bar) => bar.low).filter(Number.isFinite);
  if (closes.length < 35 || highs.length < 14 || lows.length < 14) {
    return {
      alphaLaneScore: 0,
      details: {
        emaSignal: 0,
        rsiSignal: 0,
        macdSignal: 0,
        bbSignal: 0,
        stochSignal: 0,
      },
    };
  }

  const lastClose = closes[closes.length - 1];
  const ema9 = ema(closes, 9);
  const ema21 = ema(closes, 21);
  const emaSignal = ema9 > ema21 ? 1 : ema9 < ema21 ? -1 : 0;

  const rsi14 = rsi(closes, 14);
  const rsiSignal = rsi14 < 35 ? 1 : rsi14 > 65 ? -1 : 0;

  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const macd = ema12 - ema26;
  const macdSeries: number[] = [];
  for (let i = 0; i < closes.length; i += 1) {
    const sample = closes.slice(0, i + 1);
    macdSeries.push(ema(sample, 12) - ema(sample, 26));
  }
  const macdSignalLine = ema(macdSeries, 9);
  const macdSignal = macd > macdSignalLine ? 1 : macd < macdSignalLine ? -1 : 0;

  const bbWindow = closes.slice(-20);
  const bbMean = average(bbWindow);
  const bbStd = standardDeviation(bbWindow);
  const bbUpper = bbMean + 2 * bbStd;
  const bbLower = bbMean - 2 * bbStd;
  const bbSignal = lastClose < bbLower ? 1 : lastClose > bbUpper ? -1 : 0;

  const stochWindowLow = Math.min(...lows.slice(-14));
  const stochWindowHigh = Math.max(...highs.slice(-14));
  const k =
    stochWindowHigh - stochWindowLow > 0
      ? ((lastClose - stochWindowLow) / (stochWindowHigh - stochWindowLow)) * 100
      : 50;
  const recentKs: number[] = [];
  for (let i = Math.max(14, closes.length - 6); i < closes.length; i += 1) {
    const l = Math.min(...lows.slice(i - 13, i + 1));
    const h = Math.max(...highs.slice(i - 13, i + 1));
    const c = closes[i];
    recentKs.push(h - l > 0 ? ((c - l) / (h - l)) * 100 : 50);
  }
  const d = average(recentKs.slice(-3));
  const stochSignal = k > d && k < 80 ? 1 : k < d && k > 20 ? -1 : 0;

  const weighted =
    emaSignal * 0.25 +
    rsiSignal * 0.2 +
    macdSignal * 0.25 +
    bbSignal * 0.15 +
    stochSignal * 0.15;
  return {
    alphaLaneScore: round4(clamp(weighted, -1, 1)),
    details: { emaSignal, rsiSignal, macdSignal, bbSignal, stochSignal },
  };
}

function macdParitySignal(history: PriceBar[]): {
  action: SignalSnapshot['finalAction'];
  macd: number;
  signal: number;
  score: number;
} {
  const closes = history.map((bar) => bar.close).filter(Number.isFinite);
  if (closes.length < 35) {
    return { action: 'HOLD', macd: 0, signal: 0, score: 0 };
  }
  const macdSeries: number[] = [];
  for (let i = 0; i < closes.length; i += 1) {
    const sample = closes.slice(0, i + 1);
    macdSeries.push(ema(sample, 12) - ema(sample, 26));
  }
  const macd = macdSeries[macdSeries.length - 1] ?? 0;
  const signal = ema(macdSeries, 9);
  const hist = macd - signal;
  const score = round4(clamp(hist * 12, -1, 1));
  if (macd > signal) return { action: 'BUY', macd, signal, score };
  if (macd < signal) return { action: 'SELL', macd, signal, score };
  return { action: 'HOLD', macd, signal, score };
}

function analyzeDecisionBlockers(
  snapshot: SignalSnapshot | null,
  mode: BacktestMode,
  longShares: number,
  shortShares: number,
): Pick<
  TrialBacktestDailyRecord,
  | 'aggregateScore'
  | 'riskScore'
  | 'confidence'
  | 'buyScoreGap'
  | 'buyRiskGap'
  | 'sellScoreGap'
  | 'longExitGap'
  | 'primaryBlocker'
  | 'blockersTop3'
> {
  if (!snapshot) {
    return {
      aggregateScore: null,
      riskScore: null,
      confidence: null,
      buyScoreGap: null,
      buyRiskGap: null,
      sellScoreGap: null,
      longExitGap: null,
      primaryBlocker: 'No signal snapshot available',
      blockersTop3: ['No signal snapshot available'],
    };
  }

  const score = snapshot.aggregateScore ?? null;
  const risk = snapshot.riskScore ?? null;
  const confidence = snapshot.confidence ?? null;
  const buyScoreThreshold = snapshot.buyScoreThresholdUsed ?? SIGNAL_CONFIG.actions.buyScoreThreshold;
  const buyRiskThreshold = snapshot.buyRiskThresholdUsed ?? SIGNAL_CONFIG.actions.buyRiskThreshold;
  const sellScoreThreshold =
    snapshot.sellScoreThresholdUsed ?? SIGNAL_CONFIG.actions.sellScoreThreshold;
  const buyScoreGap = score === null ? null : round4(buyScoreThreshold - score);
  const buyRiskGap = risk === null ? null : round4(buyRiskThreshold - risk);
  const sellScoreGap = score === null ? null : round4(score - sellScoreThreshold);
  const longExitGap = score === null ? null : round4(score - SIGNAL_CONFIG.actions.longExitScoreThreshold);

  let blocker = 'No blocker';
  const blockers: string[] = [];
  if (snapshot.qualityGuardSuppressed) {
    blocker = snapshot.qualityGuardReason ?? 'NO_SIGNAL: signal suppressed by quality guard';
    return {
      aggregateScore: score,
      riskScore: risk,
      confidence,
      buyScoreGap,
      buyRiskGap,
      sellScoreGap,
      longExitGap,
      primaryBlocker: blocker,
      blockersTop3: [blocker],
    };
  }
  if (snapshot.finalAction === 'HOLD') {
    if (score !== null && risk !== null) {
      if (buyScoreGap !== null && buyScoreGap > 0) {
        blockers.push(`Buy score gap +${buyScoreGap.toFixed(3)}`);
      }
      if (buyRiskGap !== null && buyRiskGap > 0) {
        blockers.push(`Buy risk gap +${buyRiskGap.toFixed(3)}`);
      }
      if (sellScoreGap !== null && sellScoreGap > 0 && sellScoreGap < 0.2) {
        blockers.push(`Not bearish enough for SELL (+${sellScoreGap.toFixed(3)})`);
      }
      if (score >= buyScoreThreshold && risk <= buyRiskThreshold) {
        blocker = 'Risk gate blocked BUY';
      } else if (score > sellScoreThreshold && score < buyScoreThreshold) {
        blocker = 'Aggregate score in HOLD zone';
      } else if (
        score <= sellScoreThreshold &&
        mode === 'long_only' &&
        longShares <= 0
      ) {
        blocker = 'No long position to exit';
      } else if (
        score <= sellScoreThreshold &&
        mode === 'long_short' &&
        longShares <= 0 &&
        shortShares > 0
      ) {
        blocker = 'SELL suppressed while short already open';
      } else if (
        snapshot.expectedEdgeAfterCostsBps !== undefined &&
        snapshot.expectedEdgeAfterCostsBps <= 0
      ) {
        blocker = 'Expected edge after costs is non-positive';
      } else {
        blocker = 'Rule convergence resulted in HOLD';
      }
      blockers.unshift(blocker);
    } else {
      blocker = 'Missing score/risk diagnostics';
      blockers.unshift(blocker);
    }
  }

  return {
    aggregateScore: score,
    riskScore: risk,
    confidence,
    buyScoreGap,
    buyRiskGap,
    sellScoreGap,
    longExitGap,
    primaryBlocker: blocker,
    blockersTop3: blockers.slice(0, 3),
  };
}

function createDefaultRunSignalRunner(
  config: TrialBacktestConfig,
  bars: PriceBar[],
): TrialBacktestDependencies['runSignal'] {
  let lastCallAt = 0;
  const fundamentalCache = new Map<string, ReturnType<typeof runFundamentalAnalysis>>();
  const sentimentCache = new Map<string, ReturnType<typeof runSentimentAnalysis>>();
  const valuationCache = new Map<string, ReturnType<typeof runValuationAnalysis>>();
  const mlProbabilitiesByDate = parseMlProbabilities(config.mlPredictionsCsvPath);
  const scoreHistory: number[] = [];
  const fallbackHistory: boolean[] = [];
  const orderedBars = [...bars].sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  const barsByDate = new Map(orderedBars.map((bar) => [asDateOnly(bar.date), bar]));

  const throttled = async () => {
    const now = Date.now();
    const waitMs = Math.max(0, config.apiDelayMs - (now - lastCallAt));
    if (waitMs > 0) await sleep(waitMs);
    lastCallAt = Date.now();
  };

  return async (params) => {
    await throttled();

    if (config.signalProfile === 'macd_parity') {
      const asOfHistory = orderedBars.filter((bar) => asDateOnly(bar.date) <= params.asOfDate);
      const parity = macdParitySignal(asOfHistory);
      const mark = asOfHistory[asOfHistory.length - 1]?.close ?? SIGNAL_CONFIG.execution.fallbackEstimatedPrice;
      const oneWayCostBps =
        SIGNAL_CONFIG.execution.regionCostBps.US.spread +
        SIGNAL_CONFIG.execution.regionCostBps.US.slippage +
        SIGNAL_CONFIG.execution.regionCostBps.US.fee;
      const desiredDirection =
        parity.action === 'BUY' ? 1 : parity.action === 'SELL' ? -1 : 0;
      let finalAction: SignalSnapshot['finalAction'] = 'HOLD';
      if (desiredDirection > 0) {
        if (params.shortShares > 0) finalAction = 'COVER';
        else if (params.longShares <= 0) finalAction = 'BUY';
      } else if (desiredDirection < 0) {
        if (params.longShares > 0) finalAction = 'SELL';
        else if (config.mode === 'long_short' && params.shortShares <= 0) finalAction = 'SELL';
      }
      let targetNotionalUsd = 0;
      if (finalAction === 'BUY') {
        targetNotionalUsd = Math.max(0, params.equityUsd * 0.95);
      } else if (finalAction === 'SELL') {
        targetNotionalUsd =
          params.longShares > 0
            ? params.longShares * mark
            : config.mode === 'long_short'
              ? Math.max(0, params.equityUsd * 0.95)
              : 0;
      } else if (finalAction === 'COVER') {
        targetNotionalUsd = params.shortShares * mark;
      }
      return {
        finalAction,
        fallbackUsed: false,
        targetNotionalUsd: round4(targetNotionalUsd),
        oneWayCostBps,
        expectedEdgeAfterCostsBps: 30,
        buyScoreThresholdUsed: 0,
        sellScoreThresholdUsed: 0,
        buyRiskThresholdUsed: 0,
        qualityGuardSuppressed: false,
        qualityGuardReason: undefined,
        aggregateScore: parity.score,
        riskScore: 1,
        confidence: 75,
        blockersTop3: [],
        alphaLaneScore: parity.score,
        contextLaneScore: 0,
      };
    }

    const providers: ScanProviders = {
      runTechnicalAnalysis: (ticker) =>
        runTechnicalAnalysis(ticker, {
          asOfDate: params.asOfDate,
          strictPointInTime: true,
          priceHistoryOverride: orderedBars
            .filter((bar) => asDateOnly(bar.date) <= params.asOfDate)
            .slice(-220),
        }),
      runFundamentalAnalysis: (ticker) => {
        const key = `${ticker}:${bucketDate(params.asOfDate, config.fundamentalRefreshDays)}`;
        if (!fundamentalCache.has(key)) {
          fundamentalCache.set(
            key,
            runFundamentalAnalysis(ticker, {
              asOfDate: bucketDate(params.asOfDate, config.fundamentalRefreshDays),
              strictPointInTime: true,
            }),
          );
        }
        return fundamentalCache.get(key)!;
      },
      runSentimentAnalysis: (ticker) => {
        const key = `${ticker}:${bucketDate(params.asOfDate, config.sentimentRefreshDays)}`;
        if (!sentimentCache.has(key)) {
          sentimentCache.set(
            key,
            runSentimentAnalysis(ticker, {
              asOfDate: bucketDate(params.asOfDate, config.sentimentRefreshDays),
              strictPointInTime: true,
            }),
          );
        }
        return sentimentCache.get(key)!;
      },
      runValuationAnalysis: (ticker) => {
        const key = `${ticker}:${bucketDate(params.asOfDate, config.valuationRefreshDays)}`;
        if (!valuationCache.has(key)) {
          valuationCache.set(
            key,
            runValuationAnalysis(ticker, {
              asOfDate: bucketDate(params.asOfDate, config.valuationRefreshDays),
              strictPointInTime: true,
            }),
          );
        }
        return valuationCache.get(key)!;
      },
    };

    const scan = await runDailyScan(
      {
        tickers: [params.ticker],
        analysisContext: { asOfDate: params.asOfDate, strictPointInTime: true },
        portfolioValue: params.equityUsd,
        positions: {
          [params.ticker]: { longShares: params.longShares, shortShares: params.shortShares },
        },
      },
      providers,
    );

    const alert = scan.alerts[0];
    if (!alert) {
      return {
        finalAction: 'HOLD',
        fallbackUsed: true,
        targetNotionalUsd: 0,
        oneWayCostBps: 0,
      };
    }

    let finalAction: SignalSnapshot['finalAction'] = alert.finalAction;
    let targetNotionalUsd = alert.executionPlan.notionalUsd;
    const score = alert.reasoning.aggregateScore;
    const riskScore = alert.reasoning.risk.riskScore;
    const edgeAfterCosts = alert.executionPlan.costEstimate.expectedEdgeAfterCostsBps;
    const mlProbabilityUp = mlProbabilitiesByDate.get(params.asOfDate) ?? null;
    const asOfHistory = orderedBars.filter((bar) => asDateOnly(bar.date) <= params.asOfDate);
    const alphaLane = technicalAlphaLane(asOfHistory);
    const technical = alert.reasoning.components.find((component) => component.name === 'Technical');
    const fundamentals = alert.reasoning.components.find((component) => component.name === 'Fundamentals');
    const valuation = alert.reasoning.components.find((component) => component.name === 'Valuation');
    const sentiment = alert.reasoning.components.find((component) => component.name === 'Sentiment');
    const technicalDetails = (technical?.details ?? {}) as Record<string, unknown>;
    const subSignals = (technicalDetails.subSignals ?? {}) as Record<string, Record<string, unknown>>;
    const trendSignal = String(subSignals.trend?.signal ?? 'neutral');
    // Swing context lane should inform sizing/bias, not suppress all momentum entries.
    const valuationScoreCapped = clamp(valuation?.score ?? 0, -0.45, 0.35);
    const contextLaneScore = round4(
      clamp(
        (fundamentals?.score ?? 0) * 0.58 +
          (sentiment?.score ?? 0) * 0.34 +
          valuationScoreCapped * 0.08,
        -1,
        1,
      ),
    );
    const confidence01 = clamp(alert.confidence / 100, 0, 1);
    const thresholdSet = adaptiveThresholds(scoreHistory, config);
    let buyScoreThreshold = SIGNAL_CONFIG.actions.buyScoreThreshold;
    let sellScoreThreshold = SIGNAL_CONFIG.actions.sellScoreThreshold;
    let buyRiskThreshold = SIGNAL_CONFIG.actions.buyRiskThreshold;
    const blockers: string[] = [];

    if (config.signalProfile === 'adaptive' || config.signalProfile === 'adaptive_safe') {
      let entryBuffer = config.adaptiveEntryBuffer;
      buyScoreThreshold = thresholdSet.buyScore;
      sellScoreThreshold = thresholdSet.sellScore;
      buyRiskThreshold = thresholdSet.buyRisk;
      const previousScore =
        scoreHistory.length > 0 ? scoreHistory[scoreHistory.length - 1] : null;
      const isAddOnBuy = params.longShares > 0;
      const addOnBuyAllowed =
        !isAddOnBuy ||
        (trendSignal !== 'bearish' &&
          (previousScore === null ||
            score >= previousScore + config.adaptiveAddScoreImprovementMin));
      const components = alert.reasoning.components;
      const votes = components.map((component) =>
        signalVoteFromComponentScore(component.name, component.score),
      );
      const bullishVotes = votes.filter((vote) => vote === 'bullish').length;
      const bearishVotes = votes.filter((vote) => vote === 'bearish').length;
      // ai-hedge-fund style committee nudge: allow a slightly easier BUY when analyst votes are net bullish.
      const hasCommitteeBuyBias = bullishVotes >= 2 && bearishVotes <= 1 && trendSignal !== 'bearish';
      const committeeBuyThreshold = buyScoreThreshold - config.adaptiveCommitteeBuyRelief;
      const meanReversionMetrics = (subSignals.meanReversion?.metrics ??
        {}) as Record<string, unknown>;
      const trendScore = Number(subSignals.trend?.score ?? 0);
      const rsi14 = Number(meanReversionMetrics.rsi14 ?? Number.NaN);
      const zScore = Number(meanReversionMetrics.zScore ?? Number.NaN);
      const dipReboundBuyEligible =
        config.tacticalDipEnabled &&
        params.longShares === 0 &&
        params.shortShares === 0 &&
        score <= config.tacticalMaxAggregateScore &&
        riskScore >= config.tacticalMinRiskScore &&
        edgeAfterCosts >= config.tacticalMinEdgeAfterCostsBps &&
        Number.isFinite(rsi14) &&
        Number.isFinite(zScore) &&
        rsi14 <= config.tacticalRsiMax &&
        zScore <= config.tacticalZScoreMax &&
        trendScore >= config.tacticalTrendScoreMin;
      if (!alert.fallbackPolicy.hadFallback && alert.confidence >= 70) {
        entryBuffer = clamp(entryBuffer + 0.01, 0, 0.05);
      }
      if (
        (score >= config.adaptiveBuyScoreFloor || dipReboundBuyEligible) &&
        (score + entryBuffer >= buyScoreThreshold ||
          (hasCommitteeBuyBias && score + entryBuffer >= committeeBuyThreshold) ||
          dipReboundBuyEligible) &&
        addOnBuyAllowed &&
        riskScore >= buyRiskThreshold
      ) {
        finalAction = 'BUY';
      } else if (params.longShares > 0 && score <= sellScoreThreshold) {
        finalAction = 'SELL';
      } else if (
        params.longShares === 0 &&
        params.shortShares === 0 &&
        score >= 0.02 &&
        riskScore >= buyRiskThreshold
      ) {
        finalAction = 'BUY';
      } else {
        finalAction = 'HOLD';
      }
    }

    if (config.signalProfile === 'ml_sidecar' && mlProbabilityUp !== null) {
      if (
        mlProbabilityUp >= config.mlBuyProbabilityThreshold &&
        riskScore >= config.mlMinRiskScore &&
        edgeAfterCosts > 0 &&
        (score >= 0 || trendSignal === 'bullish')
      ) {
        finalAction = 'BUY';
      } else if (
        params.longShares > 0 &&
        (mlProbabilityUp <= config.mlSellProbabilityThreshold ||
          (score <= -0.15 && trendSignal === 'bearish'))
      ) {
        finalAction = 'SELL';
      } else {
        finalAction = 'HOLD';
      }
    }

    if (config.signalProfile === 'swing_alpha') {
      const laneBlend = round4(
        clamp(alphaLane.alphaLaneScore * 0.86 + contextLaneScore * 0.14, -1, 1),
      );
      const highQuality = !alert.fallbackPolicy.hadFallback && confidence01 >= 0.65;
      const baseBand = highQuality ? 0.042 : 0.058;
      const alphaStrength = Math.abs(alphaLane.alphaLaneScore);
      const dynamicBand = clamp(baseBand - Math.max(0, alphaStrength - 0.35) * 0.04, 0.028, 0.08);
      const aggressiveMomentumBuy =
        alphaLane.alphaLaneScore >= 0.52 && riskScore >= 0.14 && edgeAfterCosts >= 0;
      const regularBuy =
        laneBlend >= dynamicBand && riskScore >= 0.18 && edgeAfterCosts >= 2;
      if (regularBuy || aggressiveMomentumBuy) {
        finalAction = 'BUY';
      } else if (
        laneBlend <= -dynamicBand &&
        (params.longShares > 0 || config.mode === 'long_short')
      ) {
        finalAction = 'SELL';
      } else if (
        params.shortShares > 0 &&
        (laneBlend >= dynamicBand * 0.8 || alphaLane.alphaLaneScore >= 0.3)
      ) {
        finalAction = 'COVER';
      } else {
        finalAction = 'HOLD';
      }
      if (!(regularBuy || aggressiveMomentumBuy) && riskScore < 0.18) {
        blockers.push('Risk below swing-alpha floor');
      }
      if (!(regularBuy || aggressiveMomentumBuy) && edgeAfterCosts < 2) {
        blockers.push('Expected edge after costs below 2 bps');
      }
      if (Math.abs(laneBlend) < dynamicBand) blockers.push('Lane blend inside no-trade band');
      buyScoreThreshold = dynamicBand;
      sellScoreThreshold = -dynamicBand;
      buyRiskThreshold = 0.18;
    }

    if (config.signalProfile === 'research' && finalAction === 'HOLD') {
      if (score >= 0.2 && riskScore >= 0.25) {
        finalAction = 'BUY';
      } else if (params.longShares > 0 && score <= -0.15) {
        finalAction = 'SELL';
      }
    }

    if (finalAction === 'BUY') {
      targetNotionalUsd = estimateTargetNotionalUsd(
        'BUY',
        alert.reasoning.risk,
        params.equityUsd,
        alert.confidence,
        { longShares: params.longShares, shortShares: params.shortShares },
      );
      if (config.signalProfile === 'ml_sidecar') {
        targetNotionalUsd *= config.mlPositionScale;
      }
    } else if (finalAction === 'SELL') {
      const mark = barsByDate.get(params.asOfDate)?.close ?? alert.positionPerformance.markPrice;
      if (params.longShares > 0) {
        targetNotionalUsd = params.longShares * mark;
      } else {
        targetNotionalUsd = estimateTargetNotionalUsd(
          'BUY',
          alert.reasoning.risk,
          params.equityUsd,
          alert.confidence,
          { longShares: params.longShares, shortShares: params.shortShares },
        );
      }
    } else if (finalAction === 'COVER') {
      const mark = barsByDate.get(params.asOfDate)?.close ?? alert.positionPerformance.markPrice;
      targetNotionalUsd = params.shortShares * mark;
    } else {
      targetNotionalUsd = 0;
    }

    const fallbackRatioWindow = fallbackHistory.slice(-config.adaptiveLookbackDays);
    const fallbackCount = fallbackRatioWindow.filter(Boolean).length;
    const fallbackRatio = fallbackRatioWindow.length ? fallbackCount / fallbackRatioWindow.length : 0;
    let qualityGuardSuppressed = false;
    let qualityGuardReason: string | undefined;
    if (fallbackRatio >= config.dataQualityMaxFallbackRate) {
      finalAction = 'HOLD';
      targetNotionalUsd = 0;
      qualityGuardSuppressed = true;
      qualityGuardReason = `NO_SIGNAL: fallback ratio ${(fallbackRatio * 100).toFixed(1)}% exceeded ${(config.dataQualityMaxFallbackRate * 100).toFixed(1)}%`;
    }

    const minEdgeAfterCosts =
      config.signalProfile === 'swing_alpha'
        ? 2
        : config.adaptiveMinExpectedEdgeAfterCostsBps;
    if (finalAction !== 'HOLD' && edgeAfterCosts < minEdgeAfterCosts) {
      finalAction = 'HOLD';
      targetNotionalUsd = 0;
      qualityGuardSuppressed = true;
      qualityGuardReason = `NO_SIGNAL: expected edge after costs (${edgeAfterCosts.toFixed(2)} bps) below minimum ${minEdgeAfterCosts.toFixed(2)} bps`;
    }

    scoreHistory.push(score);
    fallbackHistory.push(alert.fallbackPolicy.hadFallback);
    const topBlockers = blockers.length ? blockers.slice(0, 3) : qualityGuardReason ? [qualityGuardReason] : [];

    return {
      finalAction,
      fallbackUsed: alert.fallbackPolicy.hadFallback,
      targetNotionalUsd,
      oneWayCostBps: alert.executionPlan.costEstimate.oneWayCostBps,
      expectedEdgeAfterCostsBps: edgeAfterCosts,
      mlProbabilityUp,
      buyScoreThresholdUsed: buyScoreThreshold,
      sellScoreThresholdUsed: sellScoreThreshold,
      buyRiskThresholdUsed: buyRiskThreshold,
      qualityGuardSuppressed,
      qualityGuardReason,
      aggregateScore: score,
      riskScore,
      confidence: alert.confidence,
      blockersTop3: topBlockers,
      alphaLaneScore: alphaLane.alphaLaneScore,
      contextLaneScore,
    };
  };
}

async function defaultGetBars(
  provider: PriceProviderRouting,
  ticker: string,
  startDate: string,
  endDate: string,
): Promise<PriceBar[]> {
  return fetchHistoricalPricesRouted(ticker, startDate, endDate, provider);
}

function normalizeLongOnlyAction(
  action: SignalSnapshot['finalAction'],
  longShares: number,
): { normalized: 'BUY' | 'SELL' | 'HOLD' | 'COVER'; note: string } {
  if (action === 'COVER') {
    return { normalized: 'HOLD', note: 'COVER mapped to HOLD in long-only mode' };
  }
  if (action === 'SELL' && longShares <= 0) {
    return { normalized: 'HOLD', note: 'SELL ignored: no long position' };
  }
  if (action === 'BUY' || action === 'SELL' || action === 'HOLD' || action === 'COVER') {
    return { normalized: action, note: '' };
  }
  return { normalized: 'HOLD', note: 'Unsupported action mapped to HOLD' };
}

function normalizeLongShortAction(
  action: SignalSnapshot['finalAction'],
  shortShares: number,
): { normalized: 'BUY' | 'SELL' | 'HOLD' | 'COVER'; note: string } {
  if (action === 'COVER' && shortShares <= 0) {
    return { normalized: 'HOLD', note: 'COVER ignored: no short position' };
  }
  if (action === 'BUY' || action === 'SELL' || action === 'HOLD' || action === 'COVER') {
    return { normalized: action, note: '' };
  }
  return { normalized: 'HOLD', note: 'Unsupported action mapped to HOLD' };
}

function normalizeActionByMode(
  mode: BacktestMode,
  action: SignalSnapshot['finalAction'],
  longShares: number,
  shortShares: number,
): { normalized: 'BUY' | 'SELL' | 'HOLD' | 'COVER'; note: string } {
  if (mode === 'long_short') {
    return normalizeLongShortAction(action, shortShares);
  }
  return normalizeLongOnlyAction(action, longShares);
}

function mean(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export async function runTrialBacktest(
  config: Partial<TrialBacktestConfig> = {},
  deps: Partial<TrialBacktestDependencies> = {},
): Promise<TrialBacktestReport> {
  resetPriceFetchStats();
  const resolved: TrialBacktestConfig = {
    ...DEFAULT_CONFIG,
    ...config,
    dataRouting: {
      ...DEFAULT_CONFIG.dataRouting,
      ...config.dataRouting,
    },
  };

  const lookbackStart = subtractDays(resolved.startDate, 260);
  const bars = deps.getBars
    ? await deps.getBars(resolved.ticker, resolved.startDate, resolved.endDate)
    : await defaultGetBars(
        resolved.dataRouting.priceProvider,
        resolved.ticker,
        lookbackStart,
        resolved.endDate,
      );
  const runSignal = deps.runSignal ?? createDefaultRunSignalRunner(resolved, bars);
  const barsByDate = new Map(bars.map((bar) => [asDateOnly(bar.date), bar]));
  const tradingDates = bars.map((bar) => asDateOnly(bar.date));
  const calendarDates = enumerateCalendarDates(resolved.startDate, resolved.endDate);
  const stopLossPct = resolved.exitStopLossPct ?? DEFAULT_CONFIG.exitStopLossPct;
  const takeProfitPct = resolved.exitTakeProfitPct ?? DEFAULT_CONFIG.exitTakeProfitPct;
  const maxHoldDays =
    resolved.exitMaxHoldTradingDays ?? DEFAULT_CONFIG.exitMaxHoldTradingDays;

  let cashUsd = resolved.initialCapitalUsd;
  let longShares = 0;
  let shortShares = 0;
  let longCostBasisUsd = 0;
  let shortCostBasisUsd = 0;
  let longOpenFeePerShareUsd = 0;
  let shortOpenFeePerShareUsd = 0;
  let realizedPnlUsd = 0;
  let totalCostsUsd = 0;
  let tradedNotionalUsd = 0;
  let peakEquity = resolved.initialCapitalUsd;
  let prevEquity = resolved.initialCapitalUsd;
  let wins = 0;
  let losses = 0;
  const winPcts: number[] = [];
  const lossPcts: number[] = [];

  let pendingOrder:
    | {
        signalDate: string;
        executionDate: string;
        action: 'BUY' | 'SELL' | 'HOLD' | 'COVER';
        targetNotionalUsd: number;
        oneWayCostBps: number;
      }
    | null = null;

  const dailyRecords: TrialBacktestDailyRecord[] = [];
  const executionRows: TrialExecutionRow[] = [];
  let lastMarkClose: number | null = null;
  let longHoldingTradingDays = 0;
  let shortHoldingTradingDays = 0;

  for (const date of calendarDates) {
    const bar = barsByDate.get(date);
    let executedAction: TrialBacktestDailyRecord['executedAction'] = 'N/A';
    let executionPrice: number | null = null;
    let signalAction: TrialBacktestDailyRecord['signalAction'] = 'N/A';
    let normalizedAction: TrialBacktestDailyRecord['normalizedAction'] = 'N/A';
    let actionNote = '';
    let fallbackUsed = false;
    let signalSnapshot: SignalSnapshot | null = null;

    if (bar) {
      if (pendingOrder && pendingOrder.executionDate === date) {
        executedAction = pendingOrder.action;
        executionPrice = round4(bar.open);
        const feeRate = pendingOrder.oneWayCostBps / 10_000;

        if (pendingOrder.action === 'BUY') {
          if (shortShares > 0) {
            const coverQty = shortShares;
            const closeFeePerShare = bar.open * feeRate;
            const closeFees = coverQty * closeFeePerShare;
            const closeNotional = coverQty * bar.open;
            const grossPnl = (shortCostBasisUsd - bar.open) * coverQty;
            const closedPnlUsd =
              grossPnl - coverQty * shortOpenFeePerShareUsd - closeFees;
            const costToCover = closeNotional + closeFees;
            cashUsd = round4(cashUsd - costToCover);
            realizedPnlUsd = round4(realizedPnlUsd + closedPnlUsd);
            totalCostsUsd = round4(totalCostsUsd + closeFees);
            tradedNotionalUsd = round4(tradedNotionalUsd + closeNotional);
            if (closedPnlUsd >= 0) {
              wins += 1;
              winPcts.push(round4((closedPnlUsd / (shortCostBasisUsd * coverQty)) * 100));
            } else {
              losses += 1;
              lossPcts.push(round4((closedPnlUsd / (shortCostBasisUsd * coverQty)) * 100));
            }
            executionRows.push({
              signalDate: pendingOrder.signalDate,
              executionDate: date,
              signalAction: 'BUY',
              executedAction: 'BUY',
              fillPrice: round4(bar.open),
              shares: coverQty,
              feesUsd: round4(closeFees),
              tradeNotionalUsd: round4(closeNotional),
            });
            shortShares = 0;
            shortCostBasisUsd = 0;
            shortOpenFeePerShareUsd = 0;
            shortHoldingTradingDays = 0;
          }
          const maxSharesByTarget = Math.floor(pendingOrder.targetNotionalUsd / bar.open);
          const maxSharesByCash = Math.floor(cashUsd / (bar.open * (1 + feeRate)));
          const buyShares = Math.max(0, Math.min(maxSharesByTarget, maxSharesByCash));
          if (buyShares > 0) {
            const notional = buyShares * bar.open;
            const feePerShare = bar.open * feeRate;
            const fees = buyShares * feePerShare;
            const totalCost = notional + fees;
            const newTotalShares = longShares + buyShares;
            longCostBasisUsd =
              newTotalShares > 0
                ? (longCostBasisUsd * longShares + bar.open * buyShares) / newTotalShares
                : 0;
            longOpenFeePerShareUsd =
              newTotalShares > 0
                ? (longOpenFeePerShareUsd * longShares + feePerShare * buyShares) / newTotalShares
                : 0;
            longShares = newTotalShares;
            cashUsd = round4(cashUsd - totalCost);
            totalCostsUsd = round4(totalCostsUsd + fees);
            tradedNotionalUsd = round4(tradedNotionalUsd + notional);
            executionRows.push({
              signalDate: pendingOrder.signalDate,
              executionDate: date,
              signalAction: 'BUY',
              executedAction: 'BUY',
              fillPrice: round4(bar.open),
              shares: buyShares,
              feesUsd: round4(fees),
              tradeNotionalUsd: round4(notional),
            });
          } else {
            executedAction = 'HOLD';
          }
        } else if (pendingOrder.action === 'SELL') {
          if (longShares > 0) {
            const sellQty = longShares;
            const closeFeePerShare = bar.open * feeRate;
            const closeFees = sellQty * closeFeePerShare;
            const notional = sellQty * bar.open;
            const proceeds = notional - closeFees;
            const grossPnl = (bar.open - longCostBasisUsd) * sellQty;
            const closedPnlUsd = grossPnl - sellQty * longOpenFeePerShareUsd - closeFees;
            cashUsd = round4(cashUsd + proceeds);
            realizedPnlUsd = round4(realizedPnlUsd + closedPnlUsd);
            totalCostsUsd = round4(totalCostsUsd + closeFees);
            tradedNotionalUsd = round4(tradedNotionalUsd + notional);
            if (closedPnlUsd >= 0) {
              wins += 1;
              winPcts.push(round4((closedPnlUsd / (longCostBasisUsd * sellQty)) * 100));
            } else {
              losses += 1;
              lossPcts.push(round4((closedPnlUsd / (longCostBasisUsd * sellQty)) * 100));
            }
            executionRows.push({
              signalDate: pendingOrder.signalDate,
              executionDate: date,
              signalAction: 'SELL',
              executedAction: 'SELL',
              fillPrice: round4(bar.open),
              shares: sellQty,
              feesUsd: round4(closeFees),
              tradeNotionalUsd: round4(notional),
            });
            longShares = 0;
            longCostBasisUsd = 0;
            longOpenFeePerShareUsd = 0;
            longHoldingTradingDays = 0;
          }
          if (resolved.mode === 'long_short') {
            const maxSharesByTarget = Math.floor(pendingOrder.targetNotionalUsd / bar.open);
            const shortQty = Math.max(0, maxSharesByTarget);
            if (shortQty > 0) {
              const openFeePerShare = bar.open * feeRate;
              const fees = shortQty * openFeePerShare;
              const notional = shortQty * bar.open;
              const proceeds = notional - fees;
              const newTotal = shortShares + shortQty;
              shortCostBasisUsd =
                newTotal > 0
                  ? (shortCostBasisUsd * shortShares + bar.open * shortQty) / newTotal
                  : 0;
              shortOpenFeePerShareUsd =
                newTotal > 0
                  ? (shortOpenFeePerShareUsd * shortShares + openFeePerShare * shortQty) / newTotal
                  : 0;
              shortShares = newTotal;
              cashUsd = round4(cashUsd + proceeds);
              totalCostsUsd = round4(totalCostsUsd + fees);
              tradedNotionalUsd = round4(tradedNotionalUsd + notional);
              executionRows.push({
                signalDate: pendingOrder.signalDate,
                executionDate: date,
                signalAction: 'SELL',
                executedAction: 'SELL',
                fillPrice: round4(bar.open),
                shares: shortQty,
                feesUsd: round4(fees),
                tradeNotionalUsd: round4(notional),
              });
            }
          }
        } else if (pendingOrder.action === 'COVER') {
          if (shortShares > 0) {
            const coverQty = shortShares;
            const closeFeePerShare = bar.open * feeRate;
            const closeFees = coverQty * closeFeePerShare;
            const closeNotional = coverQty * bar.open;
            const grossPnl = (shortCostBasisUsd - bar.open) * coverQty;
            const closedPnlUsd =
              grossPnl - coverQty * shortOpenFeePerShareUsd - closeFees;
            const costToCover = closeNotional + closeFees;
            cashUsd = round4(cashUsd - costToCover);
            realizedPnlUsd = round4(realizedPnlUsd + closedPnlUsd);
            totalCostsUsd = round4(totalCostsUsd + closeFees);
            tradedNotionalUsd = round4(tradedNotionalUsd + closeNotional);
            if (closedPnlUsd >= 0) {
              wins += 1;
              winPcts.push(round4((closedPnlUsd / (shortCostBasisUsd * coverQty)) * 100));
            } else {
              losses += 1;
              lossPcts.push(round4((closedPnlUsd / (shortCostBasisUsd * coverQty)) * 100));
            }
            executionRows.push({
              signalDate: pendingOrder.signalDate,
              executionDate: date,
              signalAction: 'COVER',
              executedAction: 'COVER',
              fillPrice: round4(bar.open),
              shares: coverQty,
              feesUsd: round4(closeFees),
              tradeNotionalUsd: round4(closeNotional),
            });
            shortShares = 0;
            shortCostBasisUsd = 0;
            shortOpenFeePerShareUsd = 0;
            shortHoldingTradingDays = 0;
          } else {
            executedAction = 'HOLD';
          }
        } else {
          executedAction = 'HOLD';
        }
        pendingOrder = null;
      }

      signalSnapshot = await runSignal({
        ticker: resolved.ticker,
        asOfDate: date,
        equityUsd: cashUsd + longShares * bar.close - shortShares * bar.close,
        longShares,
        shortShares,
      });
      signalAction = signalSnapshot.finalAction;
      fallbackUsed = signalSnapshot.fallbackUsed;
      const normalized = normalizeActionByMode(
        resolved.mode,
        signalSnapshot.finalAction,
        longShares,
        shortShares,
      );
      normalizedAction = normalized.normalized;
      actionNote = normalized.note;
      if (bar && longShares > 0 && longCostBasisUsd > 0) {
        const pnlPct = ((bar.close - longCostBasisUsd) / longCostBasisUsd) * 100;
        if (pnlPct <= -stopLossPct) {
          normalizedAction = 'SELL';
          actionNote = `SELL forced by stop-loss (${pnlPct.toFixed(2)}%)`;
        } else if (pnlPct >= takeProfitPct) {
          normalizedAction = 'SELL';
          actionNote = `SELL forced by take-profit (${pnlPct.toFixed(2)}%)`;
        } else if (longHoldingTradingDays >= maxHoldDays) {
          normalizedAction = 'SELL';
          actionNote = `SELL forced by max-hold (${longHoldingTradingDays} trading days)`;
        }
      }
      if (bar && shortShares > 0 && shortCostBasisUsd > 0) {
        const pnlPct = ((shortCostBasisUsd - bar.close) / shortCostBasisUsd) * 100;
        if (pnlPct <= -stopLossPct) {
          normalizedAction = 'COVER';
          actionNote = `COVER forced by stop-loss (${pnlPct.toFixed(2)}%)`;
        } else if (pnlPct >= takeProfitPct) {
          normalizedAction = 'COVER';
          actionNote = `COVER forced by take-profit (${pnlPct.toFixed(2)}%)`;
        } else if (shortHoldingTradingDays >= maxHoldDays) {
          normalizedAction = 'COVER';
          actionNote = `COVER forced by max-hold (${shortHoldingTradingDays} trading days)`;
        }
      }

      const tradingIdx = tradingDates.indexOf(date);
      const nextTradingDate =
        tradingIdx >= 0 && tradingIdx < tradingDates.length - 1
          ? tradingDates[tradingIdx + 1]
          : null;
      if (nextTradingDate) {
        pendingOrder = {
          signalDate: date,
          executionDate: nextTradingDate,
          action: normalizedAction,
          targetNotionalUsd: signalSnapshot.targetNotionalUsd,
          oneWayCostBps: signalSnapshot.oneWayCostBps,
        };
      }
    }

    const closePrice = bar ? round4(bar.close) : lastMarkClose;
    if (bar) {
      lastMarkClose = round4(bar.close);
    }
    const positionValueUsd =
      closePrice === null ? 0 : longShares * closePrice - shortShares * closePrice;
    const equityUsd = round4(cashUsd + positionValueUsd);
    peakEquity = Math.max(peakEquity, equityUsd);
    const dailyPnlUsd = round4(equityUsd - prevEquity);
    const cumulativePnlUsd = round4(equityUsd - resolved.initialCapitalUsd);
    const unrealizedLong =
      closePrice === null ? 0 : (closePrice - longCostBasisUsd) * longShares;
    const unrealizedShort =
      closePrice === null ? 0 : (shortCostBasisUsd - closePrice) * shortShares;
    const unrealizedPnlUsd = round4(unrealizedLong + unrealizedShort);
    const diagnostics = analyzeDecisionBlockers(
      signalSnapshot,
      resolved.mode,
      longShares,
      shortShares,
    );
    const blockersTop3 = signalSnapshot?.blockersTop3?.length
      ? signalSnapshot.blockersTop3.slice(0, 3)
      : diagnostics.blockersTop3;
    const netShares = longShares - shortShares;

    dailyRecords.push({
      date,
      isTradingDay: Boolean(bar),
      marketClosed: !bar,
      signalAction,
      normalizedAction,
      actionNote,
      executedAction,
      executionPrice,
      closePrice,
      shares: netShares,
      cashUsd: round4(cashUsd),
      positionValueUsd: round4(positionValueUsd),
      equityUsd,
      dailyPnlUsd,
      cumulativePnlUsd,
      drawdownPct: drawdownPct(equityUsd, peakEquity),
      realizedPnlUsd: round4(realizedPnlUsd),
      unrealizedPnlUsd,
      fallbackUsed,
      ...diagnostics,
      blockersTop3,
      alphaLaneScore: signalSnapshot?.alphaLaneScore ?? null,
      contextLaneScore: signalSnapshot?.contextLaneScore ?? null,
    });
    if (bar) {
      longHoldingTradingDays = longShares > 0 ? longHoldingTradingDays + 1 : 0;
      shortHoldingTradingDays = shortShares > 0 ? shortHoldingTradingDays + 1 : 0;
    }
    prevEquity = equityUsd;
  }

  const tradingRows = dailyRecords.filter((row) => row.isTradingDay);
  const fallbackTradingDays = tradingRows.filter((row) => row.fallbackUsed).length;
  const fallbackRate = tradingRows.length ? fallbackTradingDays / tradingRows.length : 0;
  const holdTradingDays = tradingRows.filter((row) => row.signalAction === 'HOLD').length;
  const noSignalTradingDays = tradingRows.filter((row) =>
    row.primaryBlocker.startsWith('NO_SIGNAL:'),
  ).length;
  const nearBuyDays = tradingRows.filter(
    (row) =>
      row.buyScoreGap !== null &&
      row.buyRiskGap !== null &&
      row.buyScoreGap > 0 &&
      row.buyScoreGap <= 0.1 &&
      row.buyRiskGap <= 0.1,
  ).length;
  const nearSellDays = tradingRows.filter(
    (row) =>
      row.sellScoreGap !== null &&
      row.longExitGap !== null &&
      row.sellScoreGap > 0 &&
      row.sellScoreGap <= 0.1,
  ).length;

  const finalEquity =
    dailyRecords[dailyRecords.length - 1]?.equityUsd ?? resolved.initialCapitalUsd;
  const maxDrawdownPct = Math.min(...dailyRecords.map((row) => row.drawdownPct), 0);
  const trades = executionRows.filter((row) => row.executedAction !== 'HOLD').length;
  const closedTrades = wins + losses;
  const windowBars = bars.filter((bar) => {
    const date = asDateOnly(bar.date);
    return date >= resolved.startDate && date <= resolved.endDate;
  });
  const firstBar = windowBars[0];
  const lastBar = windowBars[windowBars.length - 1];
  const benchmarkReturnPct =
    firstBar && lastBar && firstBar.open > 0
      ? round4(((lastBar.close - firstBar.open) / firstBar.open) * 100)
      : null;

  const dataQualityStatus: TrialBacktestSummary['dataQualityStatus'] =
    fallbackRate > resolved.dataQualityMaxFallbackRate
      ? 'fail'
      : fallbackRate > resolved.dataQualityMaxFallbackRate * 0.5
        ? 'warn'
        : 'pass';
  const dataQualityNote =
    dataQualityStatus === 'fail'
      ? 'High fallback rate; API/data quality too degraded for confident conclusions.'
      : dataQualityStatus === 'warn'
        ? 'Moderate fallback rate; treat conclusions as provisional.'
        : 'Fallback rate within tolerance.';
  const priceStats = getPriceFetchStats();
  const cacheRequests = priceStats.cacheHits + priceStats.cacheMisses;
  const cacheHitRate = cacheRequests > 0 ? (priceStats.cacheHits / cacheRequests) * 100 : 0;
  const apiUsage = getApiUsageSnapshot();

  const summary: TrialBacktestSummary = {
    totalReturnPct: round4(
      ((finalEquity - resolved.initialCapitalUsd) / resolved.initialCapitalUsd) * 100,
    ),
    netPnlUsd: round2(finalEquity - resolved.initialCapitalUsd),
    maxDrawdownPct: round4(maxDrawdownPct),
    trades,
    winRatePct: closedTrades > 0 ? round4((wins / closedTrades) * 100) : null,
    averageWinPct: winPcts.length > 0 ? round4(mean(winPcts) ?? 0) : null,
    averageLossPct: lossPcts.length > 0 ? round4(mean(lossPcts) ?? 0) : null,
    turnoverPct: round4((tradedNotionalUsd / resolved.initialCapitalUsd) * 100),
    totalCostsUsd: round2(totalCostsUsd),
    benchmarkReturnPct,
    fallbackTradingDays,
    fallbackRatePct: round4(fallbackRate * 100),
    dataQualityStatus,
    dataQualityNote,
    holdTradingDays,
    noSignalTradingDays,
    nearBuyDays,
    nearSellDays,
    cacheHitRate: round4(cacheHitRate),
    apiCallsByEndpoint: apiUsage.endpoints,
  };

  return {
    config: resolved,
    generatedAt: new Date().toISOString(),
    summary,
    dailyRecords,
    executionRows,
  };
}

export async function persistTrialBacktestReport(
  report: TrialBacktestReport,
): Promise<{ jsonPath: string; csvPath: string }> {
  const baseDir = path.join(process.cwd(), '.dexter', 'signal-engine', 'backtests');
  await mkdir(baseDir, { recursive: true });
  const suffix = `${report.config.ticker}-${report.config.signalProfile}-${report.config.startDate}-${report.config.endDate}`;
  const jsonPath = path.join(baseDir, `trial-backtest-${suffix}.json`);
  const csvPath = path.join(baseDir, `trial-backtest-${suffix}.csv`);
  await writeFile(jsonPath, JSON.stringify(report, null, 2), 'utf8');
  await writeFile(csvPath, toCsv(report.dailyRecords), 'utf8');
  return { jsonPath, csvPath };
}
