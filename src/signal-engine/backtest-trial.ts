import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { runFundamentalAnalysis } from '../agents/analysis/fundamentals.js';
import { runSentimentAnalysis } from '../agents/analysis/sentiment.js';
import { runTechnicalAnalysis } from '../agents/analysis/technical.js';
import { runValuationAnalysis } from '../agents/analysis/valuation.js';
import { fetchHistoricalPrices, PriceBar } from '../data/market.js';
import { estimateTargetNotionalUsd } from './execution.js';
import { runDailyScan, type ScanProviders } from './index.js';
import { SIGNAL_CONFIG } from './config.js';

export type BacktestMode = 'long_only';
export type BacktestExecutionModel = 'next_open';

export interface TrialBacktestConfig {
  ticker: string;
  startDate: string;
  endDate: string;
  initialCapitalUsd: number;
  mode: BacktestMode;
  execution: BacktestExecutionModel;
  apiDelayMs: number;
  fundamentalRefreshDays: number;
  valuationRefreshDays: number;
  sentimentRefreshDays: number;
  dataQualityMaxFallbackRate: number;
  signalProfile: 'baseline' | 'research' | 'adaptive' | 'ml_sidecar';
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
  normalizedAction: 'BUY' | 'SELL' | 'HOLD' | 'N/A';
  actionNote: string;
  executedAction: 'BUY' | 'SELL' | 'HOLD' | 'N/A';
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
}

export interface TrialExecutionRow {
  signalDate: string;
  executionDate: string;
  signalAction: 'BUY' | 'SELL' | 'HOLD' | 'COVER';
  executedAction: 'BUY' | 'SELL' | 'HOLD';
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
};

export interface TrialBacktestDependencies {
  getBars: (ticker: string, startDate: string, endDate: string) => Promise<PriceBar[]>;
  runSignal: (params: {
    ticker: string;
    asOfDate: string;
    equityUsd: number;
    shares: number;
  }) => Promise<SignalSnapshot>;
}

const DEFAULT_CONFIG: TrialBacktestConfig = {
  ticker: 'AAPL',
  startDate: '2026-01-01',
  endDate: '2026-01-31',
  initialCapitalUsd: 10_000,
  mode: 'long_only',
  execution: 'next_open',
  apiDelayMs: 250,
  fundamentalRefreshDays: 7,
  valuationRefreshDays: 7,
  sentimentRefreshDays: 3,
  dataQualityMaxFallbackRate: 0.2,
  signalProfile: 'adaptive',
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

function analyzeDecisionBlockers(
  snapshot: SignalSnapshot | null,
  shares: number,
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
    };
  }
  if (snapshot.finalAction === 'HOLD') {
    if (score !== null && risk !== null) {
      if (score >= buyScoreThreshold && risk <= buyRiskThreshold) {
        blocker = 'Risk gate blocked BUY';
      } else if (score > sellScoreThreshold && score < buyScoreThreshold) {
        blocker = 'Aggregate score in HOLD zone';
      } else if (score <= sellScoreThreshold && shares <= 0) {
        blocker = 'No long position to exit';
      } else if (
        snapshot.expectedEdgeAfterCostsBps !== undefined &&
        snapshot.expectedEdgeAfterCostsBps <= 0
      ) {
        blocker = 'Expected edge after costs is non-positive';
      } else {
        blocker = 'Rule convergence resulted in HOLD';
      }
    } else {
      blocker = 'Missing score/risk diagnostics';
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
          [params.ticker]: { longShares: params.shares, shortShares: 0 },
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
    const technical = alert.reasoning.components.find((component) => component.name === 'Technical');
    const technicalDetails = (technical?.details ?? {}) as Record<string, unknown>;
    const subSignals = (technicalDetails.subSignals ?? {}) as Record<string, Record<string, unknown>>;
    const trendSignal = String(subSignals.trend?.signal ?? 'neutral');
    const thresholdSet = adaptiveThresholds(scoreHistory, config);
    let buyScoreThreshold = SIGNAL_CONFIG.actions.buyScoreThreshold;
    let sellScoreThreshold = SIGNAL_CONFIG.actions.sellScoreThreshold;
    let buyRiskThreshold = SIGNAL_CONFIG.actions.buyRiskThreshold;

    if (config.signalProfile === 'adaptive') {
      const entryBuffer = config.adaptiveEntryBuffer;
      buyScoreThreshold = thresholdSet.buyScore;
      sellScoreThreshold = thresholdSet.sellScore;
      buyRiskThreshold = thresholdSet.buyRisk;
      const previousScore =
        scoreHistory.length > 0 ? scoreHistory[scoreHistory.length - 1] : null;
      const isAddOnBuy = params.shares > 0;
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
        params.shares === 0 &&
        score <= config.tacticalMaxAggregateScore &&
        riskScore >= config.tacticalMinRiskScore &&
        edgeAfterCosts >= config.tacticalMinEdgeAfterCostsBps &&
        Number.isFinite(rsi14) &&
        Number.isFinite(zScore) &&
        rsi14 <= config.tacticalRsiMax &&
        zScore <= config.tacticalZScoreMax &&
        trendScore >= config.tacticalTrendScoreMin;
      if (
        (score >= config.adaptiveBuyScoreFloor || dipReboundBuyEligible) &&
        (score + entryBuffer >= buyScoreThreshold ||
          (hasCommitteeBuyBias && score + entryBuffer >= committeeBuyThreshold) ||
          dipReboundBuyEligible) &&
        addOnBuyAllowed &&
        riskScore >= buyRiskThreshold
      ) {
        finalAction = 'BUY';
      } else if (params.shares > 0 && score <= sellScoreThreshold) {
        finalAction = 'SELL';
      } else if (params.shares === 0 && score >= 0.02 && riskScore >= buyRiskThreshold) {
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
        params.shares > 0 &&
        (mlProbabilityUp <= config.mlSellProbabilityThreshold ||
          (score <= -0.15 && trendSignal === 'bearish'))
      ) {
        finalAction = 'SELL';
      } else {
        finalAction = 'HOLD';
      }
    }

    if (config.signalProfile === 'research' && finalAction === 'HOLD') {
      if (score >= 0.2 && riskScore >= 0.25) {
        finalAction = 'BUY';
      } else if (params.shares > 0 && score <= -0.15) {
        finalAction = 'SELL';
      }
    }

    if (finalAction === 'BUY') {
      targetNotionalUsd = estimateTargetNotionalUsd(
        'BUY',
        alert.reasoning.risk,
        params.equityUsd,
        alert.confidence,
        { longShares: params.shares, shortShares: 0 },
      );
      if (config.signalProfile === 'ml_sidecar') {
        targetNotionalUsd *= config.mlPositionScale;
      }
    } else if (finalAction === 'SELL') {
      const mark = barsByDate.get(params.asOfDate)?.close ?? alert.positionPerformance.markPrice;
      targetNotionalUsd = params.shares * mark;
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

    if (
      finalAction !== 'HOLD' &&
      edgeAfterCosts < config.adaptiveMinExpectedEdgeAfterCostsBps
    ) {
      finalAction = 'HOLD';
      targetNotionalUsd = 0;
      qualityGuardSuppressed = true;
      qualityGuardReason = `NO_SIGNAL: expected edge after costs (${edgeAfterCosts.toFixed(2)} bps) below minimum ${config.adaptiveMinExpectedEdgeAfterCostsBps.toFixed(2)} bps`;
    }

    scoreHistory.push(score);
    fallbackHistory.push(alert.fallbackPolicy.hadFallback);

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
    };
  };
}

async function defaultGetBars(
  ticker: string,
  startDate: string,
  endDate: string,
): Promise<PriceBar[]> {
  return fetchHistoricalPrices(ticker, 420, { startDate, endDate });
}

function normalizeLongOnlyAction(
  action: SignalSnapshot['finalAction'],
  shares: number,
): { normalized: 'BUY' | 'SELL' | 'HOLD'; note: string } {
  if (action === 'COVER') {
    return { normalized: 'HOLD', note: 'COVER mapped to HOLD in long-only mode' };
  }
  if (action === 'SELL' && shares <= 0) {
    return { normalized: 'HOLD', note: 'SELL ignored: no long position' };
  }
  if (action === 'BUY' || action === 'SELL' || action === 'HOLD') {
    return { normalized: action, note: '' };
  }
  return { normalized: 'HOLD', note: 'Unsupported action mapped to HOLD' };
}

function mean(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export async function runTrialBacktest(
  config: Partial<TrialBacktestConfig> = {},
  deps: Partial<TrialBacktestDependencies> = {},
): Promise<TrialBacktestReport> {
  const resolved: TrialBacktestConfig = {
    ...DEFAULT_CONFIG,
    ...config,
    mode: 'long_only',
    execution: 'next_open',
  };

  const lookbackStart = subtractDays(resolved.startDate, 260);
  const bars = deps.getBars
    ? await deps.getBars(resolved.ticker, resolved.startDate, resolved.endDate)
    : await defaultGetBars(resolved.ticker, lookbackStart, resolved.endDate);
  const runSignal = deps.runSignal ?? createDefaultRunSignalRunner(resolved, bars);
  const barsByDate = new Map(bars.map((bar) => [asDateOnly(bar.date), bar]));
  const tradingDates = bars.map((bar) => asDateOnly(bar.date));
  const calendarDates = enumerateCalendarDates(resolved.startDate, resolved.endDate);
  const stopLossPct = resolved.exitStopLossPct ?? DEFAULT_CONFIG.exitStopLossPct;
  const takeProfitPct = resolved.exitTakeProfitPct ?? DEFAULT_CONFIG.exitTakeProfitPct;
  const maxHoldDays =
    resolved.exitMaxHoldTradingDays ?? DEFAULT_CONFIG.exitMaxHoldTradingDays;

  let cashUsd = resolved.initialCapitalUsd;
  let shares = 0;
  let avgCostUsd = 0;
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
        action: 'BUY' | 'SELL' | 'HOLD';
        targetNotionalUsd: number;
        oneWayCostBps: number;
      }
    | null = null;

  const dailyRecords: TrialBacktestDailyRecord[] = [];
  const executionRows: TrialExecutionRow[] = [];
  let lastMarkClose: number | null = null;
  let holdingTradingDays = 0;

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

        if (pendingOrder.action === 'BUY') {
          const maxSharesByTarget = Math.floor(pendingOrder.targetNotionalUsd / bar.open);
          const maxSharesByCash = Math.floor(
            cashUsd / (bar.open * (1 + pendingOrder.oneWayCostBps / 10_000)),
          );
          const buyShares = Math.max(0, Math.min(maxSharesByTarget, maxSharesByCash));
          if (buyShares > 0) {
            const notional = buyShares * bar.open;
            const fees = (notional * pendingOrder.oneWayCostBps) / 10_000;
            const totalCost = notional + fees;
            const combinedBasis = avgCostUsd * shares + totalCost;
            shares += buyShares;
            avgCostUsd = shares > 0 ? combinedBasis / shares : 0;
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
          const sellShares = shares;
          if (sellShares > 0) {
            const notional = sellShares * bar.open;
            const fees = (notional * pendingOrder.oneWayCostBps) / 10_000;
            const proceeds = notional - fees;
            const closedPnlUsd = proceeds - avgCostUsd * sellShares;
            const closedPnlPct =
              avgCostUsd > 0 ? (closedPnlUsd / (avgCostUsd * sellShares)) * 100 : 0;
            if (closedPnlUsd >= 0) {
              wins += 1;
              winPcts.push(closedPnlPct);
            } else {
              losses += 1;
              lossPcts.push(closedPnlPct);
            }
            realizedPnlUsd = round4(realizedPnlUsd + closedPnlUsd);
            totalCostsUsd = round4(totalCostsUsd + fees);
            tradedNotionalUsd = round4(tradedNotionalUsd + notional);
            cashUsd = round4(cashUsd + proceeds);
            shares = 0;
            avgCostUsd = 0;
            executionRows.push({
              signalDate: pendingOrder.signalDate,
              executionDate: date,
              signalAction: 'SELL',
              executedAction: 'SELL',
              fillPrice: round4(bar.open),
              shares: sellShares,
              feesUsd: round4(fees),
              tradeNotionalUsd: round4(notional),
            });
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
        equityUsd: cashUsd + shares * bar.close,
        shares,
      });
      signalAction = signalSnapshot.finalAction;
      fallbackUsed = signalSnapshot.fallbackUsed;
      const normalized = normalizeLongOnlyAction(signalSnapshot.finalAction, shares);
      normalizedAction = normalized.normalized;
      actionNote = normalized.note;
      if (bar && shares > 0 && avgCostUsd > 0) {
        const pnlPct = ((bar.close - avgCostUsd) / avgCostUsd) * 100;
        if (pnlPct <= -stopLossPct) {
          normalizedAction = 'SELL';
          actionNote = `SELL forced by stop-loss (${pnlPct.toFixed(2)}%)`;
        } else if (pnlPct >= takeProfitPct) {
          normalizedAction = 'SELL';
          actionNote = `SELL forced by take-profit (${pnlPct.toFixed(2)}%)`;
        } else if (holdingTradingDays >= maxHoldDays) {
          normalizedAction = 'SELL';
          actionNote = `SELL forced by max-hold (${holdingTradingDays} trading days)`;
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
    const positionValueUsd = closePrice === null ? 0 : shares * closePrice;
    const equityUsd = round4(cashUsd + positionValueUsd);
    peakEquity = Math.max(peakEquity, equityUsd);
    const dailyPnlUsd = round4(equityUsd - prevEquity);
    const cumulativePnlUsd = round4(equityUsd - resolved.initialCapitalUsd);
    const unrealizedPnlUsd = closePrice === null ? 0 : round4((closePrice - avgCostUsd) * shares);
    const diagnostics = analyzeDecisionBlockers(signalSnapshot, shares);

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
      shares,
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
    });
    if (bar) {
      holdingTradingDays = shares > 0 ? holdingTradingDays + 1 : 0;
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
